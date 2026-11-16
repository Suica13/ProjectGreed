/* Declarative cooperative missions. Authority owns events and dialogue cursors. */
const MissionMode = (() => {
  "use strict";
  const defaultMapId = "mission_white_base";
  const eraData = typeof TechnologyEras !== "undefined" ? TechnologyEras : require("./technology-eras.js");
  const eras = eraData.eras;
  const text = (v, max = 2000) => typeof v === "string" && v.length > 0 && v.length <= max;
  const id = (v) => typeof v === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(v);
  function validate(m, map, G = null) {
    if (m && typeof m === "object") m.era = eraData.normalize(m.era);
    let location = "关卡设置";
    const fail = () => {
      throw Error("任务脚本配置无效：" + location + "，请检查必填对象、数值和引用");
    };
    if (
      !m ||
      m.version !== 1 ||
      !eras.includes(m.era) ||
      (m.technologyLimitEnabled !== undefined && typeof m.technologyLimitEnabled !== "boolean") ||
      !Number.isSafeInteger(m.technologyLimit) ||
      m.technologyLimit < 0 ||
      m.technologyLimit > 1e9 ||
      !Number.isInteger(m.costLimit) ||
      m.costLimit < 500 ||
      m.costLimit > 1e6 ||
      !Number.isInteger(m.unitLimit) ||
      m.unitLimit < 1 ||
      m.unitLimit > 72 ||
      (m.fleetLimit !== undefined && (!Number.isInteger(m.fleetLimit) || m.fleetLimit < 1 || m.fleetLimit > 6)) ||
      !Array.isArray(m.actors) ||
      m.actors.length > 768 ||
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
        (a.facilityLevel !== undefined && (!Number.isInteger(a.facilityLevel) || a.facilityLevel<1 || a.facilityLevel>4)) ||
        (a.autonomous !== undefined && typeof a.autonomous !== "boolean") ||
        (a.stationary !== undefined && typeof a.stationary !== "boolean") ||
        (a.genericPilot !== undefined && !["veteran", "elite", "ace", "enhanced"].includes(a.genericPilot)) ||
        (a.genericPilot && a.pilotId) ||
        (a.squad && !id(a.squad)) ||
        (a.attackGroup !== undefined && !id(a.attackGroup))
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
        a.attackGroup && m.actors.some(b => b.attackGroup === a.attackGroup && b.team !== a.team)
      ) fail();
      if (
        G &&
        (!G.models[a.unitId + "__" + a.kitId] || (a.pilotId && !G.pilots.aceProfile(a.pilotId)))
      )
        fail();
      actors.add(a.id);
    }
    for (const a of m.actors) {
      if (a.carrier !== undefined && (!actors.has(a.carrier) || a.carrier === a.id ||
          m.actors.find(b => b.id === a.carrier).team !== a.team ||
          m.actors.find(b => b.id === a.carrier).initial !== a.initial)) fail();
      const chain = new Set([a.id]);
      let parent = a;
      while (parent.carrier) {
        if (chain.has(parent.carrier)) fail();
        chain.add(parent.carrier);
        parent = m.actors.find(b => b.id === parent.carrier);
        if (!parent) fail();
      }
    }
    location = "胜败条件";
    if (!Array.isArray(m.protect) || m.protect.some((a) => !actors.has(a))) fail();
    if (!["all_enemies", "survive", "defeat_actor", "escort", "scripted", "eliminate_group", "extract", "defend_group"].includes(m.victory?.type)) fail();
    if (m.victory.type === "defend_group" &&
        (!Number.isInteger(m.victory.round) || m.victory.round<1 ||
         !m.actors.some(a=>a.team===0 && a.initial && a.group===m.victory.group))) fail();
    if (m.victory.type === "eliminate_group" &&
        (!m.actors.some(a=>a.team===1 && a.group===m.victory.group) ||
         (m.victory.label !== undefined && !text(m.victory.label,100)))) fail();
    if(m.initialChoices!==undefined && (!Array.isArray(m.initialChoices) || m.initialChoices.length>8 ||
        new Set(m.initialChoices.map(c=>c.group)).size!==m.initialChoices.length ||
        m.initialChoices.some(c=>!id(c.group) || !Number.isInteger(c.count) || c.count<1 ||
          c.count>m.actors.filter(a=>a.group===c.group && !a.initial && !a.carrier).length ||
          m.actors.some(a=>a.group===c.group && (a.initial || a.carrier))))) fail();
    if(m.clock!==undefined && (!Number.isInteger(m.clock.dawnRound) || m.clock.dawnRound<2 || m.clock.dawnRound>999))fail();
    if(m.victory.type==="extract"){
      const v=m.victory,r=v.region;
      if(!m.actors.some(a=>a.team===1 && a.group===v.group) || !Number.isInteger(v.deadlineRound) || v.deadlineRound<1 ||
          !r || ![r.x,r.y,r.width,r.height].every(Number.isInteger) || r.x<0 || r.y<0 || r.width<1 || r.height<1 ||
          r.x+r.width>map.width || r.y+r.height>map.height)fail();
    }
    if (m.fixedNight !== undefined && typeof m.fixedNight!=="boolean") fail();
    if (m.fixedTime !== undefined && !["dawn","morning","noon","afternoon","dusk","evening","late_night","pre_dawn"].includes(m.fixedTime)) fail();
    if (m.cover !== undefined && !/^assets\/maps\/covers\/[A-Za-z0-9_-]+\.(png|jpg|webp)$/.test(m.cover)) fail();
    if (m.victory.type === "scripted" &&
        (!m.actors.some(a=>a.group===m.victory.group) || !id(m.victory.choiceEvent) || !id(m.victory.continueOption))) fail();
    if (m.victory.type === "escort") {
      const v = m.victory;
      if (!actors.has(v.actor) || !m.protect.includes(v.actor) ||
          !m.actors.some(a=>a.id===v.actor && a.team===0 && a.initial && !a.carrier) ||
          !Number.isInteger(v.holdRounds) || v.holdRounds < 1 ||
          ![v.x,v.y,v.width,v.height].every(Number.isInteger) ||
          v.x < 0 || v.y < 0 || v.width < 1 || v.height < 1 ||
          v.x+v.width > map.width || v.y+v.height > map.height ||
          !Array.isArray(v.route) || !v.route.length || v.route.length > 100 ||
          v.route.some(p=>!Number.isInteger(p.x) || !Number.isInteger(p.y) ||
            p.x<0 || p.y<0 || p.x>=map.width || p.y>=map.height)) fail();
    }
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
            "group_escaped",
            "group_alive",
            "event_completed",
            "choice_selected",
            "all_enemies_destroyed",
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
        if (w.type === "choice_selected" && !m.events.some(e=>e.id===w.event &&
            e.actions.some(a=>a.type==="choice" && a.options?.some(o=>o.id===w.option)))) fail();
        if (["group_destroyed","group_escaped"].includes(w.type) && !m.actors.some((a) => a.group === w.group)) fail();
        if (w.type === "group_alive" && (!m.actors.some(a=>a.group===w.group) ||
            !Number.isInteger(w.count) || w.count<1 || w.count>m.actors.filter(a=>a.group===w.group).length)) fail();
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
            "choice",
            "protect",
            "unprotect",
            "recover",
            "withdraw",
            "extend_time",
            "open_extraction",
            "scripted_attack",
            "message",
            "victory",
            "defeat",
          ].includes(a.type)
        )
          fail();
        if (
          ["spawn", "protect", "unprotect", "recover", "scripted_attack", "withdraw"].includes(a.type) &&
          (!Array.isArray(a.actors) || a.actors.some((v) => !actors.has(v)))
        )
          fail();
        if (a.type === "scripted_attack" &&
          (!actors.has(a.actor) || !a.actors.length || a.actors.includes(a.actor) ||
            a.actors.some(key => m.actors.find(v=>v.id===key).team === m.actors.find(v=>v.id===a.actor).team))) fail();
        if (
          a.type === "recover" &&
          ![a.hpPercent, a.enPercent].every((v) => Number.isFinite(v) && v >= 0 && v <= 100)
        )
          fail();
        if (a.type === "extend_time" && (!Number.isInteger(a.rounds) || a.rounds<1 || a.rounds>100 || m.victory.type!=="extract"))fail();
        if (a.type === "open_extraction" && m.victory.type!=="extract")fail();
        if (a.type === "withdraw" && (a.edge !== "right" || !a.actors.length ||
            a.actors.some(key=>m.actors.find(actor=>actor.id===key).team!==1))) fail();
        if (a.type === "message" && !text(a.text)) fail();
        if (a.type === "choice" && (!text(a.name,100) || !text(a.text) ||
            !Array.isArray(a.options) || a.options.length<2 || a.options.length>4 ||
            a.options.some(o=>!id(o.id) || !text(o.text,200)) ||
            new Set(a.options.map(o=>o.id)).size!==a.options.length ||
            e.actions.filter(other=>other.type==="choice").length!==1)) fail();
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
    if (m.victory.type === "scripted" && !m.events.some(e=>e.id===m.victory.choiceEvent &&
        e.actions.some(a=>a.type==="choice" && a.options.some(o=>o.id===m.victory.continueOption)))) fail();
    if (m.landmarks !== undefined && (!Array.isArray(m.landmarks) || m.landmarks.length>10 ||
        m.landmarks.some(l=>!["mass_driver","base_compound"].includes(l.type) || ![l.x,l.y,l.width,l.height].every(Number.isInteger) ||
          l.x<0 || l.y<0 || l.width<2 || l.height<2 || l.x+l.width>map.width || l.y+l.height>map.height))) fail();
    if (m.rewards) {
      function checkReward(r) {
        if (
          ![r.money, r.supplies].every((v) => Number.isSafeInteger(v) && v >= 0 && v <= 1e9) ||
          (r.technology!==undefined && (!Number.isSafeInteger(r.technology) || r.technology<0 || r.technology>1e9)) ||
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
      if (m.rewards.outcomes !== undefined && (!Array.isArray(m.rewards.outcomes) || m.rewards.outcomes.length>100)) fail();
      for (const r of [...(m.rewards.bonuses || []),...(m.rewards.outcomes || [])]) {
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
      missionTechnologyLimitEnabled: m.technologyLimitEnabled !== false,
      technologyLimitMode: "custom",
      technologyLimit: m.technologyLimit,
      costLimit: m.costLimit,
      unitLimit: m.unitLimit,
      missionFleetLimit: m.fleetLimit ?? 3,
      formationStyle: "standard",
      ...(m.fixedTime || m.fixedNight || m.clock ? {dayNight:m.clock?"map":m.fixedTime || "late_night",timeCycle:false,weather:"clear",weatherCycle:false} : {}),
      bannedFactions: [],
      bannedEras: [],
      bannedTypes: [],
      teamRestrictions: [{ bannedFactions: [], bannedEras: [], bannedTypes: [] }, { bannedFactions: [], bannedEras: [], bannedTypes: [] }],
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
        owner = a.team === 1 ? 1 : a.autonomous ? room.missionAllySeat : host.seat;
      const u = G.makeUnit(
        { unitId: a.unitId, kitId: a.kitId, customPilot: pilot(G, a),
          ...(a.genericPilot ? {pilotId:"generic:"+a.genericPilot} : {}) },
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
        ...(a.attackGroup ? { missionAttackGroup: a.attackGroup } : {}),
        missionGuest: a.team === 0,
        ...(a.autonomous ? {missionAutonomous:true} : {}),
        ...(a.stationary ? {missionStationary:true,moved:true} : {}),
        ...(m.victory.type === "escort" && m.victory.actor === a.id ? { missionEscort: true } : {}),
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
      if (model.facilityType) u.facility = {id:a.id,type:model.facilityType,level:a.facilityLevel || 1,cycle:0};
      u.hp = G.modelOf(u).hp;
      u.en = G.modelOf(u).en;
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
    // Cargo is assigned only after all carriers in this reinforcement batch exist.
    for (const key of ids) {
      const a = m.actors.find(a=>a.id === key);
      if (!a.carrier) continue;
      const u = staged.units.find(u=>u.missionActor === key);
      if (u.embarked) continue;
      const carrier = staged.units.find(u=>u.missionActor === a.carrier && u.hp > 0);
      const hangar = carrier && G.hangars.of(carrier).find(h=>
        G.hangars.canLoad(staged,u,carrier,h.id));
      if (!hangar) throw Error("任务增援无法预先搭载：" + a.id);
      delete u.squadId;
      delete u.squadSlot;
      u.embarked = { carrierId: carrier.id, hangarId: hangar.id,
        ...(hangar.kind === "sfs" ? { exposed: true } : {}) };
      u.moved = false;
      u.acted = false;
    }
    G.hangars.sync(staged);
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
    const chosen=[];
    let random=room.game.seed>>>0;
    for(const choice of m.initialChoices || []){
      const pool=m.actors.filter(a=>a.group===choice.group).map(a=>a.id);
      for(let i=pool.length-1;i>0;i--){random=(Math.imul(random,1664525)+1013904223)>>>0;const j=random%(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
      chosen.push(...pool.slice(0,choice.count));
    }
    room.game.mission.selectedActors=chosen;
    if(m.victory.type==="extract")room.game.mission.deadlineRound=m.victory.deadlineRound;
    spawn(room,G,[...m.actors.filter(a=>a.initial).map(a=>a.id),...chosen]);
  }
  function condition(room, G, w) {
    const g = room.game,
      s = g.mission,
      actor = g.units.find((u) => u.missionActor === w.actor);
    if (w.type === "start") return !s.started;
    if (w.type === "choice_selected") return s.choices?.[w.event] === w.option;
    if (w.type === "all_enemies_destroyed") return !g.units.some(u=>u.team===1 && u.hp>0 && !u.missionEscaped);
    if (w.type === "group_escaped") return g.units.some(u=>u.missionGroup===w.group && u.missionEscaped);
    if (w.type === "group_alive") return g.units.filter(u=>u.missionGroup===w.group && u.hp>0).length>=w.count;
    if (w.type === "round") return g.round >= w.round;
    if (w.type === "all") return w.conditions.every((c) => condition(room, G, c));
    if (w.type === "any") return w.conditions.some((c) => condition(room, G, c));
    if (w.type === "actor_destroyed") return !!actor && actor.hp <= 0;
    if (w.type === "event_completed")
      return s.fired.includes(w.event) && s.continuation?.eventId !== w.event;
    if (w.type === "group_destroyed") {
      const group = expectedActors(room,G,w.group);
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
  function expectedActors(room,G,group){
    const m=G.getMap(room.settings.mapId).mission;
    return m.actors.filter(a=>a.group===group &&
      (!m.initialChoices?.some(c=>c.group===group) || room.game.mission.selectedActors.includes(a.id)));
  }
  function extractionProgress(g,region,G){
    const units=g.units.filter(u=>u.team===0 && u.hp>0),byId=new Map(g.units.map(u=>[u.id,u]));
    const inside=u=>{
      const visited=new Set();
      while(u?.embarked){if(visited.has(u.id))return false;visited.add(u.id);u=byId.get(u.embarked.carrierId);}
      return !!u && G.onMap(u) && G.cells(u).every(p=>p.x>=region.x && p.y>=region.y && p.x<region.x+region.width && p.y<region.y+region.height);
    };
    return {current:units.filter(inside).length,total:units.length};
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
      s.choice ||
      room.playback ||
      room.phase !== "idle" ||
      g.winner !== null
    )
      return;
    const m = G.getMap(room.settings.mapId).mission;
    if(m.clock){
      g.climateSettings.dayNight=g.round>=m.clock.dawnRound?"dawn":"late_night";
      g.climateSettings.timeCycle=false;
    }
    for(const actor of g.units)if(actor.missionStationary)actor.moved=true;
    const dead = (key) => g.units.some((u) => u.missionActor === key && u.hp <= 0);
    const pmc = g.units.filter((u) => u.team === 0 && !u.missionActor);
    const defendedGroupLost = m.victory.type === "defend_group" &&
      !g.units.some(u=>u.missionGroup===m.victory.group && u.hp>0);
    if (s.protect.some(dead) || defendedGroupLost || !pmc.some((u) => u.hp > 0)) {
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
          if (a.type === "extend_time")s.deadlineRound+=a.rounds;
          if (a.type === "open_extraction")s.extractionOpen=true;
          if (a.type === "withdraw") for (const u of g.units) {
            if (!a.actors.includes(u.missionActor) || u.hp<=0 || u.missionEscaped) continue;
            u.missionWithdrawal={edge:a.edge};
            delete u.plan; delete u.pendingMove;
          }
          if (a.type === "scripted_attack") {
            const source = g.units.find(u=>u.missionActor===a.actor && u.hp>0);
            if (!source) throw Error("剧情攻击单位尚未出现或已被击坠：" + a.actor);
            const victims = g.units.filter(u=>a.actors.includes(u.missionActor) && u.hp>0);
            const weapon = G.modelOf(source).weapons.find(w=>w.projectile) || G.modelOf(source).weapons[0];
            const actors = JSON.parse(JSON.stringify([source,...victims]));
            const hits = victims.map(u=>({to:u.id,unitId:u.id,before:u.hp,after:0,damage:u.hp,hit:true}));
            for (const u of victims) u.hp=0;
            G.hangars?.evacuate(g);
            s.cinematic = {id:++s.serial,unitId:source.id,model:source.model,from:G.center(source),
              targets:victims.map(G.center),actors,hits,projectile:weapon?.projectile,
              sound:weapon?.sound,weaponDisplayIndex:weapon?.attack?.steps?.[0]?.weaponDisplayIndex,
              clip:weapon?.clip || "Common_Shoot_A"};
            log("[任务演出] " + G.unitLogName(source) + "击破" + victims.length + "台敌机。");
          }
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
          if (a.type === "choice") {
            s.continuation = {eventId:e.id,nextAction:i+1};
            s.choice = {id:++s.serial,eventId:e.id,name:a.name,text:a.text,options:a.options};
            log("[任务选择] " + a.name + "：" + a.text);
            return false;
          }
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
    // Retreat is an actual AI move. Reaching the edge starts a one-round grace
    // period: the target remains attackable until the following displayed round.
    for (const u of g.units) {
      if (!u.missionWithdrawal || u.hp<=0 || u.missionEscaped || !G.onMap(u)) continue;
      const edge=G.cells(u).some(p=>p.x===g.tiles[0].length-1);
      if (!edge) { delete u.missionWithdrawal.edgeRound; continue; }
      u.missionWithdrawal.edgeRound ??= g.round;
      if (g.round<=u.missionWithdrawal.edgeRound) continue;
      u.missionEscaped=true;
      u.deploymentStaged=true;
      u.acted=u.moved=true;
      delete u.plan; delete u.pendingMove;
      log("[任务撤离] "+G.unitLogName(u)+"离开了战场。");
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
    if (m.victory.type === "escort") {
      const v = m.victory;
      const escort = g.units.find(u=>u.missionActor === v.actor);
      const progress = s.escort ||= { step: 0, lastRound: 0, arrivedRound: null };
      if (escort?.hp > 0) {
        if (progress.lastRound !== g.round) {
          progress.lastRound = g.round;
          const next = v.route[progress.step];
          if (next) {
            try {
              escort.moved = false;
              escort.acted = false;
              // Round numbers count team phases. Scripted escorts advance once
              // per displayed round, independently of which team is acting.
              G.move({ ...g, team: escort.team }, escort, next.x, next.y, true);
              escort.origin = null;
              progress.step++;
              log("[任务护送] " + G.modelOf(escort).name + "推进：" + progress.step + "/" + v.route.length);
            } catch {
              log("[任务护送] 护送路线受阻，请清理前方道路。");
            }
          }
          const inside = escort.x >= v.x && escort.y >= v.y &&
            escort.x < v.x+v.width && escort.y < v.y+v.height;
          if (!inside) progress.arrivedRound = null;
          else if (progress.arrivedRound === null) progress.arrivedRound = g.round;
          if (inside && g.round >= progress.arrivedRound + v.holdRounds) s.requestedWinner = 0;
        }
        escort.moved = true;
        escort.acted = true;
      }
      if (v.eliminateAll && m.actors.filter(a=>a.team === 1).every(a=>dead(a.id)))
        s.requestedWinner = 0;
    }
    if(m.victory.type==="extract"){
      if(g.round>s.deadlineRound)s.requestedWinner=1;
      else if(s.extractionOpen){
        const progress=extractionProgress(g,m.victory.region,G);
        if(progress.total>0 && progress.current===progress.total)s.requestedWinner=0;
      }
    }
    // Explicit protection and PMC extinction take precedence over victory.
    if (s.protect.some(dead) || (m.victory.type === "defend_group" &&
        !g.units.some(u=>u.missionGroup===m.victory.group && u.hp>0)) || !pmc.some((u) => u.hp > 0)) g.winner = 1;
    else if (s.requestedWinner !== undefined) g.winner = s.requestedWinner;
    else if (m.victory.type === "all_enemies" && !g.units.some((u) => u.team === 1 && u.hp > 0))
      g.winner = 0;
    else if (m.victory.type === "eliminate_group" &&
        g.units.some(u=>u.missionGroup===m.victory.group && u.missionEscaped) &&
        !g.units.some(u=>u.team===1 && u.hp>0 && !u.missionEscaped)) g.winner=0;
    else if (m.victory.type === "survive" && g.round >= m.victory.round) g.winner = 0;
    else if (m.victory.type === "defend_group" && g.round >= m.victory.round) g.winner = 0;
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
    const selected = [...(rewards.outcomes || [])].reverse().find(r=>room.game.mission.fired.includes(r.event)) || rewards;
    for (const r of [
      selected,
      ...(rewards.bonuses || []).filter((r) => room.game.mission.fired.includes(r.event)),
    ]) {
      result.money += r.money;
      result.supplies += r.supplies;
      for (const [id, count] of Object.entries(r.inventory))
        result.inventory[id] = (result.inventory[id] || 0) + count;
    }
    return result;
  }
  function technologyReward(room,G){
    if(room.game.winner!==0)return 0;
    const rewards=G.getMap(room.settings.mapId).mission.rewards;
    if(!rewards)return 0;
    const selected=[...(rewards.outcomes || [])].reverse().find(r=>room.game.mission.fired.includes(r.event)) || rewards;
    return (selected.technology || 0)+(rewards.bonuses || []).filter(r=>room.game.mission.fired.includes(r.event)).reduce((sum,r)=>sum+(r.technology || 0),0);
  }
  function choose(room, G, choiceId, optionId, log) {
    const state=room.game.mission, choice=state?.choice;
    const option=choice?.options.find(o=>o.id===optionId);
    if (!choice || choice.id!==choiceId || !option) throw Error("任务选择已更新或选项无效");
    state.choices={...state.choices,[choice.eventId]:option.id};
    state.choice=null;
    log("[任务选择] " + choice.name + "：" + option.text);
  }
  function objectives(game, G) {
    const mission = G.getMap(game.mapId).mission;
    const state = game.mission;
    if (!mission || !state?.protect) return null;
    const actor = key => game.units.find(u=>u.missionActor === key);
    const row = (kind, current, total, unitId) => ({kind,current,total,...(unitId?{unitId}:{})});
    const target = mission.victory, victory = [];
    if(target.type==="extract"){
      const group=expectedActors({game,settings:{mapId:game.mapId}},G,target.group);
      victory.push({...row("group_targets",group.filter(a=>actor(a.id)?.hp<=0).length,group.length),label:"摧毁目标米迪亚"});
      const progress=extractionProgress(game,target.region,G);
      victory.push({...row("extraction",state.extractionOpen?progress.current:0,progress.total),label:"全部存活单位撤离"});
      victory.push({...row("survive",Math.min(game.round,state.deadlineRound),state.deadlineRound),label:"任务时限"});
    } else if (target.type === "eliminate_group") {
      const escaped=game.units.some(u=>u.missionGroup===target.group && u.missionEscaped);
      const targets=escaped?game.units.filter(u=>u.team===1 && !u.missionEscaped):
        mission.actors.filter(a=>a.group===target.group).map(a=>actor(a.id));
      victory.push({...row(escaped?"all_enemies":"group_targets",targets.filter(u=>u && u.hp<=0).length,targets.length),
        ...(!escaped?{label:target.label || "消灭目标单位"}:{})});
    } else if (target.type === "scripted" && state.choices?.[target.choiceEvent] !== target.continueOption) {
      const main=mission.actors.filter(a=>a.group===target.group);
      victory.push(row("main_force",main.filter(a=>actor(a.id)?.hp<=0).length,main.length));
    } else if (["all_enemies","scripted"].includes(target.type)) {
      const enemies = game.units.filter(u=>u.team===1);
      victory.push(row("all_enemies",enemies.filter(u=>u.hp<=0).length,enemies.length));
    } else if (target.type === "escort") {
      const source = mission.actors.find(a=>a.id===target.actor);
      victory.push(row("escort",Math.min(target.route.length,state.escort?.step || 0),target.route.length,source.unitId));
      const held = state.escort?.arrivedRound == null ? 0 : Math.max(0,game.round-state.escort.arrivedRound);
      victory.push(row("hold",Math.min(target.holdRounds,held),target.holdRounds));
    } else if (target.type === "defend_group") {
      victory.push({...row("survive",Math.min(game.round,target.round),target.round),label:"坚持至发射准备完成"});
      const defended=game.units.filter(u=>u.missionGroup===target.group);
      victory.push({...row("defended",defended.filter(u=>u.hp>0).length,defended.length),label:"剩余穿梭机"});
    } else if (target.type === "survive") {
      victory.push(row("survive",Math.min(game.round,target.round),target.round));
    } else {
      victory.push(row("defeat_actor",actor(target.actor)?.hp<=0?1:0,1,
        mission.actors.find(a=>a.id===target.actor).unitId));
    }
    const pmc = game.units.filter(u=>u.team===0 && !u.missionActor);
    const failure = [row("pmc_destroyed",pmc.filter(u=>u.hp<=0).length,pmc.length)];
    if(target.type==="defend_group"){
      const defended=game.units.filter(u=>u.missionGroup===target.group);
      failure.push({...row("protected_destroyed",defended.filter(u=>u.hp<=0).length,defended.length),label:"穿梭机全部被击毁"});
    }
    for (const key of state.protect) {
      const source = mission.actors.find(a=>a.id===key);
      failure.push(row("protected_destroyed",actor(key)?.hp<=0?1:0,1,source.unitId));
    }
    return {victory,failure};
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
    choose,
    spawn,
    reward,
    technologyReward,
    objectives,
  };
})();
if (typeof module !== "undefined") module.exports = MissionMode;
