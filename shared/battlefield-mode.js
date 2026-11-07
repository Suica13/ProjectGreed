/* Reusable battlefield objectives. All mutation runs in the authoritative rules. */
"use strict";
const BattlefieldMode = (() => {
  const defaultMapId = "battlefield_frontline";
  const facilityIds = Object.freeze({
    base: "Facility_HQ",
    machineGun: "Facility_MG",
    beam: "Facility_Beam",
    missile: "Facility_Missile",
    cannon: "Facility_Cannon",
    radar: "Facility_Radar",
  });
  const factions = ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"];
  const affiliated = (model, faction) =>
    (model.availableFactions || [model.faction]).includes(faction);
  const erasForFaction = (G, faction) =>
    G.eras.filter((era) =>
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
    if (!Array.isArray(input) || input.length !== 2) throw Error("战地模式需要两支阵营 AI");
    return input.map((item) => {
      if (!item || !factions.includes(item.faction) || !G.eras.includes(item.era))
        throw Error("战地模式 AI 阵营或年代无效");
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
  function facilities(G, game) {
    const config = validateMap(G.getMap(game.mapId));
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
      actor.formationIndex = indices[item.team]++;
      return actor;
    });
  }
  function initialize(G, game, settings) {
    const config = validateMap(G.getMap(game.mapId));
    game.battlefield = {
      teams: teams(G, settings.battlefieldTeams),
      maxRounds: config.maxRounds,
      maximum: [config.strength, config.strength],
      strength: [config.strength, config.strength],
      losses: [0, 0],
      baseDamage: [0, 0],
      initialBaseHP: [0, 0],
      baseHP: {},
      defeated: {},
      completed: 0,
      wave: 0,
      nextUnit: 1,
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
  }
  function unrepairable(game, unit) {
    return !!game.battlefield && unit.facility?.type === "base";
  }
  function sync(G, game) {
    const state = game.battlefield;
    if (!state) return;
    for (const unit of game.units) {
      if (unrepairable(game, unit)) {
        const before = state.baseHP[unit.id];
        unit.hp = Math.min(unit.hp, before);
        state.baseDamage[unit.team] += before - Math.max(0, unit.hp);
        state.baseHP[unit.id] = Math.max(0, unit.hp);
      }
      if (unit.hp <= 0 && !state.defeated[unit.id]) {
        state.defeated[unit.id] = true;
        if (unit.facility?.type !== "base")
          state.losses[unit.team] +=
            G.modelOf(unit).cost + (unit.pilot?.custom ? G.pilots.cost(unit.pilot) : 0);
      }
    }
    state.strength = state.maximum.map((maximum, team) =>
      Math.max(
        0,
        maximum -
          state.losses[team] -
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
          G.cells(unit).some((cell) => Math.hypot(cell.x - point.x, cell.y - point.y) <= 2),
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
  function pool(G, state, team) {
    const selected = state.teams[team],
      maximumEra = G.eras.indexOf(selected.era);
    // Progress starts inside the selected year, rather than rewinding a later era to 0079.
    const factionEras = erasForFaction(G, selected.faction).filter(
      (era) => era.slice(0, 4) === selected.era.slice(0, 4) && G.eras.indexOf(era) <= maximumEra,
    );
    const level = Math.min(factionEras.length - 1, Math.floor(state.completed / 15));
    const eras = factionEras.slice(0, level + 1);
    const candidates = G.catalog.prefabs.flatMap((prefab) => {
      const kit = prefab.weaponKits[0],
        model = kit && G.models[prefab.id + "__" + kit.id];
      return model &&
        !model.disabled &&
        !model.wip &&
        !model.formOnly &&
        !prefab.facility &&
        !model.requiredPilotId &&
        affiliated(model, selected.faction) &&
        eras.some((era) => model.tags.includes(era)) &&
        model.movementType !== "naval" &&
        model.move > 0 &&
        !(G.aiUnitBans?.regular || []).includes(prefab.id)
        ? [{ unitId: prefab.id, kitId: kit.id }]
        : [];
    });
    const minimumCost = candidates.length
      ? Math.min(...candidates.map((entry) => G.models[entry.unitId + "__" + entry.kitId].cost))
      : 0;
    const maximumCost = Math.max(
      minimumCost,
      Math.min(2500, Math.max(250, minimumCost) + state.wave * 150),
    );
    return {
      choices: candidates.filter(
        (entry) => G.models[entry.unitId + "__" + entry.kitId].cost <= maximumCost,
      ),
      era: factionEras[level] || selected.era,
      minimumCost,
    };
  }
  function reinforce(G, game) {
    const state = game.battlefield;
    if (!state || game.winner !== null) return;
    state.wave++;
    for (const team of [0, 1]) {
      const available = pool(G, state, team);
      const bases = game.units.filter(
        (unit) => unit.team === team && unit.facility?.type === "base" && unit.hp > 0,
      );
      const sites = [...state.points.filter((point) => point.owner === team), ...bases];
      let count = Math.min(
        4 + sites.length - bases.length,
        state.maxAIUnits -
          game.units.filter(
            (unit) =>
              unit.team === team && unit.ownerSeat === team && !unit.facility && unit.hp > 0,
          ).length,
      );
      let budget = Math.max(1000 + state.wave * 400, available.minimumCost * 4);
      for (let i = 0; i < count && available.choices.length; i++) {
        const affordable = available.choices.filter(
          (entry) => G.models[entry.unitId + "__" + entry.kitId].cost <= budget,
        );
        if (!affordable.length) break;
        const entry = affordable[Math.floor(G.random(game) * affordable.length)];
        const actor = G.makeUnit(
          entry,
          team,
          "airdrop-" + state.nextUnit++,
          { x: 0, y: 0 },
          0,
          game.seed,
        );
        let position = null;
        for (let n = 0; n < sites.length && !position; n++) {
          const site = sites[(i + n) % sites.length];
          const cells = [];
          for (let y = site.y - 5; y <= site.y + 5; y++)
            for (let x = site.x - 5; x <= site.x + 5; x++)
              if (Math.hypot(x - site.x, y - site.y) <= 5 && G.fits(game, actor, x, y))
                cells.push({ x, y });
          position = cells[Math.floor(G.random(game) * cells.length)] || null;
        }
        if (!position) continue;
        Object.assign(actor, position, {
          airdropRound: game.round,
          formationIndex: state.nextFormationIndex[team]++,
        });
        game.units.push(actor);
        budget -= G.modelOf(actor).cost;
        (game.turnEffects ||= []).push({
          type: "airdrop",
          unitId: actor.id,
          team,
          era: available.era,
        });
      }
    }
  }
  function advance(G, game) {
    const state = game.battlefield;
    if (!state) return;
    state.completed = game.round - 1;
    captureNearby(G, game);
    sync(G, game);
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
    defaultMapId,
    facilityIds,
    factions,
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
  };
})();
if (typeof module !== "undefined") module.exports = BattlefieldMode;
