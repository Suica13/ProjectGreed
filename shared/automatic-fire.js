/* Single-target alternating volleys and melee; combat is ruled by the server clock. */
const AutomaticFire = (() => {
  const Classes =
    typeof WeaponClasses !== "undefined" ? WeaponClasses : require("./weapon-classes.js");
  const roundCount = (G, game, unit, weapon, counter = false) => {
    // A melee defender replies once per approaching enemy, before evacuation
    // penalties. Configurable offensive rounds must not multiply that reply.
    const count =
      counter && weapon.type === "melee"
        ? Math.min(1, Classes.rounds(weapon))
        : Classes.rounds(weapon);
    if (count <= 0) return 0;
    const model = unit ? G.modelOf(unit) : null;
    const mobility = Math.max(0, model?.speed ?? 100) / 100;
    const pilot = model?.pilotModifiers?.attackRounds ?? 1;
    const limit = weapon.type === "melee" || weapon.slot === "skill" ||
      Classes.wristWeapon(weapon) || Classes.headVulcan(weapon) || weapon.pilotRequirements?.length
      ? 1 : weapon.maxUsesPerTurn ?? Infinity;
    const scaled = Math.min(limit, Math.max(1, Math.round(count * mobility * pilot)));
    return Math.floor(scaled * (unit?.forcedExitRound === game.round ? 0.5 : 1));
  };
  function weapons(G, game, unit, target, counter = false) {
    if (!unit || !target) return [];
    const usable = G.modelOf(unit).weapons.filter((w) => {
      if ((w.slot === "skill" && Classes.classify(w) !== "ram") || w.special?.type === "snipe") return false;
      if (!roundCount(G, game, unit, w, counter)) return false;
      const aimCell = G.attackAimCell(game, unit, target, [w]);
      if (!aimCell) return false;
      const aimed = {
        ...w,
        aimCell,
        ...(counter && w.type === "melee" ? { turnUseContinuation: true } : {}),
      };
      return counter
        ? G.canCounter(game, unit, target, aimed)
        : G.canAttack(game, unit, target, aimed);
    });
    const eligible = usable.some((w) => w.type === "melee" && Classes.classify(w) !== "ram")
      ? usable.filter((w) => Classes.classify(w) !== "ram")
      : usable;
    const firstMelee = eligible.find((w) => w.type === "melee");
    return counter ? eligible.filter((w) => w.type !== "melee" || w === firstMelee) : eligible;
  }

  function plan(G, game, unit, target, options = {}) {
    const { counter = false, combatMode = "melee", ids = null } = options;
    const en = Math.max(0, unit?.en || 0);
    const targets = target ? G.squadMembers(game, target) : [];
    const planned = targets.flatMap((enemy) =>
      G.attackOrders(enemy).map((order) => ({ enemy, order })),
    );
    const rangedOnly =
      counter &&
      planned.length &&
      !planned.some(({ enemy, order }) =>
        (order.weapons || [order.weapon]).some((id) =>
          G.modelOf(enemy).weapons.some((w) => w.id === id && w.type === "melee"),
        ),
      );
    if (!unit || !target) return { weapons: [], en: 0 };
    if (ids !== null) throw Error("当前模式不支持手动选择武器");
    const pool = new Map();
    for (const enemy of targets)
      for (const weapon of weapons(G, game, unit, enemy, counter)) {
        if ((combatMode === "shooting" || rangedOnly) && weapon.type === "melee") continue;
        pool.set(weapon.id, weapon);
      }
    // Preserve slot order within ranged/melee phases. Predict sequential EN use
    // without rolling damage or spending anything; resolution checks again.
    let remaining = en;
    const selected = [];
    const ordered = [...pool.values()].sort(
      (a, b) => Number(a.type === "melee") - Number(b.type === "melee"),
    );
    for (const weapon of ordered) {
      const energy = Math.max(0, G.weaponStats(weapon, unit).en || 0);
      if (energy > remaining) continue;
      let count = roundCount(G, game, unit, weapon, counter);
      if (energy > 0) count = Math.min(count, Math.floor((remaining + 1e-8) / energy));
      if (Number.isInteger(weapon.maxUses))
        count = Math.min(count, Math.max(0, weapon.maxUses - (unit.weaponUses?.[weapon.id] || 0)));
      if (Number.isInteger(weapon.maxUsesPerTurn))
        count = Math.min(
          count,
          Math.max(
            0,
            weapon.maxUsesPerTurn -
              (counter && weapon.type === "melee" ? 0 : unit.weaponTurnUses?.[weapon.id] || 0),
          ),
        );
      selected.push(...Array(count).fill(weapon));
      remaining -= energy * count;
    }
    return { weapons: selected, en: en - remaining };
  }

  function queue(G, game, unit, target, counter = false) {
    return plan(G, game, unit, target, { counter }).weapons;
  }
  const squadQueue = queue;
  // Distances use fixed world cells. Zoom, render scale and playback rate cannot change combat.
  function flight(G, from, to, weapon) {
    const a = G.center(from),
      b = G.center(to),
      distance = Math.hypot(a.x - b.x, a.y - b.y) * 64;
    const motion = weapon.projectile?.motion;
    if (!weapon.projectile) return 0;
    if (weapon.projectile.container) return 0.5;
    if (motion === "bomb") return 0.6;
    if (motion === "mortar") return 2 * Math.max(0.18, Math.min(0.45, distance / 1800));
    if (motion === "tether")
      return Math.max(0.18, Math.min(0.5, distance / (Math.max(0.01, weapon.projectile.speed) * 10)));
    return Math.max(0.025, distance / (Math.max(0.01, weapon.projectile.speed) * 60));
  }
  // Binary heap keeps large exchanges O(N log N), including newly scheduled impacts.
  function timeline() {
    const heap = [];
    const compare = (a, b) =>
      a.at - b.at ||
      Number(a.kind === "impact") - Number(b.kind === "impact") ||
      (a.sequence || 0) - (b.sequence || 0);
    return {
      get length() {
        return heap.length;
      },
      push(job) {
        let index = heap.length;
        heap.push(job);
        while (index > 0) {
          const parent = (index - 1) >> 1;
          if (compare(heap[parent], job) <= 0) break;
          heap[index] = heap[parent];
          index = parent;
        }
        heap[index] = job;
      },
      shift() {
        const first = heap[0],
          last = heap.pop();
        if (heap.length) {
          let index = 0;
          while (index * 2 + 1 < heap.length) {
            let child = index * 2 + 1;
            if (child + 1 < heap.length && compare(heap[child + 1], heap[child]) < 0) child++;
            if (compare(last, heap[child]) <= 0) break;
            heap[index] = heap[child];
            index = child;
          }
          heap[index] = last;
        }
        return first;
      },
    };
  }
  function resolve(G, room, choices, randomId) {
    const game = room.game,
      find = (id) => game.units.find((u) => u.id === id);
    const initial = new Map(game.units.map((u) => [u.id, structuredClone(u)]));
    const runs = [],
      jobs = timeline(),
      battles = [],
      stances = new Map(),
      reactionUsed = new Set(),
      meleeAvailability = new Map();
    const add = (from, to, ids, stance, counter, intent = {}) => {
      if (!from || !to) return;
      const resolved = [...new Set(ids)]
        .map((id) => G.modelOf(from).weapons.find((w) => w.id === id))
        .filter(
          (weapon) =>
            weapon &&
            roundCount(G, game, from, weapon, counter) > 0 &&
            (intent.combatMode !== "shooting" || weapon.type !== "melee"),
        );
      // Reserve a conditional ram fallback. It is checked after ranged EN/part changes,
      // and never appended as an extra attack after a successful melee sequence.
      if (intent.automatic && !intent.manual && intent.combatMode !== "shooting")
        for (const ram of G.modelOf(from).weapons.filter((w) => Classes.classify(w) === "ram")) {
          if (
            !resolved.some((w) => w.id === ram.id) &&
            (counter ? G.canCounter(game, from, to, ram) : G.canAttack(game, from, to, ram))
          )
            resolved.push(ram);
        }
      for (const weapon of resolved) {
        const count = Math.max(1, ids.filter((id) => id === weapon.id).length);
        const speed = weapon.remote
          ? 1
          : weapon.type === "melee"
            ? G.catalog.presentation?.meleeAnimationSpeed || 1
            : G.catalog.presentation?.animationSpeed || 1;
        const lead = weapon.projectile?.motion === "bomb" ? 0.6 : 0;
        const duration =
          Math.max(
            0.25,
            weapon.attack.duration / speed,
            lead + Math.max(...weapon.attack.shots) / speed + flight(G, from, to, weapon),
          ) + (weapon.type === "melee" ? 0.12 : 0.04);
        const run = {
          from: from.id,
          to: to.id,
          weapon,
          stance,
          counter,
          intent,
          model: from.model,
          lead,
          speed,
          duration,
          count,
          rounds: new Map(),
          targets: intent.targetSquad || G.squadMembers(game, to).map((unit) => unit.id),
          volleyTargets: new Map(),
          containerCell: weapon.projectile?.container ? (() => {
            const aim = intent.impactCell || intent.aimCell || G.attackAimCell(game, from, to, [weapon]) || to;
            const origin = G.center(from), dx = Math.sign(aim.x - origin.x), dy = Math.sign(aim.y - origin.y);
            const candidates = [[dx,dy],[-dy,dx],[dy,-dx]].map(([x,y]) => ({ x:aim.x+x, y:aim.y+y }));
            return candidates.find(p => p.x >= 0 && p.y >= 0 && p.x < G.mapWidth(game) && p.y < G.mapHeight(game) &&
              (p.x !== aim.x || p.y !== aim.y)) || {x:aim.x,y:aim.y};
          })() : null,
        };
        runs.push(run);
      }
    };
    for (const choice of choices) {
      const intents = choice.intent.attacks || [choice.intent];
      stances.set(choice.intent.target, choice.response);
      for (const intent of choice.intent.supportOnly ? [] : intents) {
        const from = find(intent.attacker),
          to =
            find(intent.target) ||
            (intent.impactCell &&
              from && {
                ...structuredClone(from),
                id: "impact-" + randomId(),
                ...intent.impactCell,
                team: 1 - from.team,
                hp: 1,
                shield: 0,
                visualOnly: true,
              });
        if (to?.visualOnly) initial.set(to.id, structuredClone(to));
        add(from, to, intent.weapons || [intent.weapon], choice.response, false, intent);
      }
      if (choice.response === "counter") {
        const from = find(choice.intent.target),
          to = find(choice.counterTargetId || choice.intent.attacker);
        add(
          from,
          to,
          choice.counterIds || G.automaticSquadQueue(game, from, to, true).map((w) => w.id),
          "counter",
          true,
          {
            automatic: true,
            manual: choice.manualCounter,
            combatMode: "melee",
          },
        );
      }
    }
    // Finish every ranged volley first, alternating attack and counter sides.
    const stageSlots = [],
      meleePairs = new Map();
    const queues = [new Map(), new Map()];
    let cursor = 0,
      wave = 0;
    function schedule(run, pair = null, round = 0, last = false) {
      const stageStart = cursor;
      const start = stageStart + (pair && stageStart === pair.start ? pair.approach : 0);
      const finish = start + run.duration;
      for (const shotIndex of run.intent.shotIndices || run.weapon.attack.shots.map((_, i) => i))
        jobs.push({
          kind: "launch",
          at: start + run.lead + run.weapon.attack.shots[shotIndex] / run.speed,
          start,
          stageStart,
          run,
          round,
          shotIndex,
          wave,
          stageEnd: finish,
          meleeExchange: pair,
        });
      cursor = finish + (last ? pair.retreat : 0) + 0.04;
      const slot = stageSlots.at(-1);
      if (slot?.start === stageStart) slot.end = Math.max(slot.end, cursor);
      else stageSlots.push({ start: stageStart, end: cursor });
    }
    for (const run of runs.filter((run) => run.weapon.type !== "melee")) {
      const side = queues[run.counter ? 1 : 0];
      const queue = side.get(run.from) || [];
      for (let round = 0; round < run.count; round++) queue.push({ run, round });
      side.set(run.from, queue);
    }
    while (queues.some((side) => [...side.values()].some((queue) => queue.length))) {
      for (const side of queues) {
        const stageStart = cursor;
        let end = cursor;
        for (const queue of side.values()) {
          if (!queue.length) continue;
          cursor = stageStart;
          const item = queue.shift();
          schedule(item.run, null, item.round);
          end = Math.max(end, cursor);
        }
        cursor = end;
      }
      wave++;
    }
    // One approach per attacking unit. Remain engaged through the defender's
    // reply and all remaining melee weapons, then return to the map position.
    const attackers = new Map();
    for (const run of runs.filter((run) => !run.counter && run.weapon.type === "melee")) {
      const queue = attackers.get(run.from) || [];
      if (!queue.some((other) => other.weapon.id === run.weapon.id)) queue.push(run);
      attackers.set(run.from, queue);
    }
    const meleeGroups = [...attackers];
    function scheduleMeleeGroup() {
      const group = meleeGroups.shift();
      if (!group) return;
      const [id, all] = group;
      const from = find(id);
      if (!from || !G.onMap(from)) {
        jobs.push({ kind: "melee-group", at: cursor });
        return;
      }
      const normal = all.filter(
        (run) =>
          Classes.classify(run.weapon) !== "ram" &&
          run.targets.some((id) => {
            const t = find(id);
            return t && G.canAttack(game, from, t, run.weapon);
          }),
      );
      const queue = normal.length
        ? normal
        : all.filter((run) => Classes.classify(run.weapon) === "ram").slice(0, 1);
      if (!queue.length) {
        jobs.push({ kind: "melee-group", at: cursor });
        return;
      }
      const targets = queue[0].targets
        .map(find)
        .filter(
          (target) =>
            target &&
            G.onMap(target) &&
            queue.some((run) => G.canAttack(game, from, target, run.weapon)),
        );
      const target =
        targets.find((t) => (t.squadSlot || 0) === (from.squadSlot || 0)) || targets[0];
      if (!target) {
        jobs.push({ kind: "melee-group", at: cursor });
        return;
      }
      const pair = {
        id: "melee-" + wave++ + "-" + id,
        attacker: id,
        defender: target.id,
        start: cursor,
        approach: 0.35,
        retreat: 0.35,
      };
      meleePairs.set(pair.id, pair);
      const defenderWeapon = weapons(G, game, target, from, true).find((w) => w.type === "melee");
      const responds =
        stances.get(target.id) === "counter" &&
        defenderWeapon &&
        !defenderWeapon.noCounter &&
        +(G.modelOf(target).counterLimit ?? 1) > 0 &&
        !choices.some((c) => c.intent.target === target.id && c.intent.noCounter);
      // This dedicated reply is independent of the defender's ranged target.
      const before = runs.length;
      if (responds)
        add(target, from, [defenderWeapon.id], "counter", true, {
          automatic: true,
          manual: true,
          reactiveMelee: true,
          requiresMeleeFrom: id,
          targetSquad: [id],
        });
      const reply = responds ? runs[before] : null;
      const meleeSteps = queue.flatMap((run) =>
        Array.from({ length: run.count }, (_, round) => ({ run, round })),
      );
      meleeSteps.forEach(({ run, round }, index) => {
        run.to = target.id;
        run.targets = [target.id];
        schedule(run, pair, round, index === meleeSteps.length - 1 && !(index === 0 && reply));
        if (index === 0 && reply) schedule(reply, pair, 0, meleeSteps.length === 1);
      });
      jobs.push({ kind: "melee-group", at: cursor });
    }
    jobs.push({ kind: "melee-group", at: cursor });
    const meleeStageTargets = new Map(),
      meleeLaunched = new Set();
    let sequence = 0;
    const pushBattle = (job, from, to, event) => {
      const actors = [from, to].map((u) => structuredClone(initial.get(u.id) || u));
      const battle = {
        id: randomId(),
        matchId: room.matchId,
        a: from.id,
        b: to.id,
        actors,
        before: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
        events: [event],
        crossfire: true,
        _run: job.run,
        _round: job.round,
        timelineStart: job.start,
        combatStage: job.run.counter ? "counter" : "attack",
        alternating: true,
        combatWave: job.wave,
        meleeExchange: job.meleeExchange,
        _stageStart: job.stageStart ?? job.start,
        _stageEnd: job.stageEnd,
      };
      battles.push(battle);
    };
    // All launches at an equal timestamp precede impacts at that timestamp.
    while (jobs.length) {
      const job = jobs.shift();
      if (job.kind === "melee-group") {
        scheduleMeleeGroup();
        continue;
      }
      const run = job.run,
        from = find(run.from);
      let to = job.destination || find(run.to) || initial.get(run.to);
      if (job.kind === "launch") {
        if (run.intent.cellBlast && from && (!to || to.hp <= 0)) {
          to = { ...structuredClone(to || from), ...run.intent.impactCell,
            id: "impact-" + randomId(), hp: 1, shield: 0, visualOnly: true,
            team: 1 - from.team };
          initial.set(to.id, structuredClone(to));
        }
        if (
          from &&
          from.hp > 0 &&
          run.weapon.type !== "melee" &&
          !run.intent.impactCell &&
          run.targets.length > 1
        ) {
          let chosen = run.weapon.projectile?.container ? null : find(run.volleyTargets.get(job.round));
          if (!chosen || !G.onMap(chosen)) {
            const candidateWeapon = run.rounds.has(job.round)
              ? { ...run.weapon, en: 0, maxUses: undefined, turnUseContinuation: true }
              : run.weapon;
            const candidates = run.targets
              .map(find)
              .filter(
                (unit) => unit && G.onMap(unit) && G.canAttack(game, from, unit, candidateWeapon),
              );
            if (candidates.length) {
              chosen = G.squadTarget(game, candidates);
              run.volleyTargets.set(job.round, chosen.id);
            }
          }
          to = chosen || null;
        }
        if (
          !from ||
          from.hp <= 0 ||
          from.model !== run.model ||
          (run.weapon.type !== "melee" && (!to || to.hp <= 0))
        )
          continue;
        if (run.weapon.type === "melee" && run.rounds.has(job.round) && (!to || to.hp <= 0))
          continue;
        if (
          run.intent.reactiveMelee &&
          !meleeLaunched.has(run.intent.requiresMeleeFrom + ":" + from.id)
        )
          continue;
        if (run.weapon.type === "melee" && !run.intent.reactiveMelee) {
          const occupied = meleeStageTargets.get(job.stageStart) || new Map();
          if (!run.rounds.has(job.round)) {
            const available = run.targets
              .map(find)
              .filter(
                (target) =>
                  target &&
                  G.onMap(target) &&
                  (!occupied.has(target.id) || occupied.get(target.id) === from.id) &&
                  G.canAttack(game, from, target, run.weapon),
              );
            to =
              available.find((target) => target.id === run.to) ||
              available.find((target) => (target.squadSlot || 0) === (from.squadSlot || 0)) ||
              available[0];
            if (!to) continue;
            run.to = to.id;
            if (job.meleeExchange && !run.counter) job.meleeExchange.defender = to.id;
          }
          const key = run.from + ":" + to.id;
          if (!meleeAvailability.has(key))
            meleeAvailability.set(
              key,
              G.automaticWeapons(game, from, to).some(
                (w) =>
                  w.type === "melee" &&
                  Classes.classify(w) !== "ram",
              ),
            );
          if (Classes.classify(run.weapon) === "ram" && meleeAvailability.get(key)) continue;
        }
        const started = run.rounds.has(job.round);
        if (!started && job.round >= roundCount(G, game, from, run.weapon, run.counter)) continue;
        const raw = G.modelOf(from).weapons.find((w) => w.id === run.weapon.id);
        if (!raw) continue;
        let candidate =
          started || run.intent.freeFollowup || run.intent.turnUseContinuation
            ? { ...raw, en: 0, energySpent: 0, maxUses: undefined, turnUseContinuation: true }
            : raw;
        if (run.intent.reactiveMelee && !started) candidate = { ...raw, turnUseContinuation: true };
        if (run.intent.impactCell && ["blast", "nuke"].includes(raw.special?.type))
          candidate = { ...candidate, blastCenter: run.intent.impactCell };
        const aimCell = run.intent.aimCell || G.attackAimCell(game, from, to, [candidate]);
        if (aimCell) candidate = { ...candidate, aimCell };
        if (!G.availableStrikes(from, candidate, to).some((s) => s.shotIndex === job.shotIndex))
          continue;
        const paid = started ? 0 : G.weaponStats(candidate, from).en;
        if (!G.canAttack(game, from, to, candidate)) continue;

        if (!started) {
          G.spendWeapon(from, G.weaponStats(candidate, from));
          if (run.weapon.type === "melee" && !run.counter) meleeLaunched.add(from.id + ":" + to.id);
          if (run.weapon.type === "melee") {
            const occupied = meleeStageTargets.get(job.stageStart) || new Map();
            occupied.set(to.id, from.id);
            meleeStageTargets.set(job.stageStart, occupied);
          }
          run.rounds.set(job.round, true);
          if (run.counter && !reactionUsed.has(from.id)) {
            from.counterCount = (from.counterCount || 0) + 1;
            from.counterTargetId = to.id;
            reactionUsed.add(from.id);
          }
        }
        let impactCell = run.intent.impactCell;
        if (run.intent.automatic && raw.special?.type === "mortar") {
          run.scatter ||= new Map();
          let bag = run.scatter.get(job.round);
          if (!bag?.length) {
            const center = G.center(to);
            bag = [];
            for (let y = -1; y <= 1; y++)
              for (let x = -1; x <= 1; x++)
                bag.push({ x: Math.floor(center.x) + x, y: Math.floor(center.y) + y });
            run.scatter.set(job.round, bag);
          }
          impactCell = bag.splice(Math.floor(G.random(game) * bag.length), 1)[0];
          const occupant = G.at(game, impactCell.x, impactCell.y);
          if (occupant && occupant.team !== from.team && G.onMap(occupant)) {
            const members = G.squadMembers(game, occupant);
            to =
              members.length > 1 ? G.squadTarget(game, members) : occupant;
          } else {
            to = {
              ...structuredClone(to),
              ...impactCell,
              id: "impact-" + randomId(),
              hp: 1,
              shield: 0,
              visualOnly: true,
            };
            initial.set(to.id, structuredClone(to));
          }
        } else if (run.intent.automatic && ["nuke", "blast"].includes(raw.special?.type))
          impactCell = G.center(to);
        const weapon = G.eventWeapon(from, {
          weapon: raw.id,
          aimCell,
          shotIndices: [job.shotIndex],
          impactCell,
          energySpent: 0,
          turnUseContinuation: true,
        });
        G.faceTarget(from, to);
        G.faceTarget(to, from);
        const snapshot = structuredClone(from),
          flying = flight(G, from, to, weapon);
        jobs.push({
          ...job,
          kind: "impact",
          at: job.at + flying,
          fireAt: job.at,
          source: snapshot,
          weapon,
          destination: to,
          impactCell,
          blastId: run.weapon.special?.perProjectileBlast && run.intent.blastId
            ? `${run.intent.blastId}:${job.round}:${job.shotIndex}` : run.intent.blastId || randomId(),
          energySpent: paid,
          sequence: ++sequence,
        });
      } else {
        if (!to) continue;
        const victims =
          (run.intent.automatic || run.intent.cellBlast) && ["nuke", "blast"].includes(run.weapon.special?.type)
            ? game.units.filter(
                (unit) =>
                  unit.team !== job.source.team &&
                  G.onMap(unit) &&
                  G.blastContains(
                    job.impactCell,
                    unit,
                    run.weapon.special.radius,
                    run.weapon.special.shape,
                  ) &&
                  G.targetModifier(game, unit, job.weapon) > 0,
              )
            : [to];
        if (!victims.length) victims.push({ ...to, hp: 0, visualOnly: true });
        for (const [victimIndex, victim] of victims.entries()) {
          let events;
          if (victim.hp > 0 && !victim.visualOnly)
            events = G.resolveProjectile(
              game,
              job.source,
              victim,
              job.weapon,
              run.counter ? "counter" : stances.get(victim.id) || run.stance,
              run.counter,
            );
          else
            events = [
              {
                from: run.from,
                to: victim.id,
                weapon: run.weapon.id,
                model: job.source.model,
                type: job.weapon.type,
                before: victim.hp,
                after: victim.hp,
                shieldBefore: victim.shield,
                shieldAfter: victim.shield,
                damage: 0,
                shieldDamage: 0,
                hit: false,
                hitCount: 0,
                shotCount: 1,
                strikeCount: job.weapon.attack.strikes.length,
                response: run.stance,
                empty: true,
                strikes: job.weapon.attack.strikes.map((s) => ({
                  ...s,
                  executed: true,
                  hit: false,
                  damage: 0,
                  shieldDamage: 0,
                  before: victim.hp,
                  after: victim.hp,
                })),
              },
            ];
          for (const event of events) {
            Object.assign(event, {
              crossfire: true,
              alternating: true,
              meleeExchange: job.meleeExchange,
              fireAt: job.fireAt,
              impactAt: job.at,
              timelineStart: job.start,
              shotIndices: [job.shotIndex],
              energySpent: victimIndex === 0 ? job.energySpent : 0,
              sequence: ++sequence,
              ...(run.containerCell ? {
                containerCell: run.containerCell,
                containerSalvoId: `${run.from}:${run.weapon.id}:${job.round}:${job.start}`,
                containerLaunchAt: job.start,
                containerEndAt: job.stageEnd,
              } : {}),
              ...(job.impactCell ? { impactCell: job.impactCell, blastId: job.blastId } : {}),
              ...(victim.visualOnly ? { empty: true } : {}),
            });
            pushBattle(job, job.source, victim, event);
          }
        }
      }
    }
    for (const choice of choices)
      for (const intent of choice.intent.attacks || [choice.intent]) {
        const unit = find(intent.attacker);
        if (unit) {
          delete unit.plan;
          unit.acted = true;
          unit.origin = null;
        }
      }
    for (const run of runs)
      if (run.rounds.size) {
        const unit = find(run.from);
        if (unit) G.startWeaponCooldown(unit, run.weapon);
      }
    for (const unit of game.units) delete unit.squadOrder;
    const alive = [0, 1].map((team) => game.units.some((u) => u.team === team && u.hp > 0));
    if (!game.mission && (!alive[0] || !alive[1])) game.winner = alive[0] ? 0 : alive[1] ? 1 : -1;
    // Keep one playback lane per volley instead of duplicating actors for every bullet.
    const groups = new Map(),
      result = [];
    for (const battle of battles) {
      let rounds = groups.get(battle._run);
      if (!rounds) groups.set(battle._run, (rounds = new Map()));
      const key = battle._round + ":" + battle.b +
        (battle._run.weapon.special?.perProjectileBlast ? ":" + battle.events[0].blastId : "");
      if (!rounds.has(key)) {
        rounds.set(key, []);
        result.push(rounds.get(key));
      }
      rounds.get(key).push(battle);
    }
    for (const pair of meleePairs.values()) {
      const emitted = battles.filter((b) => b.meleeExchange === pair);
      pair.end = Math.max(pair.start, ...emitted.map((b) => b._stageEnd)) + 0.35;
    }
    // The scheduler reserves every potential volley before damage/EN/part checks.
    // Remove unused presentation slots after resolving, without changing combat
    // order, RNG, paid energy, or the duration of any projectile still in flight.
    const cuts = [];
    for (const slot of stageSlots) {
      const emitted = battles.filter((battle) => battle._stageStart === slot.start);
      let keepUntil = emitted.length
        ? Math.max(
            ...emitted.map((battle) => battle._stageEnd + (battle.meleeExchange?.retreat || 0)),
          ) + 0.04
        : slot.start;
      for (const battle of battles)
        if (battle.timelineStart <= slot.start)
          keepUntil = Math.max(keepUntil, battle.events[0].impactAt + 0.04);
      if (keepUntil < slot.end - 0.000001) cuts.push({ start: keepUntil, end: slot.end });
    }
    cuts.sort((a, b) => a.start - b.start);
    const compactTime = (time) =>
      time -
      cuts.reduce((total, cut) => total + Math.max(0, Math.min(time, cut.end) - cut.start), 0);
    for (const battle of battles) {
      battle.timelineStart = compactTime(battle.timelineStart);
      battle._stageEnd = compactTime(battle._stageEnd);
      for (const event of battle.events) {
        event.timelineStart = compactTime(event.timelineStart);
        event.fireAt = compactTime(event.fireAt);
        event.impactAt = compactTime(event.impactAt);
        if (event.containerLaunchAt !== undefined) event.containerLaunchAt = compactTime(event.containerLaunchAt);
        if (event.containerEndAt !== undefined) event.containerEndAt = compactTime(event.containerEndAt);
      }
    }
    for (const pair of meleePairs.values()) {
      pair.start = compactTime(pair.start);
      pair.end = compactTime(pair.end);
    }
    const merged = result.map((group) => {
      group.sort((a, b) => a.events[0].fireAt - b.events[0].fireAt);
      const first = group[0],
        events = group.map((b) => b.events[0]),
        last = events.at(-1);
      const event = {
        ...events[0],
        after: last.after,
        shieldAfter: last.shieldAfter,
        partsAfter: last.partsAfter,
        targetModelAfter: last.targetModelAfter,
        destroyed: events.some((e) => !e.empty && e.before > 0 && e.after <= 0),
        hit: events.some((e) => e.hit),
        blocked: events.some((e) => e.blocked),
        shotIndices: events.flatMap((e) => e.shotIndices),
        shotTimings: events.map((e) => ({ fireAt: e.fireAt, impactAt: e.impactAt })),
        strikes: events.flatMap((e, index) =>
          e.strikes.map((strike) => ({ ...strike, shotIndex: index })),
        ),
        brokenParts: [...new Set(events.flatMap((e) => e.brokenParts || []))],
        evacuations: events.flatMap((e) => e.evacuations || []),
        overdriveEnded: events.some((e) => e.overdriveEnded),
      };
      for (const field of [
        "damage",
        "shieldDamage",
        "hitCount",
        "strikeCount",
        "shotCount",
        "energySpent",
      ])
        event[field] = events.reduce((sum, e) => sum + (e[field] || 0), 0);
      const { _run, _round, _stageStart, _stageEnd, ...clean } = first;
      return { ...clean, events: [event] };
    });
    room.pending = null;
    room.responses = [];
    room.combatBatch = merged;
    room.combats = [...(room.combats || []), ...merged];
    return merged;
  }
  return { plan, roundCount, weapons, queue, squadQueue, flight, resolve };
})();
if (typeof module !== "undefined") module.exports = AutomaticFire;
