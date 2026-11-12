/* Declarative cooperative missions. Authority owns events and dialogue cursors. */
const MissionMode = (() => {
  "use strict";
  const defaultMapId = "mission_white_base";
  const eras = ["0079T1", "0079T2", "0083", "0087T1", "0087T2", "0093T1"];
  const text = (v, max = 2000) => typeof v === "string" && v.length > 0 && v.length <= max;
  const id = (v) => typeof v === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(v);
  function validate(m, map, G = null) {
    let location = "关卡设置";
    const fail = () => {
      throw Error("任务脚本配置无效：" + location + "，请检查必填对象、数值和引用");
    };
    if (
      !m ||
      m.version !== 1 ||
      !eras.includes(m.era) ||
      !Number.isSafeInteger(m.technologyLimit) ||
      m.technologyLimit < 0 ||
      m.technologyLimit > 1e9 ||
      !Number.isInteger(m.costLimit) ||
      m.costLimit < 500 ||
      m.costLimit > 1e6 ||
      !Number.isInteger(m.unitLimit) ||
      m.unitLimit < 1 ||
      m.unitLimit > 72 ||
      !Array.isArray(m.actors) ||
      m.actors.length > 256 ||
      !Array.isArray(m.events) ||
      m.events.length > 100
    )
      fail();
    if (
      m.enemyResourcePerPlayer !== undefined &&
      (!Number.isFinite(m.enemyResourcePerPlayer) ||
        m.enemyResourcePerPlayer < 0 ||
        m.enemyResourcePerPlayer > 5)
    )
      fail();
    const actors = new Set(),
      events = new Set();
    for (const a of m.actors) {
      location = "单位「" + (a.id || "未命名") + "」";
      if (
        !id(a.id) ||
        actors.has(a.id) ||
        ![0, 1].includes(a.team) ||
        !text(a.unitId, 100) ||
        !id(a.group) ||
        !Number.isInteger(a.x) ||
        !Number.isInteger(a.y) ||
        a.x < 0 ||
        a.y < 0 ||
        a.x >= map.width ||
        a.y >= map.height ||
        typeof a.initial !== "boolean" ||
        (a.pilotId && !text(a.pilotId, 100)) ||
        !Number.isInteger(a.level ?? 0) ||
        (a.level ?? 0) < 0 ||
        (a.level ?? 0) > 5
      )
        fail();
      if (
        (a.angle !== undefined && ![0, 90, 180, 270].includes(a.angle)) ||
        (a.squad && !id(a.squad))
      )
        fail();
      if (
        a.squad &&
        m.actors.some(
          (b) =>
            b.squad === a.squad &&
            (b.team !== a.team || b.x !== a.x || b.y !== a.y || b.initial !== a.initial),
        )
      )
        fail();
      if (
        G &&
        (!G.models[a.unitId + "__" + a.kitId] || (a.pilotId && !G.pilots.aceProfile(a.pilotId)))
      )
        fail();
      actors.add(a.id);
    }
    location = "胜败条件";
    if (!Array.isArray(m.protect) || m.protect.some((a) => !actors.has(a))) fail();
    if (!["all_enemies", "survive", "defeat_actor"].includes(m.victory?.type)) fail();
    if (m.victory.type === "survive" && (!Number.isInteger(m.victory.round) || m.victory.round < 1))
      fail();
    if (m.victory.type === "defeat_actor" && !actors.has(m.victory.actor)) fail();
    for (const e of m.events) {
      location = "事件「" + (e.name || e.id || "未命名") + "」的触发条件";
      if (
        !id(e.id) ||
        events.has(e.id) ||
        !text(e.name, 100) ||
        !Array.isArray(e.actions) ||
        e.actions.length > 50
      )
        fail();
      events.add(e.id);
      function checkCondition(w, depth = 0) {
        if (
          !w ||
          ![
            "start",
            "round",
            "defeated_group",
            "actor_hp",
            "enter_region",
            "actor_destroyed",
            "group_destroyed",
            "event_completed",
            "all",
            "any",
          ].includes(w.type)
        )
          fail();
        if (["all", "any"].includes(w.type)) {
          if (
            depth >= 2 ||
            !Array.isArray(w.conditions) ||
            !w.conditions.length ||
            w.conditions.length > 8
          )
            fail();
          w.conditions.forEach((c) => checkCondition(c, depth + 1));
        }
        if (w.type === "actor_destroyed" && !actors.has(w.actor)) fail();
        if (w.type === "group_destroyed" && !m.actors.some((a) => a.group === w.group)) fail();
        if (
          w.type === "event_completed" &&
          (!m.events.some((other) => other.id === w.event) || w.event === e.id)
        )
          fail();
        if (w.type === "round" && (!Number.isInteger(w.round) || w.round < 1)) fail();
        if (
          w.type === "defeated_group" &&
          (!id(w.group) ||
            !m.actors.some((a) => a.group === w.group) ||
            !Number.isInteger(w.count) ||
            w.count < 1 ||
            !Number.isInteger(w.byRound) ||
            w.byRound < 1)
        )
          fail();
        if (
          w.type === "actor_hp" &&
          (!actors.has(w.actor) || !Number.isFinite(w.percent) || w.percent < 0 || w.percent > 100)
        )
          fail();
        if (
          w.type === "enter_region" &&
          (!actors.has(w.actor) ||
            ![w.x, w.y, w.width, w.height].every(Number.isInteger) ||
            w.x < 0 ||
            w.y < 0 ||
            w.width < 1 ||
            w.height < 1 ||
            w.x + w.width > map.width ||
            w.y + w.height > map.height)
        )
          fail();
      }
      checkCondition(e.when);
      for (const a of e.actions) {
        location =
          "事件「" + e.name + "」的第 " + (e.actions.indexOf(a) + 1) + " 个动作（" + a.type + "）";
        if (
          ![
            "spawn",
            "dialogue",
            "protect",
            "unprotect",
            "recover",
            "message",
            "victory",
            "defeat",
          ].includes(a.type)
        )
          fail();
        if (
          ["spawn", "protect", "unprotect", "recover"].includes(a.type) &&
          (!Array.isArray(a.actors) || a.actors.some((v) => !actors.has(v)))
        )
          fail();
        if (
          a.type === "recover" &&
          ![a.hpPercent, a.enPercent].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
        )
          fail();
        if (a.type === "message" && !text(a.text)) fail();
        if (a.type === "dialogue") {
          if (!Array.isArray(a.lines) || !a.lines.length || a.lines.length > 50) fail();
          for (const l of a.lines) {
            if (l.sound && typeof l.sound !== "string") fail();
            if (
              !actors.has(l.actor) ||
              !text(l.name, 80) ||
              !text(l.text) ||
              (l.portrait &&
                !/^assets\/pilots\/[A-Za-z0-9_-]+\.(png|webp|jpg)$/.test(l.portrait)) ||
              (l.sound &&
                !/^assets\/[A-Za-z0-9_./-]+\.(ogg|mp3|wav)$/.test(l.sound) &&
                !(
                  l.sound.length <= 4300000 &&
                  /^data:audio\/(mpeg|ogg|wav|x-wav);base64,[A-Za-z0-9+/]+=*$/.test(l.sound)
                )) ||
              l.sound?.includes("..")
            )
              fail();
          }
        }
      }
    }
    if (m.rewards) {
      function checkReward(r) {
        if (
          ![r.money, r.supplies].every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 1e9) ||
          !r.inventory ||
          typeof r.inventory !== "object" ||
          Array.isArray(r.inventory) ||
          Object.keys(r.inventory).length > 256
        )
          fail();
        for (const [unitId, count] of Object.entries(r.inventory))
          if (
            !text(unitId, 100) ||
            !Number.isSafeInteger(count) ||
            count < 1 ||
            count > 999 ||
            (G && !Object.keys(G.models).some((key) => key.startsWith(unitId + "__")))
          )
            fail();
      }
      location = "通关奖励";
      checkReward(m.rewards);
      if (
        m.rewards.bonuses !== undefined &&
        (!Array.isArray(m.rewards.bonuses) || m.rewards.bonuses.length > 100)
      )
        fail();
      for (const r of m.rewards.bonuses || []) {
        location = "额外奖励「" + r.event + "」";
        if (!events.has(r.event)) fail();
        checkReward(r);
      }
    }
    return m;
  }
  function settings(G, mapId) {
    const map = G.getMap(mapId || defaultMapId),
      m = validate(map.mission, map, G);
    return {
      mapId: map.id,
      mode: "mission",
      missionEra: m.era,
      technologyLimitMode: "custom",
      technologyLimit: m.technologyLimit,
      costLimit: m.costLimit,
      unitLimit: m.unitLimit,
      formationStyle: "standard",
    };
  }
  function commander(room) {
    const participant = (p) => p && !p.bot && Number.isInteger(p.seat) && p.seat % 2 === 0;
    const host = room.members.get(room.hostId);
    return participant(host) && host.ws?.readyState === 1
      ? host
      : room.seats.find((p) => participant(p) && p.ws?.readyState === 1) ||
          room.seats.find(participant);
  }
  function pilot(G, actor) {
    if (!actor.pilotId) return undefined;
    return G.pilots.custom({
      id: "ace-" + actor.pilotId,
      aceId: actor.pilotId,
      aceGrowthVersion: G.pilots.aceProfile(actor.pilotId).growthVersion,
      level: actor.level || 0,
      experience: 0,
    });
  }
  function spawn(room, G, ids) {
    const m = G.getMap(room.settings.mapId).mission;
    const staged = { ...room.game, units: room.game.units.slice() };
    for (const key of ids) {
      if (staged.units.some((u) => u.missionActor === key)) continue;
      const a = m.actors.find((a) => a.id === key);
      const host = commander(room),
        owner = a.team === 1 ? 1 : host.seat;
      const u = G.makeUnit(
        { unitId: a.unitId, kitId: a.kitId, customPilot: pilot(G, a) },
        owner,
        "mission-" + a.id,
        { x: a.x, y: a.y },
        a.angle ?? (a.team ? 180 : 0),
        room.game.seed,
        1,
        G.getMap(room.settings.mapId).environment,
      );
      Object.assign(u, {
        team: a.team,
        missionActor: a.id,
        missionGroup: a.group,
        missionGuest: a.team === 0,
        deployed: true,
        formationIndex: -1,
        ...(a.team === 1
          ? { missionResourceScale: room.game.mission.enemyResourceScale || 1 }
          : {}),
        ...(a.squad
          ? {
              squadId: "mission-squad-" + a.squad,
              squadSlot: staged.units.filter((u) => u.squadId === "mission-squad-" + a.squad)
                .length,
            }
          : {}),
      });
      const model = G.modelOf(u);
      u.hp = model.hp;
      u.en = model.en;
      if (a.squad) {
        const members = [...staged.units.filter((other) => other.squadId === u.squadId), u];
        if (
          members.length > 6 ||
          !members.every(G.squadEligible) ||
          members.reduce((sum, u) => sum + G.squadCapacity(u, staged), 0) > 6
        )
          throw Error("任务小队超过容量或单位不能编队：" + a.squad);
      }
      const candidates = [];
      for (let y = 0; y < staged.tiles.length; y++)
        for (let x = 0; x < staged.tiles[0].length; x++) candidates.push({ x, y });
      candidates.sort(
        (p, q) =>
          Math.abs(p.x - a.x) + Math.abs(p.y - a.y) - (Math.abs(q.x - a.x) + Math.abs(q.y - a.y)),
      );
      const cell = candidates.find((p) => G.fits(staged, u, p.x, p.y));
      if (!cell) throw Error("任务增援没有合法入场位置：" + a.id);
      Object.assign(u, cell);
      staged.units.push(u);
    }
    room.game.units = staged.units;
  }
  function initialize(room, G) {
    const m = validate(G.getMap(room.settings.mapId).mission, G.getMap(room.settings.mapId), G);
    room.game.units = room.game.units.filter((u) => G.ownerOf(u) !== 1);
    room.game.mission = {
      fired: [],
      protect: [...m.protect],
      dialogue: null,
      serial: 0,
      started: false,
      error: null,
      playerCount: room.seats.filter(
        (p) => p && !p.bot && Number.isInteger(p.seat) && p.seat % 2 === 0,
      ).length,
    };
    room.game.mission.enemyResourceScale =
      1 + Math.max(0, room.game.mission.playerCount - 1) * (m.enemyResourcePerPlayer || 0);
    if (room.game.deployment) room.game.deployment[1] = true;
    spawn(
      room,
      G,
      m.actors.filter((a) => a.initial).map((a) => a.id),
    );
  }
  function condition(room, G, w) {
    const g = room.game,
      s = g.mission,
      actor = g.units.find((u) => u.missionActor === w.actor);
    if (w.type === "start") return !s.started;
    if (w.type === "round") return g.round >= w.round;
    if (w.type === "all") return w.conditions.every((c) => condition(room, G, c));
    if (w.type === "any") return w.conditions.some((c) => condition(room, G, c));
    if (w.type === "actor_destroyed") return !!actor && actor.hp <= 0;
    if (w.type === "event_completed")
      return s.fired.includes(w.event) && s.continuation?.eventId !== w.event;
    if (w.type === "group_destroyed") {
      const group = mActors(room, G).filter((a) => a.group === w.group);
      return (
        group.length > 0 &&
        group.every((a) => g.units.some((u) => u.missionActor === a.id && u.hp <= 0))
      );
    }
    if (w.type === "defeated_group")
      return (
        g.units.filter(
          (u) =>
            u.missionGroup === w.group &&
            u.hp <= 0 &&
            (s.defeatRounds?.[u.missionActor] ?? g.round) <= w.byRound,
        ).length >= w.count
      );
    if (w.type === "actor_hp")
      return !!actor && (actor.hp / G.modelOf(actor).hp) * 100 <= w.percent;
    if (w.type === "enter_region")
      return (
        !!actor &&
        G.onMap(actor) &&
        actor.x >= w.x &&
        actor.y >= w.y &&
        actor.x < w.x + w.width &&
        actor.y < w.y + w.height
      );
    return false;
  }
  function mActors(room, G) {
    return G.getMap(room.settings.mapId).mission.actors;
  }
  function observe(room) {
    const s = room.game.mission;
    if (!s?.fired || room.replay) return;
    s.defeatRounds ||= {};
    for (const u of room.game.units)
      if (u.missionActor && u.hp <= 0 && s.defeatRounds[u.missionActor] === undefined)
        s.defeatRounds[u.missionActor] = room.game.round;
  }
  function poll(room, G, log) {
    const g = room.game,
      s = g.mission;
    if (
      !room.started ||
      room.replay ||
      !s ||
      s.error ||
      s.dialogue ||
      room.playback ||
      room.phase !== "idle" ||
      g.winner !== null
    )
      return;
    const m = G.getMap(room.settings.mapId).mission;
    const dead = (key) => g.units.some((u) => u.missionActor === key && u.hp <= 0);
    const pmc = g.units.filter((u) => u.team === 0 && !u.missionActor);
    if (s.protect.some(dead) || !pmc.some((u) => u.hp > 0)) {
      g.winner = 1;
      room.phase = "finished";
      return;
    }
    function execute(e, from = 0) {
      // Each uninterrupted action segment is atomic. A dialogue suspends the
      // event; actions below it run only after its last line is acknowledged.
      const before = JSON.parse(JSON.stringify(g));
      try {
        for (let i = from; i < e.actions.length; i++) {
          const a = e.actions[i];
          if (a.type === "spawn") spawn(room, G, a.actors);
          if (a.type === "protect") s.protect = [...new Set([...s.protect, ...a.actors])];
          if (a.type === "unprotect") s.protect = s.protect.filter((id) => !a.actors.includes(id));
          if (a.type === "message") {
            s.notice = a.text;
            log("[任务提示] " + a.text);
          }
          if (a.type === "recover")
            for (const u of g.units) {
              if (u.hp <= 0 || !a.actors.includes(u.missionActor)) continue;
              const model = G.modelOf(u);
              u.hp = Math.min(model.hp, u.hp + Math.round((model.hp * a.hpPercent) / 100));
              u.en = Math.min(model.en, u.en + Math.round((model.en * a.enPercent) / 100));
            }
          if (a.type === "victory") s.requestedWinner = 0;
          if (a.type === "defeat") s.requestedWinner = 1;
          if (a.type === "dialogue") {
            s.continuation = { eventId: e.id, nextAction: i + 1 };
            s.dialogue = {
              id: ++s.serial,
              index: 0,
              lines: a.lines.map((l) => {
                const actor = g.units.find((u) => u.missionActor === l.actor);
                return { ...l, ...(actor ? { focus: { x: actor.x, y: actor.y } } : {}) };
              }),
            };
            logLine(room, G, log);
            return false;
          }
        }
        s.continuation = null;
        return true;
      } catch (error) {
        Object.assign(g, before);
        g.mission.error = error.message;
        log("[任务错误] " + error.message);
        return false;
      }
    }
    if (s.continuation) {
      const e = m.events.find((e) => e.id === s.continuation.eventId);
      if (!e || !execute(e, s.continuation.nextAction)) return;
    }
    for (const e of m.events) {
      if (s.fired.includes(e.id) || !condition(room, G, e.when)) continue;
      s.fired.push(e.id);
      log("[任务事件] " + e.name);
      if (!execute(e)) return;
    }
    s.started = true;
    // Explicit protection and PMC extinction take precedence over victory.
    if (s.protect.some(dead) || !pmc.some((u) => u.hp > 0)) g.winner = 1;
    else if (s.requestedWinner !== undefined) g.winner = s.requestedWinner;
    else if (m.victory.type === "all_enemies" && !g.units.some((u) => u.team === 1 && u.hp > 0))
      g.winner = 0;
    else if (m.victory.type === "survive" && g.round >= m.victory.round) g.winner = 0;
    else if (m.victory.type === "defeat_actor" && dead(m.victory.actor)) g.winner = 0;
    if (g.winner !== null) room.phase = "finished";
  }
  function logLine(room, G, log) {
    const d = room.game.mission.dialogue,
      l = d?.lines[d.index];
    if (l) {
      const u = room.game.units.find((u) => u.missionActor === l.actor);
      log("＃ " + l.name + "（" + (u ? G.unitLogName(u) : l.actor) + "）：" + l.text);
    }
  }
  function advance(room, G, dialogueId, index, log) {
    const d = room.game.mission?.dialogue;
    if (!d || d.id !== dialogueId || d.index !== index) throw Error("剧情对话已更新");
    if (++d.index >= d.lines.length) room.game.mission.dialogue = null;
    else logLine(room, G, log);
  }
  function reward(room, G) {
    const rewards = G.getMap(room.settings.mapId).mission.rewards;
    if (!rewards) return null;
    const result = { money: 0, supplies: 0, inventory: {} };
    if (room.game.winner !== 0) return result;
    for (const r of [
      rewards,
      ...(rewards.bonuses || []).filter((r) => room.game.mission.fired.includes(r.event)),
    ]) {
      result.money += r.money;
      result.supplies += r.supplies;
      for (const [id, count] of Object.entries(r.inventory))
        result.inventory[id] = (result.inventory[id] || 0) + count;
    }
    return result;
  }
  return {
    defaultMapId,
    validate,
    settings,
    commander,
    initialize,
    observe,
    poll,
    advance,
    spawn,
    reward,
  };
})();
if (typeof module !== "undefined") module.exports = MissionMode;
