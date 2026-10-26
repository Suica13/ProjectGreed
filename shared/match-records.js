/* 回放记录保存公开状态增量与回合索引，不保留接管游戏所需的随机状态。 */
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
      "chat",
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
      gameVersion: gameVersion(),
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
  function gameVersion() {
    return typeof PROJECT !== "undefined" ? PROJECT.version : require("../project.json").version;
  }
  // Saves contain authoritative state and are exported only to the host. They
  // are never embedded in public replay frames or ordinary room snapshots.
  function createSave(G, room) {
    return {
      format: "ProjectGreed-save",
      version: 1,
      gameVersion: gameVersion(),
      rules: fingerprint(G),
      createdAt: new Date().toISOString(),
      settings: clone(room.settings),
      game: clone(room.game),
      armies: room.seats.map((player) => (player ? G.armySettings(player) : null)),
      log: clone(room.log || []),
      teamLogs: clone(room.teamLogs || {}),
      logNames: clone(room.logNames || []),
      chat: clone(room.chat || []),
    };
  }
  function validateSave(G, input) {
    const raw = JSON.stringify(input);
    if (new TextEncoder().encode(raw).length > maxBytes) throw Error("存档超过32MB限制。");
    const save = JSON.parse(raw, (key, value) => {
      if (blocked.has(key)) throw Error("存档包含无效字段。");
      return value;
    });
    if (save?.format !== "ProjectGreed-save" || save.version !== 1 || save.rules !== fingerprint(G))
      throw Error("存档版本或单位规则不兼容。");
    validateGame(G, save.game, save.game?.tiles);
    const g = save.game,
      settings = save.settings;
    if (
      !settings ||
      settings.mapId !== g.mapId ||
      g.winner !== null ||
      !Number.isInteger(g.seed) ||
      g.seed < 0 ||
      g.seed > 0xffffffff ||
      !Number.isInteger(g.partSeed) ||
      g.partSeed < 0 ||
      g.partSeed > 0xffffffff
    )
      throw Error("存档对局状态无效。");
    G.validateCostLimit(settings.costLimit);
    G.validateUnitLimit(settings.unitLimit);
    G.validateUnitCostLimit(settings.unitCostLimit);
    G.validateFogMode(settings.fogMode);
    G.validateTagRestrictions(settings);
    G.validateTeamRestrictions(settings.teamRestrictions);
    if (typeof settings.shareAlliedUnits !== "boolean") throw Error("存档房间规则无效。");
    const seats = G.getMap(g.mapId).spawns.length;
    if (!Array.isArray(save.armies) || save.armies.length !== seats) throw Error("存档席位无效。");
    save.armies = save.armies.map((army) => (army ? G.validateArmySettings(army) : null));
    for (const u of g.units) {
      const owner = G.ownerOf(u);
      if (
        !Number.isInteger(owner) ||
        owner < 0 ||
        owner >= seats ||
        u.team !== G.seatTeam(owner) ||
        u.pendingMove ||
        u.plan ||
        !Number.isFinite(u.shield) ||
        !Number.isFinite(u.angle) ||
        !Number.isFinite(u.performance ?? 1) ||
        (u.performance ?? 1) <= 0 ||
        (u.performance ?? 1) > 10 ||
        !Number.isFinite(u.actionPoints) ||
        u.actionPoints < 0
      )
        throw Error("存档单位状态无效。");
      if (u.embarked && !g.units.some((carrier) => carrier.id === u.embarked.carrierId))
        throw Error("存档载员状态无效。");
    }
    for (const key of ["log", "logNames", "chat"])
      if (!Array.isArray(save[key])) throw Error("存档历史无效。");
    if (!save.teamLogs || typeof save.teamLogs !== "object") throw Error("存档战报无效。");
    return save;
  }
  function validateGame(G, g, tiles) {
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
    }
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
    record.checkpoints = record.checkpoints.map((checkpoint) => {
      const frame = record.frames[checkpoint.frame];
      if (
        !Number.isInteger(checkpoint.frame) ||
        checkpoint.frame < 0 ||
        !frame?.turnStart ||
        checkpointFrames.has(checkpoint.frame)
      )
        throw Error("回放回合索引无效。");
      checkpointFrames.add(checkpoint.frame);
      // Older imports may contain private resume state. Keep only the public turn index.
      const shown = view(record, checkpoint.frame, record.perspectives[0]).game;
      return { frame: checkpoint.frame, round: shown.round, team: shown.team };
    });
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
    gameVersion,
    createSave,
    validateSave,
  };
})();
if (typeof module !== "undefined") module.exports = MatchRecords;
