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
      return total + (Math.max(25, m.cost) + 100) * (0.25 + health * 0.75);
    }, 0);
  }
  function decide(G, game, unit) {
    let phase = phases.get(game);
    const key = game.round + ":" + game.team;
    if (!phase || phase.key !== key) phases.set(game, phase = {
      key, players: new Map(), navigation: new Map(), missions: new Set(),
    });
    const seat = G.controllerOf(game, unit);
    if (phase.players.has(seat)) return phase.players.get(seat);
    const config = settings(game.aiOptions),
      allies = game.units.filter((u) => G.onMap(u) && u.team === unit.team && !u.embarked),
      squad = allies.filter((u) => G.controllerOf(game, u) === seat && G.modelOf(u).move > 0 && !u.deployed),
      enemies = game.units.filter((u) => G.onMap(u) && u.team !== unit.team && !u.embarked),
      origin = center(squad.length ? squad : [unit]),
      enemyCenter = enemies.length ? center(enemies) : origin,
      ratio = power(allies, G.modelOf) / Math.max(1, power(enemies, G.modelOf));
    let state = "advance", goal = enemyCenter;
    if (squad.length > 1 && ratio < 1.75) {
      // Encounter battles regroup on the move; they never wait for strategic reinforcements.
      state = config.difficulty !== "easy" && squad.length >= 4 ? "flank" : "advance";
    } else if (ratio >= 1.75) state = "overrun";
    if (config.difficulty === "easy") state = "advance";
    const decision = { state, goal, origin, ratio, difficulty: config.difficulty,
      squad: squad.map((u) => u.id), friends: squad, enemies,
      strategic: !!game.battlefield, navigation: phase.navigation, missions: phase.missions };
    phase.players.set(seat, decision);
    return decision;
  }
  function captureCapable(G, unit) {
    return !unit.facility && G.modelOf(unit).movementType !== "air" &&
      (!unit.flying || G.unitSkills(unit).some((skill) => skill.type === "flight"));
  }
  function captureGoal(G, game, unit, origin = unit, nearby = true) {
    if (!game.battlefield || !captureCapable(G, unit)) return null;
    const points = game.battlefield.points, radius = 2;
    const targets = points.filter((point) => point.owner !== unit.team &&
      (!nearby || distance(origin, point) <= Math.max(6, G.modelOf(unit).move + 2)) &&
      !game.units.some((enemy) => enemy.team !== unit.team && G.onMap(enemy) &&
        G.cells(enemy).some((cell) => Math.max(Math.abs(cell.x-point.x), Math.abs(cell.y-point.y)) <= radius)));
    return targets.sort((a,b) => distance(origin,a)-distance(origin,b))[0] || null;
  }
  function forUnit(G, game, unit, decision) {
    const mission = game.mission && G.getMap(game.mapId).mission;
    if (mission?.victory.type === "defend_group") {
      const targets=game.units.filter(target=>target.missionGroup===mission.victory.group && target.hp>0);
      let origin=unit, sharedGoals;
      if (unit.missionAttackGroup) {
        // A scripted attack formation shares a target, without waiting for late units.
        sharedGoals=decision.missionAttackGoals ||= new Map();
        const key=unit.team+":"+unit.missionAttackGroup;
        const previous=sharedGoals.get(key);
        if (previous?.hp>0 && targets.includes(previous))
          return {...decision,state:"advance",goal:previous,strategic:true,occupation:false};
        const members=game.units.filter(member=>member.hp>0 && !member.embarked &&
          member.team===unit.team && member.missionAttackGroup===unit.missionAttackGroup);
        origin=members.length ? center(members) : unit;
      }
      const goal=targets.reduce((best,target)=>!best || distance(origin,target)<distance(origin,best)?target:best,null);
      if (goal && sharedGoals) sharedGoals.set(unit.team+":"+unit.missionAttackGroup,goal);
      if(goal)return {...decision,state:"advance",goal,strategic:true,occupation:false};
    }
    if (!game.battlefield) return decision;
    const points = game.battlefield.points;
    const hostile = (point) => point.owner !== unit.team;
    if (game.battlefield) {
      const enemies = decision.enemies.filter(enemy => G.onMap(enemy));
      const nearest = targets => targets.reduce((best, target) =>
        !best || distance(unit, target) < distance(unit, best) ? target : best, null);
      const post = nearest(points.filter(hostile));
      const base = nearest(enemies.filter(enemy => enemy.facility?.type === "base"));
      // Keep existing squads intact, dividing mobile formations roughly in half.
      // Reserve occupation work for formations that can actually capture posts.
      if (!decision.captureGroups) {
        const groups = new Map();
        for (const ally of decision.friends) {
          const id = ally.squadId || ally.id;
          if (!groups.has(id) || captureCapable(G, ally)) groups.set(id, ally);
        }
        const captureGroups = [...groups.entries()].filter(([, ally]) => captureCapable(G, ally));
        captureGroups.sort((a, b) => {
          const nearestPost = ally => Math.min(...points.filter(hostile).map(point => distance(ally, point)));
          return nearestPost(a[1]) - nearestPost(b[1]) || String(a[0]).localeCompare(String(b[0]));
        });
        decision.captureGroups = new Set(captureGroups.slice(0, Math.ceil(groups.size / 2)).map(([id]) => id));
      }
      if (base && !decision.captureGroups.has(unit.squadId || unit.id))
        return { ...decision, state: "advance", goal: base, occupation: false };
      // Objectives are chosen from this formation's position, not the army's
      // old centroid. Supporting formations must not bypass nearer posts.
      if (base && (!post || distance(unit, base) < distance(unit, post)))
        return { ...decision, state: "advance", goal: base, occupation: false };
      if (post && captureCapable(G, unit) && decision.captureGroups.has(unit.squadId || unit.id))
        return { ...decision, state: "advance", goal: post, occupation: true };
      const defenders = post && enemies.filter(enemy => distance(enemy, post) <= 6);
      const goal = nearest(defenders || []) || base || nearest(enemies) || unit;
      return { ...decision, state: "advance", goal, occupation: false, avoidObjective: true };
    }
  }
  function positionScorer(G, game, unit, decision) {
    const { state, origin, difficulty } = decision;
    let goal = decision.goal;
    const index = decision.squad.indexOf(unit.id),
      separation = distance(origin, goal),
      flank = !decision.strategic && !game.mission && difficulty !== "easy" && decision.squad.length >= 4 &&
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
      if (!decision.strategic && !game.mission && decision.squad.length > 1 && state !== "overrun") {
        let nearest = friends.length ? Infinity : 0;
        for (const friend of friends) nearest = Math.min(nearest, distance(cell, friend));
        score -= Math.max(0, nearest - 4) * (difficulty === "easy" ? 0.08 : 0.25);
      }
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
  return { settings, power, decide, forUnit, captureGoal, captureCapable, positionScore, positionScorer };
})();
if (typeof module !== "undefined") module.exports = AITactics;
