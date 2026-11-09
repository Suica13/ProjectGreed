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
    const random = rng(seed + start * 7309),
      result = [];
    for (let depth = start; depth < start + count; depth++) {
      const nodes = [];
      for (let lane = 0; lane < 3; lane++) {
        const r = random();
        const type =
          depth === 0
            ? "battle"
            : depth % 5 === 4
              ? lane === 1
                ? "rest"
                : "elite"
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
          next: [0, 1, 2].filter((n) => Math.abs(n - lane) <= 1).map((n) => depth + 1 + ":" + n),
        });
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
      pending: structuredClone(s.pending[memberId] || blank()),
      teams: Object.entries(s.rosters).map(([id, roster]) => ({
        id,
        name: room.members.get(id)?.name || "PMC",
        units: roster.map((r) => ({
          key: r.key,
          unitId: r.entry.unitId,
          kitId: r.entry.kitId,
          hp: r.state.hp,
          en: r.state.en,
          model: r.state.model,
        })),
      })),
    };
  }
  function selectable(room, node) {
    const s = room.sweep;
    return (
      !!node && node.depth === s.depth + 1 && (s.depth < 0 || Math.abs(s.lane - node.lane) <= 1)
    );
  }
  function select(room, id) {
    const node = room.sweep.nodes.find((n) => n.id === id);
    if (!selectable(room, node)) throw Error("请选择相邻的下一处任务节点");
    room.sweep.selected = id;
  }
  function reward(room, G, multiplier = 1, rare = false) {
    const s = room.sweep,
      eraIndex = Math.max(0, G.eras.indexOf(room.settings.sweepEra));
    for (const p of room.seats.filter((p) => p && !p.bot && G.seatTeam(p.seat) === 0)) {
      const scale =
        Math.max(0.25, Math.min(room.settings.costLimit, s.initialCost[p.id]) / 2000) *
        (1 + Math.min(s.depth, 30) * 0.06);
      const pending = s.pending[p.id];
      pending.money += Math.floor(500 * scale * multiplier);
      pending.supplies += Math.floor(1000 * scale * multiplier);
      pending.technology += Math.floor(100 * scale * multiplier);
      if (rare) {
        const pool = G.catalog.prefabs.filter(
          (u) =>
            !u.formOnly &&
            !u.wip &&
            u.weaponKits.length &&
            u.tags.includes(room.settings.sweepEra) &&
            !u.facility &&
            u.stats.cost <= Math.max(500, room.settings.unitCostLimit * 1.5) &&
            !u.requiredPilotId &&
            !u.stats.ship,
        );
        const random = rng(s.seed + s.depth * 1789 + eraIndex + p.seat * 97);
        if (pool.length) {
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
    if (node.type === "battle" || node.type === "elite") {
      s.elite = node.type === "elite";
      s.battleIndex++;
      return "battle";
    }
    s.event =
      node.type === "rest"
        ? {
            id: "rest",
            name: "PMC前沿休息区",
            text: "整备舰队提供一次服务。补员由每位玩家从个人机库选择，房主确认后继续。",
            choices: ["全队恢复50%耐久和EN", "开放机库补员"],
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
      if (choice === 0) recover(room, G, 0.5);
      else {
        s.resupply = true;
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
        for (const p of Object.values(s.pending)) p.technology += 200;
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
    if (!survivors(room, G)) {
      finish(room, true);
      return;
    }
    if (room.game.winner === 0) reward(room, G, s.elite ? 2 : 1, s.elite);
    room.game.winner = null;
    room.phase = "sweep_map";
    room.returnAt = null;
    room.returnCountdown = null;
  }
  function enemyLimits(room) {
    return {
      costLimit: Math.floor(room.settings.costLimit / 2),
      unitCostLimit: Math.floor(room.settings.unitCostLimit * (room.sweep?.elite ? 1.25 : 0.75)),
    };
  }
  function enemies(room, G, seed) {
    const limits = enemyLimits(room);
    return G.randomFormation(
      seed,
      limits.costLimit,
      {
        ...G.validateTagRestrictions({
          bannedFactions: [
            ...new Set([
              ...room.settings.bannedFactions,
              ...G.factions.filter((f) => f !== room.settings.sweepFaction),
            ]),
          ],
          bannedEras: room.settings.bannedEras,
          bannedTypes: room.settings.bannedTypes,
        }),
        characterFaction: null,
        aiAllowedEras: [room.settings.sweepEra],
        unitCostLimit: limits.unitCostLimit,
        environment: G.getMap(room.settings.mapId).environment,
      },
      G.catalog.formation.maxUnits,
    );
  }
  return { events, rows, init, view, select, arrived, event, finish, checkpoint, enemyLimits, enemies, save };
})();
if (typeof module !== "undefined") module.exports = SweepMode;
