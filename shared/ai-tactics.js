/* Authoritative group tactics. Decisions are shared by a player's force for one phase.
 * Movement, capture, attack legality and resource charges remain in the existing rules. */
"use strict";
const AITactics = (() => {
  const phases = new WeakMap();
  const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const center = (units) => ({
    x: units.reduce((n, u) => n + u.x, 0) / Math.max(1, units.length),
    y: units.reduce((n, u) => n + u.y, 0) / Math.max(1, units.length),
  });
  function settings(input = {}) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw Error("AI策略设置无效");
    const difficulty = input.difficulty ?? "normal", aggression = input.aggression ?? "normal";
    if (!["easy", "normal", "hard"].includes(difficulty) ||
        !["low", "normal", "high"].includes(aggression)) throw Error("AI策略设置无效");
    const teams = input.teams ?? [{}, {}];
    if (!Array.isArray(teams) || teams.length !== 2) throw Error("阵营设置无效");
    return { difficulty, aggression, teams: teams.map((team) => {
      const research = team?.research ?? 1, durability = team?.durability ?? 1,
        resources = team?.resources ?? 1;
      if (![0.75, 1, 1.25].includes(research) || ![0.75, 1, 1.25].includes(durability) ||
          ![0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].includes(resources)) throw Error("阵营倍率设置无效");
      return { research, durability, resources };
    }) };
  }
  // COST and numbers both matter. Damage reduces effective strength without making
  // a nearly destroyed high-COST unit entirely irrelevant.
  function power(units, modelOf) {
    return units.reduce((total, u) => {
      const m = modelOf(u), health = Math.max(0, Math.min(1, (u.hp ?? m.hp) / Math.max(1, m.hp)));
      return total + (Math.max(25, m.cost) + 100) * (0.25 + health * 0.75) * (u.campaignDurability ?? 1);
    }, 0);
  }
  function decide(G, game, unit) {
    let phase = phases.get(game);
    const key = game.round + ":" + game.team;
    if (!phase || phase.key !== key) phases.set(game, phase = { key, players: new Map() });
    const seat = G.controllerOf(game, unit);
    if (phase.players.has(seat)) return phase.players.get(seat);
    const config = settings(game.aiOptions),
      allies = game.units.filter((u) => G.onMap(u) && u.team === unit.team && !u.embarked),
      squad = allies.filter((u) => G.controllerOf(game, u) === seat && G.modelOf(u).move > 0 && !u.deployed),
      enemies = game.units.filter((u) => G.onMap(u) && u.team !== unit.team && !u.embarked),
      origin = center(squad.length ? squad : [unit]),
      enemyCenter = enemies.length ? center(enemies) : origin,
      ratio = power(allies, G.modelOf) / Math.max(1, power(enemies, G.modelOf)),
      field = game.campaignBattlefield,
      base = field?.layout.nodes.find((n) => n.kind === "base"),
      defender = !!field && field.defender === unit.team;
    let state = "advance", goal = enemyCenter;
    const posts = field?.layout.nodes.filter((n) => n.kind === "outpost") || [];
    if (field && defender && ratio < 1.75) {
      state = "defend";
      const threatened = enemies.some((e) => distance(e, base) < 12);
      const positions = posts.filter((p) => field.owners[p.id] === unit.team);
      goal = threatened || !positions.length ? base : positions.reduce((best, p) =>
        distance(p, enemyCenter) + distance(p, base) * 0.5 <
        distance(best, enemyCenter) + distance(best, base) * 0.5 ? p : best);
    } else if (field && ratio < 0.75) {
      state = "gather";
      const positions = posts.filter((p) => !enemies.some((e) => distance(e, p) < 6));
      goal = positions.length ? positions.reduce((best, p) => {
        const score = (node) => distance(origin, node) + distance(node, base) * 0.4 +
          (field.owners[node.id] === unit.team ? 0 : 5);
        return score(p) < score(best) ? p : best;
      }) : origin;
    } else if (field) {
      state = ratio >= 1.75 ? "overrun" : "advance";
      const targets = posts.filter((p) => field.owners[p.id] !== unit.team);
      const destination = defender ? enemyCenter : base;
      // Capture posts along the advance, rather than bypassing them for the base.
      goal = targets.length ? targets.reduce((best, p) =>
        distance(origin, p) + distance(p, destination) * 0.65 <
        distance(origin, best) + distance(best, destination) * 0.65 ? p : best) : destination;
    } else if (squad.length > 1 && ratio < 1.75) {
      // Encounter battles regroup on the move; they never wait for strategic reinforcements.
      state = config.difficulty !== "easy" && squad.length >= 4 ? "flank" : "advance";
    } else if (ratio >= 1.75) state = "overrun";
    if (config.difficulty === "easy" && !defender && state !== "gather") state = "advance";
    const decision = { state, goal, origin, ratio, difficulty: config.difficulty,
      squad: squad.map((u) => u.id), friends: squad, enemies, strategic: !!field };
    phase.players.set(seat, decision);
    return decision;
  }
  function positionScore(G, game, unit, cell, decision) {
    const { state, origin, difficulty } = decision;
    let goal = decision.goal;
    const index = decision.squad.indexOf(unit.id),
      separation = distance(origin, goal),
      flank = difficulty !== "easy" && decision.squad.length >= 4 &&
        ["advance", "flank"].includes(state) && separation > 6;
    if (flank) {
      const side = index % 2 ? 1 : -1, width = Math.min(difficulty === "hard" ? 6 : 4, separation * 0.3);
      goal = { x: goal.x - (goal.y - origin.y) / separation * width * side,
        y: goal.y + (goal.x - origin.x) / separation * width * side };
    }
    const cautious = ["gather", "defend"].includes(state);
    let score = -distance(cell, goal) * (cautious ? 0.85 : 0.45);
    if (decision.squad.length > 1 && state !== "overrun") {
      const friends = decision.friends.filter((u) => u.id !== unit.id);
      const nearest = friends.length ? Math.min(...friends.map((u) => distance(cell, u))) : 0;
      score -= Math.max(0, nearest - 4) * (difficulty === "easy" ? 0.08 : 0.25);
    }
    score += (G.terrain[game.tiles[cell.y]?.[cell.x]]?.cover || 0) * (cautious ? 0.025 : 0.006);
    if (difficulty === "hard" && cautious) {
      const threats = decision.enemies;
      score -= threats.filter((u) => distance(cell, u) <= 6).length * 0.4;
    }
    return score;
  }
  function firstStep(world, from, target, allowed = () => true) {
    const queue = [{ id: from, first: null }], visited = new Set([from]);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      if (current.id !== from && target(current.id)) return current.first;
      for (const id of world.regions.find((r) => r.id === current.id).links)
        if (!visited.has(id) && allowed(id)) {
          visited.add(id); queue.push({ id, first: current.first || id });
        }
    }
    return null;
  }
  function strategic(ctx, state, members, helpers) {
    const options = settings(state.options), world = ctx.world,
      bots = members.filter((m) => m.bot && Number.isInteger(m.seat)),
      holder = (id) => state.regions.find((r) => r.id === id),
      alive = state.units.filter((u) => !u.destroyed && !u.pendingTransfer),
      model = (u) => {
        const m = ctx.G.models[u.unitId + "__" + u.kitId];
        return m && u.campaignDurability ? { ...m, hp: Math.ceil(m.hp * u.campaignDurability) } : m;
      },
      force = (units) => power(units.map((u) => ({ ...u, hp: u.state?.hp })), model),
      minGroup = { low: 6, normal: 4, high: 3 }[options.aggression],
      attackTurn = options.aggression === "high" ||
        (options.aggression === "normal" ? state.turn % 3 !== 0 : state.turn % 3 === 0);
    // Research is a team decision, not multiplied by the number of AI seats.
    for (const team of new Set(bots.map((p) => ctx.G.seatTeam(p.seat)))) {
      const pool = state.teams[team];
      for (let i = 0; i < (options.difficulty === "hard" ? 2 : 1); i++) {
        const node = ctx.development.nodes(pool.faction).find((n) => !pool.researched.includes(n.id) &&
          n.requires.every((id) => pool.researched.includes(id)) && n.points <= pool.technology &&
          (n.money || 0) <= pool.money && (n.supplies || 0) <= pool.supplies);
        if (!node) break;
        pool.researched.push(node.id); pool.technology -= node.points;
        pool.money -= node.money || 0; pool.supplies -= node.supplies || 0;
      }
    }
    for (const player of bots) {
      const team = ctx.G.seatTeam(player.seat), pool = state.teams[team],
        own = alive.filter((u) => helpers.controller(members, u) === player.seat && !helpers.busy(state, u) &&
          !u.state?.embarked && !state.transfers.some((t) => t.ids.includes(u.id)));
      for (const regionId of new Set(own.map((u) => u.region))) {
        if (helpers.disputed(state, regionId)) continue;
        const group = own.filter((u) => u.region === regionId),
          region = world.regions.find((r) => r.id === regionId),
          enemyNeighbors = region.links.filter((id) => holder(id).owner !== team),
          targets = enemyNeighbors.map((id) => ({ id, units: alive.filter((u) => u.region === id && u.team !== team) }))
            .sort((a, b) => force(a.units) - force(b.units));
        let next = null;
        if (group.length >= minGroup && attackTurn) {
          const target = targets.find((t) => force(group) >= force(t.units) *
            (options.difficulty === "easy" ? 0.7 : 1.1));
          if (target) next = target.id;
        }
        if (!enemyNeighbors.length || group.length < minGroup) {
          const front = world.regions.filter((r) => r.id !== regionId && holder(r.id).owner === team &&
            r.links.some((id) => holder(id).owner !== team) &&
            (!enemyNeighbors.length || own.filter((u) => u.region === r.id).length > group.length));
          // Join the strongest friendly frontier, instead of sending isolated units into enemy land.
          front.sort((a, b) => force(own.filter((u) => u.region === b.id)) -
            force(own.filter((u) => u.region === a.id)));
          for (const target of front) {
            next = firstStep(world, regionId, (id) => id === target.id, (id) => holder(id).owner === team);
            if (next) break;
          }
        }
        for (const unit of group) unit.moveTo = next;
      }
      const factories = world.regions.filter((r) => r.factory && holder(r.id).owner === team &&
        !helpers.disputed(state, r.id));
      const available = ctx.G.catalog.prefabs.filter((p) => helpers.available(ctx, state, team, p.id) &&
        !p.unitTags?.includes("Ship") && !p.unitTags?.includes("Support"));
      const population = new Map();
      for (const unit of alive.filter((u) => u.team === team))
        population.set(unit.unitId, (population.get(unit.unitId) || 0) + 1);
      for (const order of state.orders.filter((o) => o.team === team))
        population.set(order.unitId, (population.get(order.unitId) || 0) + order.quantity);
      const quotes = available.map((p) => helpers.quote(ctx, p.id)).filter(Boolean);
      for (const factory of factories) {
        if (state.orders.filter((o) => o.region === factory.id && o.ownerSeat === player.seat).length >= 2) continue;
        const choices = quotes.filter((q) =>
          q.money <= pool.money * 0.7 && q.supplies <= pool.supplies * 0.7);
        choices.sort((a, b) => {
          const value = (q) => (model(q)?.cost || 50) /
            (50 + q.money + q.supplies * 0.25) / (1 + (population.get(q.unitId) || 0) * 0.2);
          return value(b) - value(a) || a.unitId.localeCompare(b.unitId);
        });
        const price = choices[0];
        if (!price || !helpers.charge(pool, price)) continue;
        state.orders.push({ id: "order-" + state.nextId++, ownerSeat: player.seat, team,
          region: factory.id, ...price, status: "queued", remaining: price.turns, reserved: true });
        population.set(price.unitId, (population.get(price.unitId) || 0) + price.quantity);
      }
    }
  }
  return { settings, power, decide, positionScore, strategic };
})();
if (typeof module !== "undefined") module.exports = AITactics;
