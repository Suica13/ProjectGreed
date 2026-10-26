/* Versioned resolved-state records: deltas for playback, authoritative turn-start
   checkpoints for forks. No credentials or RNG enter public playback frames. */
"use strict";
const MatchRecords = (() => {
  const version = 1,
    maxBytes = 32 * 1024 * 1024,
    maxFrames = 12000;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const blocked = new Set(["__proto__", "prototype", "constructor"]);
  const fingerprints = new WeakMap();
  function fingerprint(G) {
    if (fingerprints.has(G)) return fingerprints.get(G);
    const text = JSON.stringify([
      version,
      Object.entries(G.models).map(([id, m]) => [
        id,
        m.hp,
        m.en,
        m.move,
        m.adaptability,
        m.weapons.map((w) => [w.id, w.en, w.hit, w.attack, w.damage, w.range]),
      ]),
      Object.entries(G.catalog.maps).map(([id, m]) => [id, m.width, m.height, m.tiles]),
    ]);
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    const result = "greed-v1-" + (hash >>> 0).toString(16);
    fingerprints.set(G, result);
    return result;
  }
  function delta(before = {}, after = {}) {
    const set = {},
      remove = [];
    for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) remove.push(key);
    for (const [key, value] of Object.entries(after))
      if (!same(before[key], value)) set[key] = clone(value);
    return { set, remove };
  }
  function patch(before = {}, change) {
    const result = { ...before, ...clone(change.set) };
    for (const key of change.remove) delete result[key];
    return result;
  }
  function pack(before, after) {
    const { game, log, ...rest } = after,
      { units, tiles, ...board } = game;
    const oldUnits = new Map((before?.game.units || []).map((u) => [u.id, u]));
    const oldLog = before?.log || [],
      append = log.length >= oldLog.length && same(log.slice(log.length - oldLog.length), oldLog);
    return {
      state: delta(
        before
          ? Object.fromEntries(Object.entries(before).filter(([k]) => !["game", "log"].includes(k)))
          : {},
        rest,
      ),
      game: delta(
        before
          ? Object.fromEntries(
              Object.entries(before.game).filter(([k]) => !["units", "tiles"].includes(k)),
            )
          : {},
        board,
      ),
      units: units.filter((u) => !same(oldUnits.get(u.id), u)).map(clone),
      removed: [...oldUnits.keys()].filter((id) => !units.some((u) => u.id === id)),
      log: append
        ? { prepend: clone(log.slice(0, log.length - oldLog.length)) }
        : { reset: clone(log) },
    };
  }
  function unpack(before, change, tiles) {
    const units = new Map((before?.game.units || []).map((u) => [u.id, u]));
    for (const id of change.removed) units.delete(id);
    for (const u of change.units) units.set(u.id, clone(u));
    return {
      ...patch(before || {}, change.state),
      game: { ...patch(before?.game || {}, change.game), tiles, units: [...units.values()] },
      log: change.log.reset || [...change.log.prepend, ...(before?.log || [])],
    };
  }
  function view(record, index, perspective) {
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= record.frames.length ||
      !record.perspectives.includes(perspective)
    )
      throw Error("无效的回放位置或视角。");
    let result = null;
    for (let i = 0; i <= index; i++)
      result = unpack(result, record.frames[i].views[perspective], record.tiles);
    return result;
  }
  function publicView(snapshot) {
    const keys = [
      "game",
      "phase",
      "log",
      "logNames",
      "lastEvent",
      "combatActors",
      "combats",
      "effectActors",
      "effectCombats",
      "effectEvent",
      "plans",
      "counterPlans",
      "viewTeam",
    ];
    const result = Object.fromEntries(
      keys.filter((k) => snapshot[k] !== undefined).map((k) => [k, snapshot[k]]),
    );
    result.members = (snapshot.members || []).map(({ id, name, seat, bot }) => ({
      id,
      name,
      seat,
      bot,
    }));
    return result;
  }
  function create(G, id, settings, tiles, parent = null) {
    return {
      format: "ProjectGreed-record",
      version,
      rules: fingerprint(G),
      id,
      createdAt: new Date().toISOString(),
      parent,
      settings: clone(settings),
      tiles: clone(tiles),
      perspectives: [
        "global",
        ...Array.from(new Set(G.getMap(settings.mapId).spawns.map((_, i) => G.seatTeam(i)))).map(
          (t) => "team:" + t,
        ),
      ],
      frames: [],
      checkpoints: [],
    };
  }
  function validateGame(G, g, tiles, authoritative = false) {
    if (!g || !Object.hasOwn(G.catalog.maps, g.mapId)) throw Error("存档地图不受支持。");
    const map = G.getMap(g.mapId);
    if (
      !Array.isArray(tiles) ||
      tiles.length !== map.height ||
      tiles.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== map.width ||
          row.some((t) => !Object.hasOwn(G.terrain, t)),
      )
    )
      throw Error("存档地形无效。");
    if (
      !Number.isSafeInteger(g.round) ||
      g.round < 1 ||
      ![0, 1].includes(g.team) ||
      !Array.isArray(g.units) ||
      g.units.length > 2048
    )
      throw Error("存档对局状态无效。");
    const ids = new Set();
    for (const u of g.units) {
      if (
        typeof u.id !== "string" ||
        ids.has(u.id) ||
        !Object.hasOwn(G.models, u.model) ||
        !Number.isFinite(u.hp) ||
        !Number.isFinite(u.en) ||
        !Number.isInteger(u.x) ||
        !Number.isInteger(u.y) ||
        u.x < 0 ||
        u.y < 0 ||
        u.x >= map.width ||
        u.y >= map.height
      )
        throw Error("存档单位无效。");
      ids.add(u.id);
      if (
        authoritative &&
        (!Number.isInteger(G.ownerOf(u)) ||
          G.ownerOf(u) < 0 ||
          G.ownerOf(u) >= map.spawns.length ||
          u.team !== G.seatTeam(G.ownerOf(u)))
      )
        throw Error("存档单位席位无效。");
    }
    if (
      authoritative &&
      (!Number.isSafeInteger(g.seed) || !Number.isSafeInteger(g.partSeed) || g.winner !== null)
    )
      throw Error("存档随机状态或续局节点无效。");
  }
  function validate(G, input) {
    const raw = JSON.stringify(input);
    if (new TextEncoder().encode(raw).length > maxBytes) throw Error("对局记录超过32MB限制。");
    const record = JSON.parse(raw, (key, value) => {
      if (blocked.has(key)) throw Error("对局记录包含无效字段。");
      return value;
    });
    if (
      record?.format !== "ProjectGreed-record" ||
      record.version !== version ||
      record.rules !== fingerprint(G)
    )
      throw Error("对局记录版本或单位规则不兼容。");
    if (
      !Array.isArray(record.frames) ||
      !record.frames.length ||
      record.frames.length > maxFrames ||
      !Array.isArray(record.perspectives) ||
      !record.perspectives.length ||
      new Set(record.perspectives).size !== record.perspectives.length ||
      record.perspectives.some((p) => !["global", "team:0", "team:1"].includes(p))
    )
      throw Error("对局记录结构无效。");
    if (
      !record.settings ||
      !Object.hasOwn(G.catalog.maps, record.settings.mapId) ||
      !Array.isArray(record.checkpoints)
    )
      throw Error("对局记录设置无效。");
    G.validateCostLimit(record.settings.costLimit);
    G.validateUnitLimit(record.settings.unitLimit);
    G.validateUnitCostLimit(record.settings.unitCostLimit);
    G.validateFogMode(record.settings.fogMode);
    G.validateTagRestrictions(
      Object.fromEntries(
        ["bannedFactions", "bannedEras", "bannedTypes"].map((k) => [k, record.settings[k]]),
      ),
    );
    G.validateTeamRestrictions(record.settings.teamRestrictions);
    if (
      typeof record.settings.shareAlliedUnits !== "boolean" ||
      !Array.isArray(record.settings.teamRestrictions)
    )
      throw Error("存档房间规则无效。");
    const states = {};
    for (const frame of record.frames) {
      if (!frame.views || !Number.isFinite(frame.at)) throw Error("回放帧无效。");
      for (const perspective of record.perspectives) {
        const change = frame.views[perspective];
        if (
          !change?.state?.set ||
          !Array.isArray(change.state.remove) ||
          !change?.game?.set ||
          !Array.isArray(change.game.remove) ||
          !Array.isArray(change.units) ||
          !Array.isArray(change.removed) ||
          (!Array.isArray(change.log?.prepend) && !Array.isArray(change.log?.reset))
        )
          throw Error("回放增量无效。");
        const s = (states[perspective] = unpack(states[perspective], change, record.tiles));
        validateGame(G, s.game, record.tiles);
        for (const battle of [...(s.combats || []), ...(s.effectCombats || [])]) {
          if (!Array.isArray(battle.actors) || !Array.isArray(battle.events))
            throw Error("回放交战无效。");
          for (const actor of battle.actors)
            if (!Object.hasOwn(G.models, actor.model)) throw Error("回放机体无效。");
          for (const event of battle.events) {
            const source = battle.actors.find((u) => u.id === event.from);
            if (
              !source ||
              !battle.actors.some((u) => u.id === event.to) ||
              !G.models[event.model || source.model]?.weapons.some((w) => w.id === event.weapon) ||
              !Array.isArray(event.strikes)
            )
              throw Error("回放武器事件无效。");
          }
        }
      }
    }
    const checkpointFrames = new Set();
    for (const checkpoint of record.checkpoints) {
      if (
        !record.perspectives.includes("global") ||
        !Number.isInteger(checkpoint.frame) ||
        !record.frames[checkpoint.frame]?.turnStart ||
        checkpointFrames.has(checkpoint.frame)
      )
        throw Error("只能从回合开始节点继续。");
      checkpointFrames.add(checkpoint.frame);
      validateGame(G, checkpoint.game, record.tiles, true);
      if (checkpoint.game.mapId !== record.settings.mapId) throw Error("存档地图不一致。");
      const shown = view(record, checkpoint.frame, "global").game;
      const { seed, partSeed, ...stored } = checkpoint.game;
      const { tiles, ...visible } = shown;
      if (
        Object.keys(stored).length !== Object.keys(visible).length ||
        Object.entries(stored).some(([key, value]) => !same(value, visible[key]))
      )
        throw Error("续局节点与录像状态不一致。");
      if (
        checkpoint.game.deployment !== null &&
        (!Array.isArray(checkpoint.game.deployment) ||
          !checkpoint.game.deployment.every((value) => value === true))
      )
        throw Error("部署中不能创建续局节点。");
      G.sensors.view({ ...checkpoint.game, tiles: record.tiles }, 0);
      G.sensors.view({ ...checkpoint.game, tiles: record.tiles }, 1);
    }
    return record;
  }
  return {
    version,
    maxBytes,
    maxFrames,
    clone,
    pack,
    unpack,
    view,
    publicView,
    create,
    validate,
    fingerprint,
  };
})();
if (typeof module !== "undefined") module.exports = MatchRecords;
