/* 服务端与离线试玩共用的规则，不在这里调整 UI 尺寸或特效。
 * g = 对局，u = 单位，a/b = 攻防双方，w = 武器。
 */
"use strict";
const Tactics = (() => {
  // 机体数值配置。视觉大小另存于 client/ui-layout.json，不影响战斗属性。
  const catalog =
    typeof ART !== "undefined" ? ART : require("../tools/load-catalog.cjs").loadCatalog();
  const models = catalog.models;
  const W = catalog.map.width,
    H = catalog.map.height;
  function validateFormation(entries) {
    if (!Array.isArray(entries) || !entries.length || entries.length > catalog.formation.maxUnits)
      throw Error("编组数量无效，请检查单位数量上限");
    let cost = 0;
    const clean = entries.map((entry) => {
      const id = entry?.unitId + "__" + entry?.kitId,
        model = models[id];
      if (!model) throw Error("编组包含不可用单位或武器套件");
      cost += model.cost;
      return { unitId: model.prefabId, kitId: model.kitId };
    });
    if (cost > catalog.formation.maxCost) throw Error("编组 COST 超出上限");
    return clean;
  }
  function randomFormation(seed = 7319) {
    const choices = Object.values(models),
      entries = [];
    let remaining = catalog.formation.maxCost;
    for (let i = 0; i < Math.min(catalog.formation.aiUnits, catalog.formation.maxUnits); i++) {
      const legal = choices.filter((m) => m.cost <= remaining);
      if (!legal.length) break;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const m = legal[seed % legal.length];
      entries.push({ unitId: m.prefabId, kitId: m.kitId });
      remaining -= m.cost;
    }
    return validateFormation(entries);
  }
  function deploymentCells(g, team) {
    const spawn = catalog.deployment.spawns[team],
      cells = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (
          dist({ x, y }, spawn) <= catalog.deployment.radius &&
          Number.isFinite(terrain[g.tiles[y][x]].cost)
        )
          cells.push({ x, y });
    return cells.sort((a, b) => dist(a, spawn) - dist(b, spawn) || a.y - b.y || a.x - b.x);
  }
  function deploy(g, team, id, x, y) {
    if (!g.deployment || g.deployment[team]) throw Error("部署已确认，不能再调整");
    const u = g.units.find((u) => u.id === id && u.team === team);
    if (
      !u ||
      !Number.isInteger(x) ||
      !Number.isInteger(y) ||
      !deploymentCells(g, team).some((c) => c.x === x && c.y === y)
    )
      throw Error("请在己方出生区的有效格子部署");
    if (g.units.some((other) => other.id !== id && other.x === x && other.y === y))
      throw Error("该部署位置已有单位");
    u.x = x;
    u.y = y;
  }
  function confirmDeployment(g, team) {
    if (!g.deployment || g.deployment[team]) throw Error("部署已确认，不能再次确认");
    for (const u of g.units.filter((u) => u.team === team)) {
      if (!deploymentCells(g, team).some((c) => c.x === u.x && c.y === u.y))
        throw Error("单位不在有效部署区域");
      if (g.units.some((other) => other.id !== u.id && other.x === u.x && other.y === u.y))
        throw Error("部署位置重叠");
    }
    g.deployment[team] = true;
    return g.deployment.every(Boolean);
  }
  const terrain = {
    plain: { name: "平地", cost: 1, cover: 0, color: "#243b3d" },
    forest: { name: "林地", cost: 2, cover: 15, color: "#294738" },
    rubble: { name: "废墟", cost: 2, cover: 10, color: "#43494a" },
    rock: { name: "山岩", cost: Infinity, cover: 0, color: "#596064" },
    water: { name: "水域", cost: Infinity, cover: 0, color: "#234c61" },
  };
  const key = (x, y) => x + "," + y,
    dist = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
    typeNames = { beam: "光束", shell: "实弹", melee: "格斗" };
  function create(
    ai = false,
    seed = 7319,
    formations = [randomFormation(seed), randomFormation(seed + 1)],
    deploying = false,
  ) {
    let baseTiles = Array.from({ length: 9 }, () => Array(12).fill("plain"));
    for (const [x, y] of [
      [3, 1],
      [3, 2],
      [3, 6],
      [3, 7],
      [8, 1],
      [8, 2],
      [8, 6],
      [8, 7],
    ])
      baseTiles[y][x] = "forest";
    for (const [x, y] of [
      [5, 2],
      [6, 2],
      [5, 6],
      [6, 6],
    ])
      baseTiles[y][x] = "rock";
    for (const [x, y] of [
      [5, 4],
      [6, 4],
      [4, 4],
      [7, 4],
    ])
      baseTiles[y][x] = "rubble";
    for (const [x, y] of [
      [5, 0],
      [6, 0],
      [5, 8],
      [6, 8],
    ])
      baseTiles[y][x] = "water";
    const tiles = Array.from({ length: H }, (_, y) =>
      Array.from(
        { length: W },
        (_, x) => baseTiles[Math.floor((y * 9) / H)][Math.floor((x * 12) / W)],
      ),
    );
    let units = [];
    for (let team = 0; team < 2; team++)
      validateFormation(formations[team]).forEach((entry, i) => {
        const model = entry.unitId + "__" + entry.kitId;
        const position = deploymentCells({ tiles }, team)[i];
        if (!position) throw Error("出生区没有足够位置容纳编组，请检查目录配置");
        let m = models[model];
        units.push({
          id: team + "-" + i,
          model,
          team,
          x: position.x,
          y: position.y,
          hp: m.hp,
          shield: m.shield.hp,
          en: m.en,
          moved: false,
          acted: false,
          origin: null,
          angle: team ? -90 : 90,
          heldWeapon: m.weapons[0].id,
        });
      });
    return {
      tiles,
      units,
      deployment: deploying ? [false, false] : null,
      team: 0,
      round: 1,
      ai,
      seed: seed >>> 0,
      winner: null,
    };
  }
  function at(g, x, y) {
    return g.units.find((u) => u.hp > 0 && u.x === x && u.y === y);
  }
  // 按地形消耗搜索可达格子，同时保存各格子的移动路径。
  function reachable(g, u) {
    let best = new Map([[key(u.x, u.y), { x: u.x, y: u.y, cost: 0, path: [] }]]),
      queue = [best.get(key(u.x, u.y))];
    while (queue.length) {
      queue.sort((a, b) => a.cost - b.cost);
      let n = queue.shift();
      if (n.cost !== best.get(key(n.x, n.y)).cost) continue;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        let x = n.x + dx,
          y = n.y + dy;
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        let occupant = at(g, x, y);
        if (occupant && occupant.id !== u.id) continue;
        let cost = n.cost + terrain[g.tiles[y][x]].cost;
        if (cost > models[u.model].move) continue;
        let k = key(x, y);
        if (best.has(k) && best.get(k).cost <= cost) continue;
        let entry = { x, y, cost, path: [...n.path, { x, y }] };
        best.set(k, entry);
        queue.push(entry);
      }
    }
    return best;
  }
  function move(g, u, x, y) {
    if (g.winner !== null || u.team !== g.team || u.acted || u.moved) throw Error("本单位无法移动");
    let tile = reachable(g, u).get(key(x, y));
    if (!tile || !tile.path.length) throw Error("该位置不可移动");
    u.origin = { x: u.x, y: u.y };
    u.x = x;
    u.y = y;
    u.moved = true;
    return tile.path;
  }
  function undo(g, u) {
    if (u.acted || !u.origin) throw Error("无法撤销");
    Object.assign(u, u.origin);
    u.origin = null;
    u.moved = false;
  }
  function canUse(u, w) {
    return u.hp > 0 && u.en >= w.en;
  }
  function inRange(a, b, w) {
    let d = dist(a, b);
    return d >= w.min && d <= w.max;
  }
  function canAttack(g, a, b, w) {
    return (
      !!a && !!b && a.hp > 0 && b.hp > 0 && a.team !== b.team && canUse(a, w) && inRange(a, b, w)
    );
  }
  // 返回预估命中率和命中后的伤害，不修改对局。
  function estimate(g, a, b, w, response = "counter") {
    const bonuses = models[a.model].attackBonuses,
      categoryBonus = 1 + bonuses[w.type === "melee" ? "melee" : "shooting"] / 100;
    const defender = models[b.model],
      cover = terrain[g.tiles[b.y][b.x]].cover,
      mobilityPenalty = (defender.mobility - 100) * 0.25,
      hit = Math.max(
        10,
        Math.min(100, w.hit - cover - mobilityPenalty - (response === "evade" ? 35 : 0)),
      ),
      multiplier = (w.type === "melee" ? 1 : 1 - cover / 100) * (response === "defend" ? 0.5 : 1),
      count = w.shotCount * w.hitsPerShot;
    // MOD: subtract flat protection per projectile/component, then apply percentage protection.
    function protectedDamage(defenses) {
      return (
        Object.entries(w.damageComponents).reduce((sum, [channel, value]) => {
          const percentKey =
              channel === "meleeBeam" ? "beam" : channel === "meleeShell" ? "shell" : channel,
            flatKey = channel.startsWith("melee") ? "melee" : channel;
          const element =
              channel === "meleeBeam" ? "beam" : channel === "meleeShell" ? "shell" : channel,
            elementBonus =
              element === "beam" || element === "shell" ? 1 + bonuses[element] / 100 : 1;
          return (
            sum +
            Math.max(0, value * categoryBonus * elementBonus - defenses[flatKey].flat) *
              (1 - defenses[percentKey].percent / 100)
          );
        }, 0) * multiplier
      );
    }
    const damage = Math.round(protectedDamage(defender.defenses)) * count,
      shieldDamage = Math.min(
        b.shield ?? 0,
        Math.round(protectedDamage(defender.shield.defenses) * defender.shield.coverage) * count,
      );
    return {
      hit,
      damage,
      shieldDamage,
      blockedDamage: Math.max(0, damage - shieldDamage),
      blockChance: b.shield > 0 ? defender.shield.blockChance : 0,
    };
  }
  function spend(u, w) {
    if (w.en) u.en -= w.en;
    if (w.changeHeldWeapon !== false) u.heldWeapon = w.id;
  }
  function random(g) {
    g.seed = (Math.imul(1664525, g.seed) + 1013904223) >>> 0;
    return g.seed / 4294967296;
  }
  // 真正结算入口：校验 → 扣资源 → 随机命中 → 扣血 → 生成演出事件。
  function fight(g, a, b, w, response, counterId) {
    if (g.winner !== null || a.team !== g.team || a.acted || !canAttack(g, a, b, w))
      throw Error("攻击条件已失效");
    if (!["counter", "defend", "evade"].includes(response)) throw Error("未知应战方式");
    let cw = models[b.model].weapons.find((x) => x.id === counterId);
    if (response === "counter" && (!cw || !canAttack(g, b, a, cw)))
      throw Error("反击武器不满足射程或资源要求");
    let events = [],
      dodgeSeed = (g.seed ^ 0x9e3779b9) >>> 0;
    const dodgeSlots = { [a.id]: 0, [b.id]: 0 };
    function dodgeSide() {
      // Independent visual RNG: choosing a dodge direction never changes hit rolls.
      dodgeSeed = (Math.imul(1664525, dodgeSeed) + 1013904223) >>> 0;
      return dodgeSeed < 0x80000000 ? -1 : 1;
    }
    function fire(from, to, weapon, stance) {
      spend(from, weapon);
      const before = to.hp,
        shieldBefore = to.shield,
        sourceDodgeSlot = dodgeSlots[from.id],
        targetDodgeSlot = dodgeSlots[to.id],
        strikes = [];
      // One server roll per bullet / melee strike. Resources are spent once per attack.
      const single = { ...weapon, shotCount: 1, hitsPerShot: 1 };
      for (const step of weapon.attack.strikes) {
        const e = estimate(g, from, to, single, stance),
          executed = to.hp > 0,
          hit = executed && random(g) < e.hit / 100,
          blocked = hit && to.shield > 0 && random(g) < e.blockChance,
          shieldDamage = blocked ? e.shieldDamage : 0,
          damage = hit ? Math.min(to.hp, blocked ? e.blockedDamage : e.damage) : 0;
        let dodgeTo = null;
        if (executed && !hit) {
          dodgeTo = dodgeSlots[to.id] === 0 ? dodgeSide() : 0;
          dodgeSlots[to.id] = dodgeTo;
        }
        strikes.push({
          ...step,
          executed,
          hit,
          dodgeTo,
          blocked,
          damage,
          shieldDamage,
          before: to.hp,
          after: to.hp - damage,
          shieldBefore: to.shield,
          shieldAfter: to.shield - shieldDamage,
          hitChance: e.hit,
        });
        to.hp -= damage;
        to.shield -= shieldDamage;
      }
      events.push({
        from: from.id,
        to: to.id,
        weapon: weapon.id,
        model: from.model,
        type: weapon.type,
        clip: weapon.clip,
        heldWeapon: from.heldWeapon,
        shotCount: weapon.shotCount,
        damagePerShot: weapon.damagePerShot,
        sourceDodgeSlot,
        targetDodgeSlot,
        targetDodgeEnd: dodgeSlots[to.id],
        strikes,
        hit: strikes.some((s) => s.hit),
        hitCount: strikes.filter((s) => s.hit).length,
        strikeCount: strikes.filter((s) => s.executed).length,
        damage: before - to.hp,
        before,
        blocked: strikes.some((s) => s.blocked),
        shieldBefore,
        shieldAfter: to.shield,
        shieldDamage: shieldBefore - to.shield,
        after: to.hp,
        hitChance: strikes[0].hitChance,
        response: stance,
      });
    }
    fire(a, b, w, response);
    if (response === "counter" && b.hp > 0 && canAttack(g, b, a, cw)) fire(b, a, cw, "counter");
    a.acted = true;
    a.origin = null;
    let alive = [0, 1].map((t) => g.units.some((u) => u.team === t && u.hp > 0));
    if (!alive[0] || !alive[1]) g.winner = alive[0] ? 0 : 1;
    return events;
  }
  function wait(g, u) {
    if (g.winner !== null || u.team !== g.team || u.acted) throw Error("无法待机");
    u.acted = true;
    u.origin = null;
  }
  function end(g) {
    if (g.winner !== null) throw Error("战斗已经结束");
    g.team = 1 - g.team;
    if (!g.team) g.round++;
    for (const u of g.units.filter((u) => u.team === g.team && u.hp > 0)) {
      u.acted = false;
      u.moved = false;
      u.origin = null;
      u.en = Math.min(models[u.model].en, u.en + 15);
    }
  }
  function bestResponse(g, a, b, w) {
    let attack = estimate(g, a, b, w),
      counter = models[b.model].weapons
        .filter((c) => canAttack(g, b, a, c))
        .sort((x, y) => {
          let ex = estimate(g, b, a, x),
            ey = estimate(g, b, a, y);
          return ey.damage * ey.hit - ex.damage * ex.hit;
        })[0];
    if (b.hp <= attack.damage && b.hp > attack.damage / 2) return { response: "defend" };
    return counter ? { response: "counter", weapon: counter.id } : { response: "evade" };
  }
  function aiChoice(g, u) {
    let cells = u.moved ? [{ x: u.x, y: u.y, cost: 0, path: [] }] : [...reachable(g, u).values()],
      enemies = g.units.filter((e) => e.team !== u.team && e.hp > 0),
      best = null;
    for (const c of cells) {
      let virtual = { ...u, x: c.x, y: c.y },
        near = Math.min(...enemies.map((e) => dist(virtual, e)));
      let score = -near * 0.12 - c.cost * 0.025 + terrain[g.tiles[c.y][c.x]].cover * 0.006,
        target = null,
        weapon = null;
      for (const e of enemies)
        for (const w of models[u.model].weapons)
          if (canAttack(g, virtual, e, w)) {
            let ex = estimate(g, virtual, e, w),
              s =
                2 +
                (ex.damage * ex.hit) / 100000 +
                Math.min(1, ex.damage / e.hp) * 0.6 -
                c.cost * 0.025;
            if (s > score) {
              score = s;
              target = e.id;
              weapon = w.id;
            }
          }
      if (!best || score > best.score) best = { ...c, score, target, weapon };
    }
    return best;
  }
  return {
    W,
    H,
    models,
    catalog,
    validateFormation,
    randomFormation,
    deploymentCells,
    deploy,
    confirmDeployment,
    terrain,
    typeNames,
    key,
    dist,
    create,
    at,
    reachable,
    move,
    undo,
    canUse,
    inRange,
    canAttack,
    estimate,
    fight,
    wait,
    end,
    bestResponse,
    aiChoice,
  };
})();
if (typeof module !== "undefined") module.exports = Tactics;
