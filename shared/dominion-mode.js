/* Match-owned RTT economy. Never reads or writes personal stock or progression. */
"use strict";
const DominionMode = (() => {
  const development =
    typeof Development !== "undefined" ? Development : require("./development.js");
  const economy = typeof Economy !== "undefined" ? Economy : require("./economy.js");
  const defaultMapId = "dominion_highlands";
  const buildings = {
    base: "Facility_HQ",
    factory: "Facility_Factory",
    refinery: "Facility_Refinery",
    research: "Facility_Research",
    turret: "Facility_MG",
  };
  const initial = { money: 5000, supplies: 7500, points: 0 };
  function validateMap(map) {
    const points = map.dominion?.points,
      ids = new Set();
    if (!Array.isArray(points) || !points.length || points.length > 12)
      throw Error("占山为王据点配置无效");
    for (const p of points) {
      if (
        !/^[a-zA-Z0-9_-]{1,64}$/.test(p.id) ||
        ids.has(p.id) ||
        typeof p.name !== "string" ||
        p.name.length > 80 ||
        ![1, 2, 3].includes(p.size) ||
        !Number.isInteger(p.x) ||
        !Number.isInteger(p.y) ||
        p.x < 6 ||
        p.y < 6 ||
        p.x > map.width - 8 ||
        p.y > map.height - 6
      )
        throw Error("占山为王据点位置或规模无效");
      ids.add(p.id);
    }
    return true;
  }
  function validateState(G, game) {
    const state = game.dominion,
      map = G.getMap(game.mapId);
    validateMap(map);
    if (
      !state ||
      !G.eras.includes(state.era) ||
      !state.players ||
      !Array.isArray(state.points) ||
      state.points.length !== map.dominion.points.length ||
      !Number.isSafeInteger(state.serial) ||
      state.serial < 0 ||
      !state.incomeTurns ||
      typeof state.incomeTurns !== "object"
    )
      throw Error("占山为王存档状态无效");
    for (const [seat, p] of Object.entries(state.players)) {
      if (
        !/^\d+$/.test(seat) ||
        Number(seat) >= map.spawns.length ||
        !factionsForEra(G, state.era).includes(p.faction) ||
        [p.money, p.supplies, p.points].some((n) => !Number.isSafeInteger(n) || n < 0) ||
        !p.researched ||
        !Array.isArray(p.researched[p.faction])
      )
        throw Error("占山为王玩家资源或科技无效");
      const clean = development.normalizeResearch(p.researched, { includeLocked: true });
      if (p.researched[p.faction].some((id) => !clean[p.faction].includes(id)))
        throw Error("占山为王科技前置关系无效");
    }
    for (const p of state.points) {
      const source = map.dominion.points.find((s) => s.id === p.id);
      if (
        !source ||
        source.x !== p.x ||
        source.y !== p.y ||
        source.size !== p.size ||
        (p.ownerSeat !== null && !Object.hasOwn(state.players, p.ownerSeat))
      )
        throw Error("占山为王据点归属无效");
    }
    for (const u of game.units.filter((u) => u.dominionOrder)) {
      const order = u.dominionOrder;
      if (
        !state.players[u.ownerSeat] ||
        u.facility?.type !== "factory" ||
        !G.models[order.unitId + "__" + order.kitId] ||
        !Number.isInteger(order.remaining) ||
        order.remaining < 0 ||
        order.remaining > 5
      )
        throw Error("占山为王生产订单无效");
    }
    return true;
  }
  const blockedCache = new WeakMap();
  function blockedCells(G, game) {
    if (!blockedCache.has(game.dominion)) {
      const blocked = new Set(
        game.units
          .filter((u) => u.facility)
          .flatMap((u) => G.cells(u))
          .map((c) => c.x + "," + c.y),
      );
      for (const p of game.dominion.points) {
        blocked.add(p.x + "," + p.y);
        const plots = [];
        for (let i = 0; i < (p.size || 1); i++)
          plots.push([p.x - 4 + i * 4, p.y - 4], [p.x - 4 + i * 4, p.y + 4]);
        for (let i = 0; i < Math.ceil((p.size || 1) / 2); i++)
          plots.push([p.x + 6, p.y - 2 + i * 4]);
        for (const [x, y] of plots) blocked.add(x + "," + y);
      }
      blockedCache.set(game.dominion, blocked);
    }
    return blockedCache.get(game.dominion);
  }
  function factionsForEra(G, era) {
    return G.factions.filter((f) => development.nodes(f).some((n) => n.era === era));
  }
  function faction(G, settings, seat, requested) {
    const options = factionsForEra(G, settings.dominionEra || "UC_0079_T1");
    const forced = settings.teamFactions?.[G.seatTeam(seat)];
    if (forced && !options.includes(forced)) throw Error("强制阵营不属于当前年代");
    return (
      forced ||
      (options.includes(requested) ? requested : options[G.seatTeam(seat) % options.length])
    );
  }
  function researchAtStart(G, selected, era) {
    const value = {};
    for (const f of development.factions)
      value[f] = development
        .nodes(f)
        .filter(
          (n) =>
            !n.requires.length ||
            (f === selected && G.technologyWeight(n.era) < G.technologyWeight(era)),
        )
        .map((n) => n.id);
    return value;
  }
  function initialize(G, game, settings, players) {
    const map = G.getMap(game.mapId);
    if (!map.dominion) throw Error("占山为王需要专用地图");
    validateMap(map);
    game.dominion = {
      era: settings.dominionEra || "UC_0079_T1",
      players: {},
      points: map.dominion.points.map((p) => ({ ...p, ownerSeat: null })),
      serial: 0,
      incomeTurns: {},
    };
    const state = game.dominion;
    const add = (type, seat, x, y, siteId = null) => {
      const u = G.makeUnit(
        { unitId: buildings[type], kitId: "standard" },
        seat ?? 0,
        "dominion-building-" + state.serial++,
        { x, y },
        0,
        game.seed,
        1,
        map.environment,
      );
      u.ownerSeat = seat ?? -1;
      u.team = seat === null ? -1 : G.seatTeam(seat);
      u.facility = { id: u.id, type: type === "turret" ? "machineGun" : type, siteId, level: 1 };
      if (seat === null) {
        u.dominionDormant = true;
        u.hp = 0;
      }
      u.deployed = true;
      u.formationIndex = -1;
      if (seat !== null)
        u.pilot = G.pilots.roll(null, game.seed, seat, 0, {
          ...G.modelOf(u),
          faction: state.players[seat].faction,
        });
      game.units.push(u);
      return u;
    };
    for (const p of players.filter(Boolean)) {
      const selected = faction(G, settings, p.seat, p.characterFaction);
      state.players[p.seat] = {
        ...initial,
        faction: selected,
        researched: researchAtStart(G, selected, state.era),
      };
      const s = map.spawns[p.seat];
      add("base", p.seat, s.x, s.y);
      for (const [type, dx, dy] of [
        ["factory", -4, -4],
        ["factory", 4, -4],
        ["refinery", -4, 4],
        ["refinery", 4, 4],
        ["research", 0, 6],
        ["turret", -6, 0],
        ["turret", 6, 0],
        ["turret", 0, -6],
      ])
        add(type, p.seat, s.x + dx, s.y + dy);
    }
    for (const point of state.points) {
      const count = point.size || 1;
      for (let i = 0; i < count; i++) {
        add("factory", null, point.x - 4 + i * 4, point.y - 4, point.id);
        add("refinery", null, point.x - 4 + i * 4, point.y + 4, point.id);
      }
      for (let i = 0; i < Math.ceil(count / 2); i++)
        add("research", null, point.x + 6, point.y - 2 + i * 4, point.id);
    }
    game.deployment = null;
  }
  function player(game, seat) {
    const p = game.dominion?.players[seat];
    if (!p) throw Error("观战者不能使用局内经济");
    return p;
  }
  function income(game, seat) {
    const units = game.units.filter((u) => u.hp > 0 && u.ownerSeat === seat && u.facility);
    return {
      money: units.filter((u) => u.facility.type === "refinery").length * 250,
      supplies: units.filter((u) => u.facility.type === "refinery").length * 375,
      points: units.filter((u) => u.facility.type === "research").length * 250,
    };
  }
  function facility(game, seat, id, type) {
    player(game, seat);
    const u = game.units.find(
      (u) => u.id === id && u.hp > 0 && u.ownerSeat === seat && u.facility?.type === type,
    );
    if (!u) throw Error("设施不存在、已损毁或不属于你");
    if (game.winner !== null || game.team !== seat % 2) throw Error("只能在己方行动阶段操作设施");
    return u;
  }
  function offers(G, game, seat) {
    const p = player(game, seat),
      researched = new Set(p.researched[p.faction]);
    const units = new Set(
      development
        .nodes(p.faction)
        .filter((n) => researched.has(n.id))
        .flatMap((n) => n.unlocks),
    );
    return G.catalog.prefabs
      .filter(
        (u) =>
          units.has(u.id) &&
          !u.wip &&
          !u.formOnly &&
          !u.facility &&
          G.technologyWeight(u.tags.find((t) => G.technologyWeight(t))) <=
            G.technologyWeight(game.dominion.era),
      )
      .flatMap((u) =>
        u.weaponKits.map((k) => ({
          unitId: u.id,
          kitId: k.id,
          model: G.models[u.id + "__" + k.id],
          cost: economy.productionOffer(u.id, k.id, undefined, G.models),
          turns: economy.productionTiming(u.id, k.id)?.turns || 1,
        })),
      )
      .filter(
        (o) =>
          o.cost &&
          (game.environment === "space"
            ? o.model.adaptability.space
            : o.model.adaptability.ground) > 0 &&
          (o.model.movementType !== "naval" || game.tiles.some((row) => row.includes("water"))),
      );
  }
  function produce(G, game, seat, factoryId, unitId, kitId) {
    const f = facility(game, seat, factoryId, "factory"),
      p = player(game, seat);
    if (f.dominionOrder) throw Error("该工厂正在生产");
    const offer = offers(G, game, seat).find((o) => o.unitId === unitId && o.kitId === kitId);
    if (!offer) throw Error("单位不符合阵营、年代、环境或局内科技");
    if (p.money < offer.cost.money || p.supplies < offer.cost.supplies)
      throw Error("局内资金或物资不足");
    if (game.units.filter((u) => u.hp > 0 && u.ownerSeat === seat && (!u.facility || u.dominionOrder)).length >= 60)
      throw Error("每名玩家最多同时拥有60台单位");
    p.money -= offer.cost.money;
    p.supplies -= offer.cost.supplies;
    f.dominionOrder = { unitId, kitId, remaining: offer.turns };
    return { type: "dominion_produce", unitId: f.id };
  }
  function research(G, game, seat, labId, techId) {
    facility(game, seat, labId, "research");
    const p = player(game, seat);
    const node = development.nodes(p.faction).find((n) => n.id === techId);
    const known = p.researched[p.faction];
    if (
      !node ||
      known.includes(techId) ||
      !node.requires.every((id) => known.includes(id)) ||
      p.points < node.points ||
      G.technologyWeight(node.era) > G.technologyWeight(game.dominion.era)
    )
      throw Error("科技点不足或前置科技未完成");
    known.push(techId);
    return { type: "dominion_research", techId };
  }
  function capture(G, game, seat, unitId, pointId) {
    player(game, seat);
    const u = game.units.find((u) => u.id === unitId),
      point = game.dominion.points.find((p) => p.id === pointId);
    if (
      game.winner !== null ||
      game.team !== seat % 2 ||
      !u ||
      u.ownerSeat !== seat ||
      u.acted ||
      !G.campaignBattlefield.canSuppress(G, u) ||
      !point ||
      (point.ownerSeat !== null && point.ownerSeat % 2 === u.team) ||
      !G.cells(u).some((c) => Math.max(Math.abs(c.x - point.x), Math.abs(c.y - point.y)) <= 2)
    )
      throw Error("无法占领该据点");
    if (
      game.units.some(
        (v) =>
          v.hp > 0 &&
          !v.facility &&
          v.team !== u.team &&
          v.team >= 0 &&
          G.onMap(v) &&
          G.cells(v).some((c) => Math.max(Math.abs(c.x - point.x), Math.abs(c.y - point.y)) <= 2),
      )
    )
      throw Error("据点范围内存在敌军");
    point.ownerSeat = seat;
    u.acted = true;
    for (const b of game.units.filter((b) => b.facility?.siteId === point.id)) {
      b.ownerSeat = seat;
      b.team = u.team;
      delete b.dominionOrder;
      b.pilot = G.pilots.roll(null, game.seed, seat, 0, {
        ...G.modelOf(b),
        faction: player(game, seat).faction,
      });
      if (b.dominionDormant) {
        delete b.dominionDormant;
        b.hp = G.modelOf(b).hp;
      }
    }
    return { type: "dominion_capture", pointId, unitId };
  }
  function sync(G, game) {
    if (!game.dominion || game.winner !== null) return;
    const alive = [0, 1].map((team) =>
      game.units.some((u) => u.team === team && u.facility?.type === "base" && u.hp > 0),
    );
    if (!alive[0] || !alive[1]) game.winner = alive[0] ? 0 : alive[1] ? 1 : -1;
  }
  function advance(G, game) {
    const state = game.dominion;
    if (!state || game.winner !== null) return;
    const key = game.round + ":" + game.team;
    if (state.incomeTurns[key]) return;
    state.incomeTurns[key] = true;
    // Both teams get the same opening budget; income begins on their second turn.
    if (game.round <= 2) return;
    for (const [seat, p] of Object.entries(state.players)) {
      if (Number(seat) % 2 !== game.team) continue;
      const earned = income(game, Number(seat));
      for (const k of ["money", "supplies", "points"]) p[k] += earned[k];
      for (const f of game.units.filter(
        (u) => u.hp > 0 && u.ownerSeat === Number(seat) && u.dominionOrder,
      )) {
        const order = f.dominionOrder;
        order.remaining = Math.max(0, order.remaining - 1);
        if (order.remaining) continue;
        const u = G.makeUnit(
          order,
          Number(seat),
          "dominion-unit-" + state.serial++,
          f,
          0,
          game.seed,
          1,
          game.environment,
        );
        const candidates = [];
        for (let dy = -7; dy <= 7; dy++)
          for (let dx = -7; dx <= 7; dx++) candidates.push({ x: f.x + dx, y: f.y + dy });
        candidates.sort(
          (a, b) =>
            Math.abs(a.x - f.x) + Math.abs(a.y - f.y) - Math.abs(b.x - f.x) - Math.abs(b.y - f.y),
        );
        const cell = candidates.find((c) => G.fits(game, u, c.x, c.y));
        if (!cell) continue;
        Object.assign(u, cell, { deployed: true, moved: false, acted: false, formationIndex: -1 });
        game.units.push(u);
        delete f.dominionOrder;
      }
    }
  }
  return {
    defaultMapId,
    buildings,
    initial,
    validateMap,
    validateState,
    blockedCells,
    factionsForEra,
    faction,
    initialize,
    player,
    income,
    offers,
    produce,
    research,
    capture,
    sync,
    advance,
  };
})();
if (typeof module !== "undefined") module.exports = DominionMode;
