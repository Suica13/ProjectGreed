/* Endless cooperative contracts. Only the authoritative room mutates this state. */
"use strict";
const SweepMode = (() => {
  const events = [
    {
      id: "salvage",
      name: "战后残骸",
      text: "清扫队发现一片尚未回收的残骸。",
      choices: ["拆解物资", "搜寻完整机体"],
    },
    {
      id: "convoy",
      name: "失联补给舰队",
      text: "受雇的补给队偏离航线，需要PMC护送。",
      choices: ["交付补给换取报酬", "接收备用零件"],
    },
    {
      id: "minefield",
      name: "废弃雷区",
      text: "雷区横在航线上；快速通过可能损伤部队。",
      choices: ["消耗EN谨慎排雷", "冒险穿越并回收军需"],
    },
    {
      id: "depot",
      name: "隐蔽整备站",
      text: "旧整备设施仍能运转，但剩余物资有限。",
      choices: ["修复全队25%状态", "拆走整备物资"],
    },
    {
      id: "intel",
      name: "缴获作战终端",
      text: "终端里保存了敌方实验数据及军需仓库坐标。",
      choices: ["提取科技数据", "回收仓储物资"],
    },
    {
      id: "survivors",
      name: "被困的PMC分遣队",
      text: "友军在任务中失联，正在请求接应。",
      choices: ["消耗EN接应并接收机体", "提供航线换取情报"],
    },
    {
      id: "auction",
      name: "黑市回收商",
      text: "回收商愿意用一台封存机体交换本次收获。",
      choices: ["使用本局资金交换机体", "拒绝交易并回收废料"],
    },
    {
      id: "storm",
      name: "电磁暴避难所",
      text: "电磁暴将至；附近废墟可暂时隐蔽或进行扫描。",
      choices: ["避难并恢复EN", "冒险扫描获取科技数据"],
    },
  ];
  function rng(seed) {
    let n = seed >>> 0;
    return () => {
      n = (Math.imul(n, 1664525) + 1013904223) >>> 0;
      return n / 4294967296;
    };
  }
  function rows(seed, start = 0, count = 7) {
    const result = [];
    const lanesAt = (depth) => {
      // Forced branching layers need both adjacent exits even at the map edges.
      if (depth % 3 === 0) return [0, 1, 2];
      const r = rng(seed + depth * 7309)();
      return r < 0.35 ? (r < 0.175 ? [0, 1] : [1, 2]) : [0, 1, 2];
    };
    for (let depth = start; depth < start + count; depth++) {
      const random = rng(seed + depth * 7309 + 613),
        nodes = [],
        nextLanes = lanesAt(depth + 1);
      for (const lane of lanesAt(depth)) {
        const r = random();
        const type =
          depth === 0
            ? "battle"
            : depth % 5 === 4
              ? "boss"
              : r < 0.5
                ? "battle"
                : r < 0.68
                  ? "elite"
                  : r < 0.84
                    ? "rest"
                    : "event";
        nodes.push({
          id: depth + ":" + lane,
          depth,
          lane,
          type,
          next: [],
        });
      }
      // Each node has an exit and each following node is reachable; most
      // routes have one exit, with occasional forks instead of a full mesh.
      for (const node of nodes) {
        const candidates = nextLanes
          .filter((l) => Math.abs(l - node.lane) <= 1)
          .sort((a, b) => Math.abs(a - node.lane) - Math.abs(b - node.lane) || a - b);
        node.next.push(`${depth + 1}:${candidates[0]}`);
      }
      for (const lane of nextLanes)
        if (!nodes.some((n) => n.next.includes(`${depth + 1}:${lane}`))) {
          const from = nodes
            .filter((n) => Math.abs(n.lane - lane) <= 1)
            .sort(
              (a, b) =>
                a.next.length - b.next.length || Math.abs(a.lane - lane) - Math.abs(b.lane - lane),
            )[0];
          from.next.push(`${depth + 1}:${lane}`);
        }
      for (const node of nodes)
        if (node.next.length === 1 && (depth % 3 === 2 || random() < 0.5)) {
          const extra = nextLanes.find(
            (l) =>
              Math.abs(l - node.lane) <= 1 &&
              !node.next.includes(`${depth + 1}:${l}`),
          );
          if (extra !== undefined) node.next.push(`${depth + 1}:${extra}`);
        }
      result.push(...nodes);
    }
    return result;
  }
  const blank = () => ({ money: 0, supplies: 0, technology: 0, inventory: {} });
  function init(room, G, seed) {
    room.sweep = {
      seed: seed >>> 0,
      depth: -1,
      lane: 1,
      selected: null,
      nodes: rows(seed),
      rosters: {},
      pending: {},
      losses: {},
      initialCost: {},
      nextKey: {},
      ended: false,
      battleIndex: 0,
    };
    for (const p of room.seats.filter((p) => p && G.seatTeam(p.seat) === 0)) {
      if (!p.bot) room.sweep.pending[p.id] = blank();
      room.sweep.losses[p.id] = [];
      room.sweep.rosters[p.id] = room.game.units
        .filter((u) => G.ownerOf(u) === p.seat)
        .map((u) => ({
          key: u.formationIndex,
          entry: structuredClone(p.formation[u.formationIndex]),
          state: save(u),
        }));
      room.sweep.initialCost[p.id] = room.game.units
        .filter((u) => G.ownerOf(u) === p.seat)
        .reduce((n, u) => n + G.modelOf(u).cost, 0);
      room.sweep.nextKey[p.id] = Math.max(-1, ...room.sweep.rosters[p.id].map((r) => r.key)) + 1;
    }
    room.phase = "sweep_map";
    room.game.winner = null;
  }
  function save(u) {
    const state = {};
    // Carry hull resources, damage, ammunition and lifetime uses. Turn-local
    // commands/buffs use another battle clock and must not leak into a new node.
    for (const key of [
      "model",
      "hp",
      "en",
      "shield",
      "brokenParts",
      "moduleHp",
      "moduleBroken",
      "iField",
      "weaponUses",
      "weaponCooldowns",
      "skillUses",
      "pilot",
      "customName",
      "heldWeapon",
    ])
      if (u[key] !== undefined) state[key] = structuredClone(u[key]);
    if (u.overdrive?.baseModel) state.model = u.overdrive.baseModel;
    return state;
  }
  function remainingInventory(inventory = {}, losses = []) {
    const remaining = { ...inventory };
    for (const loss of losses || []) {
      const id = loss.entry.unitId;
      remaining[id] = Math.max(0, (remaining[id] || 0) - 1);
    }
    return remaining;
  }
  function view(room, memberId) {
    const s = room.sweep;
    if (!s) return null;
    return {
      depth: s.depth,
      lane: s.lane,
      selected: s.selected,
      nodes: s.nodes,
      ended: s.ended,
      event: s.event,
      reachable: s.nodes.filter((n) => selectable(room, n)).map((n) => n.id),
      pending: structuredClone(s.pending[memberId] || blank()),
      inventoryRemaining: remainingInventory(room.members.get(memberId)?.inventory, s.losses[memberId]),
      restockReady: Object.keys(s.restockCommitted || {}).filter((id) => s.restockCommitted[id]),
      restockCost: s.restockCost?.[memberId] || { money: 0, supplies: 0 },
      restockUsed: s.restockUsed?.[memberId] || { add: 0, remove: 0, assign: 0, dismiss: 0 },
      restockCommitted: !!s.restockCommitted?.[memberId],
      teams: Object.entries(s.rosters).map(([id, roster]) => ({
        id,
        name: room.members.get(id)?.name || "PMC",
        units: roster.map((r) => ({
          key: r.key,
          unitId: r.entry.unitId,
          kitId: r.entry.kitId,
          ...(r.entry.preload ? { preload: structuredClone(r.entry.preload) } : {}),
          hp: r.state.hp,
          en: r.state.en,
          model: r.state.model,
          ...(r.entry.customPilot ? { customPilot: structuredClone(r.entry.customPilot) } : {}),
          shield: r.state.shield,
          brokenParts: r.state.brokenParts,
        })),
      })),
    };
  }
  function selectable(room, node) {
    const s = room.sweep;
    return (
      !!node &&
      node.depth === s.depth + 1 &&
      (s.depth < 0 ||
        !!s.nodes.find((n) => n.depth === s.depth && n.lane === s.lane)?.next.includes(node.id))
    );
  }
  function select(room, id) {
    const node = room.sweep.nodes.find((n) => n.id === id);
    if (!selectable(room, node)) throw Error("请选择相邻的下一处任务节点");
    room.sweep.selected = id;
  }
  const rewardPools = new WeakMap();
  function rewardPool(room, G) {
    let pools = rewardPools.get(G.catalog);
    if (!pools) rewardPools.set(G.catalog, (pools = new Map()));
    const era = room.settings.sweepEra;
    if (!pools.has(era))
      pools.set(
        era,
        G.catalog.prefabs
          .filter(
            (u) =>
              !u.formOnly &&
              !u.wip &&
              !u.facility &&
              !u.requiredPilotId &&
              !G.isFleetCarrier(
                G.formationModel({ unitId: u.id, kitId: u.defaultKit || u.weaponKits[0]?.id }),
              ) &&
              u.weaponKits.length &&
              u.tags.includes(era),
          )
          .map((u) => ({
            id: u.id,
            cost: G.formationModel({ unitId: u.id, kitId: u.defaultKit || u.weaponKits[0].id })
              .cost,
          }))
          .filter((u) => u.cost > 0),
      );
    return pools.get(era);
  }
  const growth = (room) => 1 + 0.05 * Math.max(0, room.sweep?.depth || 0);
  function reward(room, G, multiplier = 1, unitCount = 0, technologyOutcome = 1) {
    const s = room.sweep,
      eraIndex = Math.max(0, G.eras.indexOf(room.settings.sweepEra));
    for (const p of room.seats.filter((p) => p && !p.bot && G.seatTeam(p.seat) === 0)) {
      const scale = growth(room),
        bonus = s.rewardMultipliers || {};
      const economy =
        typeof BattleEconomy !== "undefined" ? BattleEconomy : require("./battle-economy.js");
      const pending = s.pending[p.id];
      pending.money += economy.roundReward(1000 * scale * multiplier * (bonus.money ?? 1));
      pending.supplies += economy.roundReward(2000 * scale * multiplier * (bonus.supplies ?? 1));
      pending.technology += economy.roundReward(
        250 * scale * multiplier * technologyOutcome * (bonus.technology ?? 1),
      );
      if (unitCount) {
        const limit = enemyLimits(room, G).unitCostLimit;
        let pool = rewardPool(room, G).filter(
          (u) => u.cost >= limit * 0.5 && u.cost <= limit * 1.25,
        );
        if (!pool.length)
          pool = [...rewardPool(room, G)]
            .sort((a, b) => Math.abs(a.cost - limit) - Math.abs(b.cost - limit))
            .slice(0, 12);
        const random = rng(s.seed + s.depth * 1789 + eraIndex + p.seat * 97);
        for (let i = 0; i < Number(unitCount) && pool.length; i++) {
          const unit = pool[Math.floor(random() * pool.length)];
          pending.inventory[unit.id] = (pending.inventory[unit.id] || 0) + 1;
        }
      }
    }
  }
  function recover(room, G, hp, en = hp) {
    for (const roster of Object.values(room.sweep.rosters))
      for (const r of roster) {
        const m = G.models[r.state.model];
        r.state.hp = Math.max(0, Math.min(m.hp, r.state.hp + Math.round(m.hp * hp)));
        r.state.en = Math.max(0, Math.min(m.en, r.state.en + Math.round(m.en * en)));
      }
  }
  function arrived(room, G) {
    const s = room.sweep,
      node = s.nodes.find((n) => n.id === s.selected);
    if (!selectable(room, node)) throw Error("任务节点已经变化");
    s.depth = node.depth;
    s.lane = node.lane;
    s.selected = null;
    if (s.nodes.at(-1).depth - s.depth < 4) {
      const end = s.nodes.at(-1).depth + 1;
      s.nodes.push(...rows(s.seed, end, 7));
      s.nodes = s.nodes.filter((n) => n.depth >= s.depth - 2);
    }
    if (["battle", "elite", "boss"].includes(node.type)) {
      s.elite = node.type === "elite";
      s.boss = node.type === "boss";
      s.battleIndex++;
      return "battle";
    }
    s.event =
      node.type === "rest"
        ? {
            id: "rest",
            name: "PMC前沿休息区",
            text: "整备舰队提供一次服务。补员由每位玩家从个人机库选择，房主确认后继续。",
            choices: ["全队恢复100%耐久和EN", "开放机库补员"],
          }
        : structuredClone(events[Math.floor(rng(s.seed + s.depth * 331)() * events.length)]);
    room.phase = "sweep_event";
    return "event";
  }
  function event(room, G, choice) {
    const s = room.sweep,
      e = s.event;
    if (!e || ![0, 1].includes(choice)) throw Error("事件选项无效");
    if (e.id === "rest") {
      if (choice === 0) recover(room, G, 1);
      else {
        s.resupply = true;
        s.restockUsed = {};
        s.restockCommitted = {};
        s.restockCost = {};
        room.phase = "sweep_resupply";
        return;
      }
    } else if (e.id === "depot" && choice === 0) recover(room, G, 0.25);
    else if (e.id === "storm" && choice === 0) recover(room, G, 0, 0.5);
    else if (e.id === "auction" && choice === 0) {
      for (const p of Object.values(s.pending))
        if (p.money < 1000) throw Error("本局暂存资金不足1000");
      for (const p of Object.values(s.pending)) p.money -= 1000;
      reward(room, G, 0, true);
    } else {
      if (["minefield", "survivors"].includes(e.id))
        recover(room, G, e.id === "minefield" && choice === 1 ? -0.15 : 0, -0.2);
      if (e.id === "storm" && choice === 1) recover(room, G, -0.1, 0);
      reward(
        room,
        G,
        choice === 0 ? 1 : 1.4,
        (e.id === "salvage" && choice === 1) || (e.id === "survivors" && choice === 0),
      );
      if ((e.id === "intel" && choice === 0) || (e.id === "storm" && choice === 1))
        for (const p of Object.values(s.pending))
          p.technology +=
            Math.round((150 * growth(room) * (s.rewardMultipliers?.technology ?? 1)) / 25) * 25;
    }
    for (const [id, roster] of Object.entries(s.rosters)) {
      for (const r of roster.filter((r) => r.state.hp <= 0)) {
        r.eventLoss = true;
        s.losses[id].push(r);
      }
      s.rosters[id] = roster.filter((r) => r.state.hp > 0);
    }
    s.event = null;
    room.phase = "sweep_map";
    if (!survivors(room, G)) finish(room, true);
  }
  function survivors(room, G) {
    return room.seats.some(
      (p) => p && !p.bot && G.seatTeam(p.seat) === 0 && room.sweep.rosters[p.id]?.length,
    );
  }
  function finish(room, failed = false) {
    room.sweep.ended = true;
    room.sweep.failed = failed;
    room.phase = "finished";
    room.game.winner = failed ? 1 : 0;
  }
  function checkpoint(room, G) {
    const s = room.sweep;
    for (const p of room.seats.filter((p) => p && G.seatTeam(p.seat) === 0)) {
      const prior = s.rosters[p.id] || [],
        next = [];
      for (const r of prior) {
        const u = room.game.units.find(
          (u) => G.ownerOf(u) === p.seat && u.formationIndex === r.battleSlot && u.hp > 0,
        );
        if (u) {
          r.state = save(u);
          next.push(r);
        } else s.losses[p.id].push(r);
      }
      s.rosters[p.id] = next;
    }
    for (const roster of Object.values(s.rosters)) {
      const hasSupport = roster.some((r) => {
        const m = G.models[r.state.model];
        return (
          m.supplyAura ||
          m.hangars?.length ||
          m.skills?.some((skill) => ["resupply", "repair"].includes(skill.type))
        );
      });
      if (hasSupport)
        for (const r of roster) {
          const m = G.models[r.state.model];
          r.state.hp = m.hp;
          r.state.en = m.en;
        }
    }
    if (!survivors(room, G)) {
      finish(room, true);
      return;
    }
    if (room.game.winner === 0)
      reward(room, G, s.boss ? 3 : s.elite ? 2 : 1, s.boss ? 5 : s.elite ? 3 : 1, 1.1);
    room.game.winner = null;
    room.phase = "sweep_map";
    room.returnAt = null;
    room.returnCountdown = null;
  }
  function enemyRestrictions(room, G) {
    return {
      ...G.validateTagRestrictions({
        bannedFactions: [...new Set([...(room.settings.bannedFactions || []), ...G.factions.filter(f => f !== room.settings.sweepFaction)])],
        bannedEras: room.settings.bannedEras,
        bannedTypes: room.settings.bannedTypes,
      }),
      characterFaction: null,
      aiAllowedEras: [room.settings.sweepEra],
      environment: G.getMap(room.settings.mapId).environment,
      mapId: room.settings.mapId,
      deploymentSeat: 1,
    };
  }
  const enemyPools = new WeakMap();
  function enemyPool(room, G) {
    const map = G.getMap(room.settings.mapId), restrictions = enemyRestrictions(room, G);
    let cache = enemyPools.get(map);
    if (!cache) enemyPools.set(map, cache = new Map());
    const key = JSON.stringify(restrictions);
    if (!cache.has(key)) {
      const pool = Object.values(G.models).filter(model => !model.formOnly && !model.requiredPilotId && !model.facility &&
        !G.restrictionReason(model, restrictions) &&
        !(map.environment === "space" && model.unitTags?.includes("Infantry") && (model.adaptability?.space ?? 100) < 100) &&
        (model.weapons.length || model.hangars?.length || model.supplyAura || model.skills?.some(s => ["repair","recon"].includes(s.type))) &&
        G.deploymentPlacements({mapId:map.id,tiles:map.tiles,environment:map.environment,units:[]},
          [{unitId:model.prefabId,kitId:model.kitId}],1));
      if (cache.size >= 128) cache.clear();
      cache.set(key, pool);
    }
    return cache.get(key);
  }
  function enemyLimits(room, G) {
    const pool = G ? rewardPool(room, G) : [],
      maximum = pool.length ? Math.min(99999, Math.max(...pool.map((u) => u.cost)) * 2) : 99999;
    const candidates = G ? enemyPool(room, G) : [];
    const minimum = candidates.length ? Math.max(1, Math.min(...candidates.map(u => u.cost))) : 1;
    return {
      costLimit: Math.max(minimum, Math.min(
        99999,
        Math.floor(
          room.settings.costLimit *
            (room.sweep?.boss ? 1 : room.sweep?.elite ? 0.75 : 0.5) *
            growth(room),
        ),
      )),
      unitCostLimit: Math.max(
        minimum,
        Math.min(
          maximum,
          Math.floor(
            room.settings.unitCostLimit *
              (room.sweep?.boss ? 1.5 : room.sweep?.elite ? 1.25 : 0.75) *
              growth(room),
          ),
        ),
      ),
    };
  }
  // Pure draft validation. No wallet, roster or stock mutation until commit.
  function restockPlan(
    G,
    source,
    operations,
    { budget, unitLimit, restrictions, inventory, nextKey = 0 },
  ) {
    if (!Array.isArray(operations) || operations.length > 12) throw Error("整备操作无效");
    const roster = structuredClone(source),
      used = { add: 0, remove: 0, assign: 0, dismiss: 0 },
      cost = { money: 0, supplies: 0 };
    const pricing = typeof Economy !== "undefined" ? Economy : require("./economy.js");
    let key = Math.max(nextKey, ...roster.map((r) => r.key + 1), 0);
    for (const op of operations) {
      if (!Object.hasOwn(used, op.type) || ++used[op.type] > 3) throw Error("每类整备操作最多3次");
      const target = roster.find((r) => r.key === op.key);
      if (op.type === "add") {
        const entry = G.validateFleetFormation(
          [{ unitId: op.entry?.unitId, kitId: op.entry?.kitId }],
          Infinity,
        )[0];
        if (!op.entry.preload || !roster.some((r) => r.key === op.entry.preload.carrierIndex))
          throw Error("请选择存活母舰的格纳库");
        entry.preload = structuredClone(op.entry.preload);
        const u = G.makeUnit(entry, 0, "draft-" + key, { x: 0, y: 0 });
        roster.push({ key: key++, entry, state: save(u) });
        cost.supplies += Math.ceil(pricing.productionOffer(entry.unitId, entry.kitId).supplies / 4);
      } else {
        if (!target) throw Error("整备单位已变化");
        if (op.type === "remove") {
          if (
            !target.entry.preload ||
            roster.some((r) => r.entry.preload?.carrierIndex === target.key)
          )
            throw Error("只能遣返没有乘员的搭载单位");
          if (target.entry.customPilot) throw Error("请先遣返驾驶员");
          cost.supplies += Math.ceil(
            pricing.productionOffer(target.entry.unitId, target.entry.kitId).supplies / 4,
          );
          roster.splice(roster.indexOf(target), 1);
        } else {
          cost.money += 500;
          if (op.type === "dismiss") {
            if (!target.entry.customPilot) throw Error("该单位没有配属驾驶员");
            delete target.entry.customPilot;
            target.state.pilot = G.makeUnit(target.entry, 0, "crew", { x: 0, y: 0 }).pilot;
          } else {
            if (target.entry.customPilot) throw Error("请先遣返当前驾驶员");
            const pilot = G.pilots.custom(op.pilot);
            if (pilot.needsRecruitment || !G.pilots.canAssign(pilot, "PMC"))
              throw Error("驾驶员不可用");
            target.entry.customPilot = pilot;
            target.state.pilot = G.makeUnit(target.entry, 0, "crew", { x: 0, y: 0 }).pilot;
          }
        }
      }
    }
    const positions = new Map(roster.map((r, i) => [r.key, i]));
    const entries = roster.map((r) => {
      const e = structuredClone(r.entry);
      if (e.preload) {
        const index = positions.get(e.preload.carrierIndex);
        if (index === undefined) delete e.preload;
        else e.preload.carrierIndex = index;
      }
      return e;
    });
    const plan = G.planFormation(entries, budget, { ...restrictions, inventory }, unitLimit);
    if (plan.disabled.length) throw Error("库存、科技、格纳库、编组COST或容量不符合限制");
    return {
      roster,
      used,
      cost,
      nextKey: key,
      totalCost: plan.totalCost,
      points: G.formationPoints(entries),
    };
  }
  function enemies(room, G, seed) {
    const limits = enemyLimits(room, G);
    return G.randomFormation(
      seed,
      limits.costLimit,
      {
        ...enemyRestrictions(room, G),
        unitCostLimit: limits.unitCostLimit,
      },
      G.catalog.formation.maxUnits,
    );
  }
  function factionsForEra(G, era) {
    return G.factions.filter((faction) => G.catalog.prefabs.some((p) =>
      !p.wip && !p.formOnly && !p.facility && p.faction === faction && p.tags.includes(era)));
  }
  function mapPool(room, G) {
    const count = Math.max(1, room.seats.filter((p) => p && G.seatTeam(p.seat) === 0).length),
      environment = room.settings.sweepEnvironment || "ground";
    const pool = Object.values(G.catalog.maps).filter(
      (m) =>
        !m.strategic &&
        !m.battlefield &&
        m.scope !== "strategic" &&
        (m.supportedModes || ["regular"]).includes("regular") &&
        m.environment === environment &&
        m.playersPerTeam >= count,
    );
    const capacity = Math.min(...pool.map((m) => m.playersPerTeam));
    return pool.filter((m) => m.playersPerTeam === capacity);
  }
  function chooseMap(room, G, seed) {
    const pool = mapPool(room, G),
      alternatives = pool.filter((m) => m.id !== room.settings.mapId),
      choices = alternatives.length ? alternatives : pool;
    if (!choices.length) throw Error("没有符合人数和环境的扫荡地图");
    return choices[Math.floor(rng(seed)() * choices.length)];
  }
  return {
    events,
    rows,
    init,
    view,
    select,
    arrived,
    event,
    finish,
    checkpoint,
    enemyLimits,
    enemies,
    save,
    reward,
    restockPlan,
    remainingInventory,
    rewardPool,
    mapPool,
    factionsForEra,
    chooseMap,
  };
})();
if (typeof module !== "undefined") module.exports = SweepMode;
