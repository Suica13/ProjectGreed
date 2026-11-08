/* Reusable battlefield objectives. All mutation runs in the authoritative rules. */
"use strict";
const BattlefieldMode = (() => {
  const defaultMapId = "battlefield_frontline";
  const captureRadius = 2;
  const facilityIds = Object.freeze({
    base: "Facility_HQ",
    machineGun: "Facility_MG",
    beam: "Facility_Beam",
    missile: "Facility_Missile",
    cannon: "Facility_Cannon",
    radar: "Facility_Radar",
  });
  const factions = ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"];
  const eras = ["0079T1", "0079T2", "0087T1", "0087T2"];
  const eraStrength = Object.freeze({"0079T1":20000,"0079T2":30000,"0087T1":45000,"0087T2":60000});
  function roomEra(settings) {
    const era = settings.battlefieldEra ?? "custom";
    if (era !== "custom" && !eras.includes(era)) throw Error("战场年代设置无效");
    return era;
  }
  function validateRoomSelection(settings) {
    const era = roomEra(settings);
    if (era !== "custom" && (!roomPreset(settings) ||
        settings.battlefieldTeams.some(team => team.era !== era)))
      throw Error("固定年代必须使用对应年代和作战规模模板");
    return era;
  }
  const factionEras = faction => ["EFSF","ZEON"].includes(faction) ? eras.slice(0,2) : eras.slice(2);
  // PMC limits and entry pay only: faction AI waves keep their own era rules.
  const legacyRoomPresets = [
    {id:"0079T1-small",era:"0079T1",name:"小规模",costLimit:4000,unitCostLimit:500,unitLimit:24,money:2250,supplies:4500},
    {id:"0079T1-standard",era:"0079T1",name:"标准规模",costLimit:10000,unitCostLimit:1000,unitLimit:36,money:3750,supplies:7500},
    {id:"0079T1-large",era:"0079T1",name:"大规模",costLimit:20000,unitCostLimit:2000,unitLimit:48,money:6000,supplies:12000},
    {id:"0079T2-small",era:"0079T2",name:"小规模",costLimit:6000,unitCostLimit:1000,unitLimit:24,money:3750,supplies:7500},
    {id:"0079T2-standard",era:"0079T2",name:"标准规模",costLimit:15000,unitCostLimit:2000,unitLimit:36,money:6000,supplies:12000},
    {id:"0079T2-large",era:"0079T2",name:"大规模",costLimit:30000,unitCostLimit:3000,unitLimit:48,money:9000,supplies:18000},
  ];
  const roomPresets = Object.freeze([
    ...legacyRoomPresets,
    ...legacyRoomPresets.map(preset => ({
      ...preset, id:preset.id.replace("0079","0087"), era:preset.era.replace("0079","0087"),
      costLimit:preset.costLimit*1.5, unitCostLimit:preset.unitCostLimit*1.5,
      money:preset.money*1.5, supplies:preset.supplies*1.5,
    })),
  ].map(Object.freeze));
  function roomPreset(settings) {
    if (settings.mode !== "battlefield") return null;
    return roomPresets.find(preset =>
      ["costLimit","unitCostLimit","unitLimit"].every(key => settings[key] === preset[key]) &&
      settings.battlefieldTeams?.length === 2 && settings.battlefieldTeams.every(team => team.era === preset.era)) || null;
  }
  function presetSettings(id, currentTeams, availableEras = []) {
    const preset = roomPresets.find(preset => preset.id === id);
    if (!preset) throw Error("雇佣兵战争规模预设无效");
    const eraIndex = eras.indexOf(preset.era);
    const defaults = eraIndex >= 2 ? ["AEUG","TITANS"] : ["EFSF","ZEON"];
    return {
      battlefieldEra:preset.era,
      costLimit:preset.costLimit,unitCostLimit:preset.unitCostLimit,unitLimit:preset.unitLimit,
      bannedEras:availableEras.filter(era => {
        const order = ["0079T1","0079T2","0083","0087T1","0087T2"].indexOf(era);
        return order < 0 || order > ["0079T1","0079T2","0083","0087T1","0087T2"].indexOf(preset.era);
      }),
      battlefieldTeams:(currentTeams || defaults.map(faction=>({faction}))).map((team,index) => ({
        faction:factionEras(team.faction).includes(preset.era) && factions.includes(team.faction) ? team.faction : defaults[index],era:preset.era,
      })),
    };
  }
  function baseReward(settings, team) {
    const era = settings.battlefieldTeams?.[team]?.era || "0079T2";
    const points = [{costLimit:0,money:0}, ...roomPresets.filter(preset => preset.era === era)];
    const maximum = points.at(-1);
    const cost = Math.max(0,Math.min(maximum.costLimit,Number(settings.costLimit) || 0));
    const upper = points.findIndex(point => point.costLimit >= cost);
    const lower = points[Math.max(0,upper-1)], next = points[upper];
    const money = lower.costLimit === next.costLimit ? lower.money : Math.floor(
      lower.money + (cost-lower.costLimit)*(next.money-lower.money)/(next.costLimit-lower.costLimit));
    return {money,supplies:money*2};
  }
  const affiliated = (model, faction) =>
    (model.availableFactions || [model.faction]).includes(faction);
  const erasForFaction = (G, faction) =>
    factionEras(faction).filter((era) =>
      Object.values(G.models).some(
        (model) =>
          !model.formOnly &&
          !model.wip &&
          !model.disabled &&
          affiliated(model, faction) &&
          model.tags.includes(era),
      ),
    );
  function teams(
    G,
    input = [
      { faction: "EFSF", era: "0079T2" },
      { faction: "ZEON", era: "0079T2" },
    ],
  ) {
    if (!Array.isArray(input) || input.length !== 2) throw Error("雇佣兵战争模式需要两支阵营 AI");
    return input.map((item) => {
      if (!item || !factions.includes(item.faction) || !eras.includes(item.era))
        throw Error("雇佣兵战争模式 AI 阵营或年代无效");
      if (!factionEras(item.faction).includes(item.era)) throw Error("所选阵营不属于该年代");
      const available = Object.values(G.models).some(
        (model) =>
          !model.disabled &&
          !model.wip &&
          !model.formOnly &&
          affiliated(model, item.faction) &&
          model.tags.includes(item.era),
      );
      if (!available) throw Error("所选阵营在该年代没有可用单位");
      return { faction: item.faction, era: item.era };
    });
  }
  function validateMap(map) {
    const config = map.battlefield;
    const location = (item) =>
      item &&
      typeof item.id === "string" &&
      Number.isInteger(item.x) &&
      Number.isInteger(item.y) &&
      item.x >= 0 &&
      item.y >= 0 &&
      item.x + 3 <= map.width &&
      item.y + 3 <= map.height;
    if (
      !config ||
      !Number.isSafeInteger(config.maxRounds) ||
      config.maxRounds < 1 ||
      config.maxRounds > 1000 ||
      !Number.isSafeInteger(config.strength) ||
      config.strength < 1 ||
      !Number.isSafeInteger(config.reinforcementInterval) ||
      config.reinforcementInterval < 1 ||
      !Array.isArray(config.facilities) ||
      !Array.isArray(config.points) ||
      config.facilities.some(
        (item) => !location(item) || !facilityIds[item.type] || ![0, 1].includes(item.team),
      ) ||
      config.points.some((item) => !location(item)) ||
      new Set([...config.facilities, ...config.points].map((item) => item.id)).size !==
        config.facilities.length + config.points.length ||
      ![0, 1].every((team) =>
        config.facilities.some((item) => item.type === "base" && item.team === team),
      )
    )
      throw Error("战地地图设施、据点或战力配置无效");
    return config;
  }
  function facilities(G, game, settings = {}) {
    const config = validateMap(G.getMap(game.mapId));
    const selections = teams(G,settings.battlefieldTeams);
    const indices = [0, 0];
    return config.facilities.map((item) => {
      const actor = G.makeUnit(
        { unitId: facilityIds[item.type], kitId: "standard" },
        item.team,
        "facility-" + item.id,
        item,
        0,
        game.seed || 1,
      );
      actor.facility = { id: item.id, type: item.type };
      if (["machineGun","beam","missile","cannon"].includes(item.type)) {
        actor.facility.level = eras.indexOf(selections[item.team].era)+1;
        actor.hp = G.modelOf(actor).hp;
      }
      actor.formationIndex = indices[item.team]++;
      return actor;
    });
  }
  function initialize(G, game, settings) {
    const config = validateMap(G.getMap(game.mapId));
    const selections = teams(G, settings.battlefieldTeams);
    const maximum = selections.map(team => eraStrength[team.era]);
    // Fixed faction seats are supplied entirely by the wave table, including wave one.
    game.units = game.units.filter(unit => unit.facility || G.ownerOf(unit) >= 2);
    game.battlefield = {
      teams: selections,
      maxRounds: config.maxRounds,
      maximum: maximum.slice(),
      strength: maximum.slice(),
      losses: [0, 0],
      controlLosses: [0, 0],
      lastControlRound: 0,
      baseDamage: [0, 0],
      initialBaseHP: [0, 0],
      baseHP: {},
      defeated: {},
      completed: 0,
      wave: 0,
      reinforcementQueue: [],
      nextUnit: 1,
      reserves: game.units.filter((unit) => !unit.facility && G.ownerOf(unit) >= 2).map((unit) => {
        const model = G.models[unit.deploymentModel] || G.modelOf(unit);
        return {
          id: String(unit.id), ownerSeat: G.ownerOf(unit), team: unit.team,
          formationIndex: unit.formationIndex, unitId: model.prefabId, kitId: model.kitId,
          template: { pilot: structuredClone(unit.pilot), performance: unit.performance,
            environment: unit.environment, angle: unit.angle },
          readyRound: null, request: null, losses: 0,
        };
      }),
      lastReinforcementRound: 0,
      reinforcementInterval: config.reinforcementInterval,
      maxAIUnits: config.maxAIUnits || 120,
      nextFormationIndex: [0, 1].map((team) =>
        Math.max(
          0,
          ...game.units
            .filter((unit) => unit.team === team && unit.ownerSeat === team)
            .map((unit) => (unit.formationIndex || 0) + 1),
        ),
      ),
      points: config.points.map((point) => ({ ...point, owner: null })),
    };
    for (const unit of game.units.filter((unit) => unit.facility?.type === "base")) {
      game.battlefield.initialBaseHP[unit.team] += unit.hp;
      game.battlefield.baseHP[unit.id] = unit.hp;
    }
    if (!game.deployment?.some(ready => !ready)) reinforce(G, game);
  }
  function unrepairable(game, unit) {
    return !!game.battlefield && unit.facility?.type === "base";
  }
  function sync(G, game) {
    const state = game.battlefield;
    if (!state) return;
    if (!state.wave && !game.deployment?.some(ready => !ready)) reinforce(G, game);
    const livingFormations = new Map();
    for (const unit of game.units) {
      if (unrepairable(game, unit)) {
        const before = state.baseHP[unit.id];
        unit.hp = Math.min(unit.hp, before);
        state.baseDamage[unit.team] += before - Math.max(0, unit.hp);
        state.baseHP[unit.id] = Math.max(0, unit.hp);
      }
      if (unit.hp > 0) {
        const owner = G.ownerOf(unit);
        if (!livingFormations.has(owner)) livingFormations.set(owner, new Set());
        livingFormations.get(owner).add(unit.formationIndex);
      }
      if (unit.hp <= 0 && !state.defeated[unit.id]) {
        state.defeated[unit.id] = true;
        if (unit.facility?.type !== "base")
          state.losses[unit.team] +=
            G.modelOf(unit).cost + (unit.pilot?.custom ? G.pilots.cost(unit.pilot) : 0);
      }
    }
    for (const reserve of state.reserves || []) {
      // Escape forms retain the formation index: repair only when all surviving
      // components of this roster slot have been destroyed.
      const alive = livingFormations.get(reserve.ownerSeat)?.has(reserve.formationIndex);
      if (!alive && reserve.readyRound === null) {
        const pricing = typeof Economy !== "undefined" ? Economy : require("./economy.js");
        reserve.losses = (reserve.losses || 0) + 1;
        reserve.repairTurns = pricing.productionTiming(reserve.unitId, reserve.kitId).turns;
        reserve.readyRound = game.round + reserve.repairTurns;
      }
    }
    state.strength = state.maximum.map((maximum, team) =>
      Math.max(
        0,
        maximum -
          state.losses[team] -
          (state.controlLosses?.[team] || 0) -
          Math.floor((maximum * state.baseDamage[team]) / state.initialBaseHP[team]),
      ),
    );
    if (game.winner !== null) return;
    const lost = [0, 1].map(
      (team) =>
        state.strength[team] <= 0 ||
        !game.units.some(
          (unit) => unit.team === team && unit.facility?.type === "base" && unit.hp > 0,
        ),
    );
    if (lost.some(Boolean)) {
      game.winner = lost[0] && lost[1] ? -1 : lost[0] ? 1 : 0;
      state.result = "base-or-strength";
    } else if (state.completed >= state.maxRounds) {
      game.winner =
        state.strength[0] === state.strength[1]
          ? -1
          : state.strength[0] > state.strength[1]
            ? 0
            : 1;
      state.result = "time-limit";
    }
  }
  function captureNearby(G, game) {
    if (!game.battlefield || game.winner !== null || game.deployment?.some((ready) => !ready))
      return;
    for (const point of game.battlefield.points) {
      const occupants = game.units.filter(
        (unit) =>
          G.onMap(unit) &&
          !unit.facility &&
          !unit.pendingMove &&
          !unit.embarked &&
          G.cells(unit).some((cell) => Math.hypot(cell.x - point.x, cell.y - point.y) <= captureRadius),
      );
      const present = new Set(occupants.map((unit) => unit.team));
      if (present.size === 1) {
        const owner = [...present][0];
        if (point.owner !== owner) {
          point.owner = owner;
          for (const unit of occupants) unit.origin = null;
          (game.turnEffects ||= []).push({
            type: "battlefield_capture",
            pointId: point.id,
            team: owner,
          });
        }
      }
    }
  }
  const fixedWaves = {
    "0079T1": {
      early: { EFSF: { Type61: 18, FF_B2: 6, FF_S3: 6 }, ZEON: { MTank: 9, MS_06F: 4, MS_06S: 2 }, randomMS: 2 },
      middle: { EFSF: { RGM_79: 9 }, ZEON: { MS_06F2: 9 }, randomMS: 3 },
      late: { EFSF: { RGM_79: 12 }, ZEON: { MS_06F2: 12 }, randomMS: 4 },
    },
    "0079T2": {
      early: { EFSF: { RGM_79: 9 }, ZEON: { MS_06F2: 9 }, randomMS: 3 },
      middle: { EFSF: { RGM_79C: 9 }, ZEON: { MS_06FZ: 9 }, randomMS: 3 },
      late: { EFSF: { RGM_79C: 12 }, ZEON: { MS_06FZ: 12 }, randomMS: 5 },
    },
    "0087T1": {
      early: {AEUG:{RMS_179_AEUG:9},TITANS:{RMS_106:9},NEO_ZEON:{MS_09R_Stutzer:9},randomMS:3},
      middle: {AEUG:{MSA_003:9},TITANS:{RMS_108:9},NEO_ZEON:{AMX_003:9},randomMS:3},
      late: {AEUG:{MSA_003:12},TITANS:{RMS_108:12},NEO_ZEON:{AMX_003:12},randomMS:5},
    },
    "0087T2": {
      early: {AEUG:{MSA_003:9},TITANS:{RMS_108:9},NEO_ZEON:{AMX_003:9},randomMS:3},
      middle: {AEUG:{RGM_86R:9},TITANS:{RMS_154_Kai:9},NEO_ZEON:{AMX_009:9},randomMS:3},
      late: {AEUG:{RGM_86R:12},TITANS:{RMS_154_Kai:12},NEO_ZEON:{AMX_009:12},randomMS:5},
    },
  };
  const waveStage = round => round < 10 ? "early" : round <= 50 ? "middle" : "late";
  function pool(G, state, team) {
    const selected = state.teams[team];
    const allowedEras = eras.slice(selected.era.startsWith("0087") ? 2 : 0, eras.indexOf(selected.era) + 1);
    const choices = G.catalog.prefabs.flatMap(prefab => {
      const kit = prefab.weaponKits[0], model = kit && G.models[prefab.id + "__" + kit.id];
      return model && !model.disabled && !model.wip && !model.formOnly && !prefab.facility &&
        !model.requiredPilotId && affiliated(model, selected.faction) &&
        allowedEras.some(era => model.tags.includes(era)) && model.movementType !== "naval" &&
        (model.adaptability?.ground ?? 100) > 0 && model.move > 0 &&
        !(G.aiUnitBans?.regular || []).includes(prefab.id)
        ? [{ unitId: prefab.id, kitId: kit.id }] : [];
    });
    const modelOf = entry => G.models[entry.unitId + "__" + entry.kitId];
    return { choices, era: selected.era,
      ms: choices.filter(entry => modelOf(entry).unitTags.includes("MS")),
      ships: choices.filter(entry => modelOf(entry).ship) };
  }
  function wavePlan(G, selected, round, baseCount, random) {
    const stage = waveStage(round), row = fixedWaves[selected.era][stage];
    const effective = selected.era === "0087T2" && stage === "early" ? {...selected,era:"0087T1"} : selected;
    const available = pool(G, { teams: [effective, effective] }, 0), entries = [];
    const choose = list => list[Math.min(list.length - 1, Math.floor(random() * list.length))];
    for (let base = 0; base < baseCount; base++) {
      for (const [unitId, count] of Object.entries(row[selected.faction])) {
        const prefab = G.catalog.prefabs.find(item => item.id === unitId);
        if (!prefab) throw Error("增援单位不存在：" + unitId);
        for (let i = 0; i < count; i++) entries.push({ unitId, kitId: prefab.weaponKits[0].id, group: base + ":" + unitId });
      }
      for (let i = 0; i < row.randomMS && available.ms.length; i++) entries.push({ ...choose(available.ms), group: base + ":random-ms" });
      if (available.ships.length && random() < (stage === "late" ? 0.25 : 0.15))
        entries.push({ ...choose(available.ships), group: base + ":ship" });
    }
    return entries;
  }
  function placeReinforcements(G, game) {
    const state = game.battlefield, pending = [];
    if (!state.reinforcementQueue?.length) return;
    const placement = G.placementQuery(game);
    const anchors = new Map();
    for (const entry of state.reinforcementQueue || []) {
      const sites = deploymentSites(G, game, entry.team);
      if (!sites.length) continue;
      const actor = G.makeUnit(entry, entry.team, "airdrop-" + state.nextUnit,
        { x: 0, y: 0 }, 0, game.seed);
      const groupKey = entry.team + ":" + entry.wave + ":" + entry.group;
      const anchor = anchors.get(groupKey);
      const join = anchor && G.squadJoinTarget(game, actor, anchor.x, anchor.y, [actor]);
      let position = join ? { x: join.x, y: join.y } : null;
      if (!position) {
        const candidates = [];
        for (const site of sites) for (let y = site.y - 7; y <= site.y + 7; y++)
          for (let x = site.x - 7; x <= site.x + 7; x++)
            if (Math.hypot(x - site.x, y - site.y) <= 7 && placement.fits(actor, x, y)) candidates.push({ x, y });
        position = candidates[Math.floor(G.random(game) * candidates.length)];
      }
      if (!position) { pending.push(entry); continue; }
      Object.assign(actor, position, { airdropRound: game.round, formationIndex: state.nextFormationIndex[entry.team]++ });
      state.nextUnit++;
      game.units.push(actor);
      placement.include(actor);
      if (join) G.joinSquad(game, actor, join);
      anchors.set(groupKey, join || actor);
      (game.turnEffects ||= []).push({ type: "airdrop", unitId: actor.id, team: entry.team, era: state.teams[entry.team].era });
    }
    state.reinforcementQueue = pending;
  }
  function reinforce(G, game) {
    const state = game.battlefield;
    if (!state || game.winner !== null) return;
    state.wave++;
    state.reinforcementQueue ||= [];
    for (const team of [0, 1]) {
      const bases = game.units.filter(unit => unit.team === team && unit.facility?.type === "base" && unit.hp > 0).length;
      state.reinforcementQueue.push(...wavePlan(G, state.teams[team], game.round, bases, () => G.random(game))
        .map(entry => ({ ...entry, team, wave: state.wave })));
    }
    placeReinforcements(G, game);
  }
  function deploymentSites(G, game, team) {
    if (!game.battlefield) return [];
    return [
      ...game.battlefield.points.filter((point) => point.owner === team)
        .map((point) => ({ id: "point:" + point.id, name: point.name, x: point.x, y: point.y })),
      ...game.units.filter((unit) => unit.facility?.type === "base" && unit.team === team && unit.hp > 0)
        .map((unit) => {
          const cells = G.cells(unit), xs = cells.map(cell => cell.x), ys = cells.map(cell => cell.y);
          return { id: "base:" + unit.facility.id, name: G.unitName(unit),
            x: Math.floor((Math.min(...xs) + Math.max(...xs)) / 2),
            y: Math.floor((Math.min(...ys) + Math.max(...ys)) / 2) };
        }),
    ];
  }
  function requestDeployment(G, game, seat, reserveId, siteId) {
    const state = game.battlefield;
    if (!state || game.winner !== null) throw Error("当前不能申请部署");
    const reserve = state.reserves?.find((item) => item.id === reserveId && item.ownerSeat === seat);
    if (!reserve || reserve.readyRound === null) throw Error("只能申请部署自己已阵亡的单位");
    if (reserve.stockAvailable === false) throw Error("库存已耗尽，无法重新部署");
    if (reserve.request) throw Error("该单位已申请部署");
    if (reserve.readyRound > game.round) throw Error("单位尚未维修完成");
    if (!deploymentSites(G, game, G.seatTeam(seat)).some((site) => site.id === siteId))
      throw Error("请选择己方据点或存活主基地");
    reserve.request = { siteId, arrivalRound: game.round + 1 };
    return { type: "battlefield_deploy_request", reserveId, siteId, arrivalRound: game.round + 1 };
  }
  function deployReserves(G, game) {
    if (game.winner !== null) return;
    const state = game.battlefield;
    let placement = null;
    for (const reserve of state.reserves || []) {
      const request = reserve.request;
      if (!request || request.arrivalRound > game.round) continue;
      const site = deploymentSites(G, game, reserve.team).find((item) => item.id === request.siteId);
      if (!site) {
        reserve.request = null;
        (game.turnEffects ||= []).push({ type: "battlefield_deploy_cancelled", ownerSeat: reserve.ownerSeat });
        continue;
      }
      const actor = G.makeUnit({ unitId: reserve.unitId, kitId: reserve.kitId }, reserve.ownerSeat,
        "pmc-airdrop-" + state.nextUnit, { x: 0, y: 0 }, reserve.template.angle,
        game.seed, reserve.template.performance, reserve.template.environment);
      actor.pilot = structuredClone(reserve.template.pilot);
      const model = G.modelOf(actor);
      Object.assign(actor, { hp: model.hp, en: model.en, shield: model.shield.hp,
        formationIndex: reserve.formationIndex, airdropRound: game.round });
      if (model.iField) actor.iFieldHp = model.iField.capacity;
      const cells = [];
      placement ||= G.placementQuery(game);
      for (let y = site.y - 5; y <= site.y + 5; y++) for (let x = site.x - 5; x <= site.x + 5; x++)
        if (Math.hypot(x - site.x, y - site.y) <= 5 && placement.fits(actor, x, y)) cells.push({ x, y });
      if (!cells.length) continue; // Keep the request queued until a legal landing cell is free.
      Object.assign(actor, cells[Math.floor(G.random(game) * cells.length)]);
      state.nextUnit++;
      reserve.request = null;
      reserve.readyRound = null;
      game.units.push(actor);
      placement.include(actor);
      (game.turnEffects ||= []).push({ type: "airdrop", unitId: actor.id, team: actor.team });
    }
  }
  function advance(G, game) {
    const state = game.battlefield;
    if (!state) return;
    state.completed = game.round - 1;
    captureNearby(G, game);
    // Settle once per completed round, never on ordinary state broadcasts.
    if (game.winner === null && state.completed > (state.lastControlRound || 0)) {
      state.lastControlRound = state.completed;
      const held = [0, 1].map((team) => state.points.filter((point) => point.owner === team).length);
      if (held[0] !== held[1]) {
        const losingTeam = held[0] > held[1] ? 1 : 0;
        state.controlLosses ||= [0, 0];
        const amount = Math.max(1, Math.floor(state.maximum[losingTeam] / 100));
        state.controlLosses[losingTeam] += amount;
        (game.turnEffects ||= []).push({ type: "battlefield_control_loss", team: losingTeam, amount });
      }
    }
    sync(G, game);
    deployReserves(G, game);
    if (game.winner === null) placeReinforcements(G, game);
    if (
      state.completed > 0 &&
      state.completed % state.reinforcementInterval === 0 &&
      state.lastReinforcementRound !== state.completed &&
      game.winner === null
    ) {
      state.lastReinforcementRound = state.completed;
      reinforce(G, game);
    }
  }
  function aiChoice(G, game, unit) {
    if (!game.battlefield || unit.facility || unit.moved || unit.embarked) return null;
    const targets = [
      ...game.battlefield.points.filter((point) => point.owner !== unit.team),
      ...game.units.filter(
        (other) => other.facility?.type === "base" && other.team !== unit.team && other.hp > 0,
      ),
    ];
    const goal = targets.sort(
      (a, b) => Math.hypot(a.x - unit.x, a.y - unit.y) - Math.hypot(b.x - unit.x, b.y - unit.y),
    )[0];
    if (!goal) return null;
    const cells = [...G.reachable(game, unit).values()];
    if (!cells.length) return null;
    const distance = (cell) => Math.hypot(cell.x - goal.x, cell.y - goal.y);
    const minimum = Math.min(...cells.map(distance));
    return G.aiChoice(
      game,
      unit,
      cells.filter((cell) => distance(cell) <= minimum + 1),
    );
  }
  return {
    eraStrength,
    roomEra,
    validateRoomSelection,
    roomPresets,
    roomPreset,
    presetSettings,
    baseReward,
    defaultMapId,
    captureRadius,
    facilityIds,
    factions,
    eras,
    fixedWaves,
    waveStage,
    wavePlan,
    teams,
    erasForFaction,
    validateMap,
    facilities,
    initialize,
    unrepairable,
    sync,
    captureNearby,
    reinforce,
    advance,
    aiChoice,
    pool,
    deploymentSites,
    requestDeployment,
  };
})();
if (typeof module !== "undefined") module.exports = BattlefieldMode;
