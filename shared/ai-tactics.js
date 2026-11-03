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
  function captureCapable(G, unit) {
    return G.modelOf(unit).movementType !== "air" &&
      (!unit.flying || G.unitSkills(unit).some((skill) => skill.type === "flight"));
  }
  function captureGoal(G, game, unit, origin = unit, nearby = true) {
    if (!game.campaignBattlefield || !captureCapable(G, unit)) return null;
    const field = game.campaignBattlefield;
    const targets = field.layout.nodes.filter((point) => field.owners[point.id] !== unit.team &&
      (!nearby || distance(origin, point) <= Math.max(6, G.modelOf(unit).move + 2)) &&
      !game.units.some((enemy) => enemy.team !== unit.team && G.onMap(enemy) &&
        G.cells(enemy).some((cell) => Math.max(Math.abs(cell.x-point.x), Math.abs(cell.y-point.y)) <= 1)));
    return targets.sort((a,b) => distance(origin,a)-distance(origin,b))[0] || null;
  }
  function forUnit(G, game, unit, decision) {
    if (!game.campaignBattlefield) return decision;
    if (captureCapable(G, unit)) {
      const target = captureGoal(G, game, unit);
      return target ? { ...decision, goal: target } : decision;
    }
    const passenger = game.units.find((u) => u.hp > 0 && u.embarked?.carrierId === unit.id &&
      captureCapable(G,u) && G.hangars.readyToLaunch(u));
    const target = passenger && captureGoal(G, game, passenger, unit, false);
    // Transports deliver capturers. Aircraft without capturers continue fighting
    // instead of inheriting the ground squad's occupation destination.
    const goal = target || (decision.enemies.length ? center(decision.enemies) : decision.origin);
    return { ...decision, goal, avoidObjective: true };
  }
  function positionScorer(G, game, unit, decision) {
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
    const friends = decision.friends.filter((friend) => friend.id !== unit.id);
    const objectiveOffsets = decision.avoidObjective ? G.cells(unit, 0, 0) : [];
    return (cell) => {
      let score = -distance(cell, goal) * (cautious ? 0.85 : 0.45);
      if (decision.squad.length > 1 && state !== "overrun") {
        let nearest = friends.length ? Infinity : 0;
        for (const friend of friends) nearest = Math.min(nearest, distance(cell, friend));
        score -= Math.max(0, nearest - 4) * (difficulty === "easy" ? 0.08 : 0.25);
      }
      if (decision.avoidObjective && game.campaignBattlefield.layout.nodes.some((point) =>
        objectiveOffsets.some((tile) => Math.max(Math.abs(tile.x+cell.x-point.x), Math.abs(tile.y+cell.y-point.y)) <= 1)))
        score -= 12;
      score += (G.terrain[game.tiles[cell.y]?.[cell.x]]?.cover || 0) * (cautious ? 0.025 : 0.006);
      if (difficulty === "hard" && cautious) {
        const threats = decision.enemies;
        let nearby = 0;
        for (const threat of threats) if (distance(cell, threat) <= 6) nearby++;
        score -= nearby * 0.4;
      }
      return score;
    };
  }
  function positionScore(G, game, unit, cell, decision) {
    return positionScorer(G, game, unit, decision)(cell);
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
      unitPower = new Map(),
      // Strategic strength uses actual COST, not the tactical per-actor bonus:
      // ten cheap vehicles must not look stronger just because there are ten actors.
      force = (units) => units.reduce((total, u) => {
        if (!unitPower.has(u)) {
          const m = model(u), health = Math.max(0, Math.min(1,
            (u.state?.hp ?? m.hp) / Math.max(1, m.hp)));
          unitPower.set(u, Math.max(0, m.cost) * (0.25 + health * 0.75) * (u.campaignDurability ?? 1));
        }
        return total + unitPower.get(u);
      }, 0),
      minGroup = { low: 6, normal: 4, high: 3 }[options.aggression],
      // Low / normal / high attack on 1/6, 1/3 and 1/2 of turns respectively.
      attackTurn = state.turn % ({ low: 6, normal: 3, high: 2 }[options.aggression]) === 0;
    const passengers = new Map();
    for (const unit of alive) {
      const carrierId = unit.state?.embarked?.carrierId;
      if (!carrierId) continue;
      if (!passengers.has(carrierId)) passengers.set(carrierId, []);
      passengers.get(carrierId).push(unit);
    }
    // Research is a team decision, not multiplied by the number of AI seats.
    for (const team of new Set(bots.map((p) => ctx.G.seatTeam(p.seat)))) {
      const pool = state.teams[team];
      for (let i = 0; i < (options.difficulty === "hard" ? 2 : 1); i++) {
        const points = (node) =>
          helpers.researchPoints ? helpers.researchPoints(ctx, node) : node.points;
        const nodes = ctx.development.nodes(pool.faction);
        const compare = (a, b) => (a.page || 0) - (b.page || 0) || a.column - b.column;
        const main = nodes
          .filter(
            (node) =>
              node.row === "mid" &&
              !pool.researched.includes(node.id) &&
              !(pool.researchQueue || []).some((order) => order.techId === node.id),
          )
          .sort(compare)[0];
        const node = nodes
          .filter(
            (n) =>
              !pool.researched.includes(n.id) &&
              !(pool.researchQueue || []).some((order) => order.techId === n.id) &&
              n.requires.every((id) => pool.researched.includes(id)),
          )
          .sort((a, b) => Number(a.row !== "mid") - Number(b.row !== "mid") || compare(a, b))
          .find(
            (n) =>
              points(n) <= pool.technology &&
              (n.money || 0) <= pool.money &&
              (n.supplies || 0) <= pool.supplies &&
              (!main || n.row === "mid" || pool.technology - points(n) >= points(main)),
          );
        if (!node) break;
        helpers.startResearch(ctx, state, team, node);
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
        // A carrier and its passengers are one movement group, but every passenger
        // contributes to strength. Keep a frontier reserve instead of evacuating it.
        const bundle = (root) => {
          const result = [root], seen = new Set([root.id]);
          for (let i = 0; i < result.length; i++)
            for (const unit of passengers.get(result[i].state?.id) || [])
              if (unit.region === regionId && unit.team === team && !seen.has(unit.id)) {
                result.push(unit);
                seen.add(unit.id);
              }
          return result;
        };
        const bundles = new Map(group.map((u) => [u, bundle(u)]));
        const detachment = group.slice();
        if (enemyNeighbors.length) {
          const reserveTarget = force(group.flatMap((u) => bundles.get(u))) * 0.25;
          let reserve = 0, roots = 0;
          const weakest = group.slice().sort((a, b) => force(bundles.get(a)) - force(bundles.get(b)));
          for (const unit of weakest) {
            if (roots >= 2 && reserve >= reserveTarget) break;
            reserve += force(bundles.get(unit));
            roots++;
            detachment.splice(detachment.indexOf(unit), 1);
          }
        }
        const departing = detachment.flatMap((u) => bundles.get(u));
        let next = null;
        if (detachment.length >= minGroup && attackTurn) {
          const target = targets.find((t) => force(departing) >= force(t.units) *
            (options.difficulty === "easy" ? 1.5 : options.difficulty === "hard" ? 1.1 : 1.25));
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
        for (const unit of group) unit.moveTo = next && detachment.includes(unit) ? next : null;
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
      // Low nonzero adaptability permits emergency deployment, not sensible AI production.
      // Use the same >=100 threshold as the UI's normal environment tags.
      const environment = world.environment || "ground";
      const quotes = available.map((p) => helpers.quote(ctx, p.id)).filter((quote) =>
        quote && (model(quote)?.adaptability?.[environment] || 0) >= 100);
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
  return { settings, power, decide, forUnit, captureGoal, captureCapable, positionScore, positionScorer, strategic };
})();
if (typeof module !== "undefined") module.exports = AITactics;
