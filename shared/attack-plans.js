/* 攻击计划只预留行动；所有应战选择完成后统一按顺序扣 EN、判定命中和伤害。
 * 此模块不管理网络、计时或客户端演出，便于独立验证。 */
"use strict";
function createAttackPlanner(rules, randomId) {
  const find = (room, id) => room.game.units.find((unit) => unit.id === id);
  function reset(room) {
    room.plans = [];
    room.combats = [];
    room.pending = null;
    room.reactions = [];
    room.responses = [];
    room.combatBatch = [];
    room.playback = null;
    delete room.openingSnipe;
    room.planSequence = 0;
    room.emptyImpacts = [];
  }
  function plan(room, attacker, target, weapon, seat) {
    if (
      (attacker.acted && !attacker.plan) ||
      (!Array.isArray(weapon) && !rules.canAttack(room.game, attacker, target, weapon))
    )
      throw Error("目标、武器、射程或资源不满足条件");
    const weapons = Array.isArray(weapon) ? weapon : [weapon];
    const aimCell = target.groundTarget ? undefined : target.aimCell ?? weapons[0]?.aimCell ??
      rules.cells(target).find(cell => weapons.every(w => rules.inRange(attacker, target, {...w, aimCell:cell})));
    if (!target.groundTarget && !aimCell) throw Error("没有所有所选武器均可攻击的目标格");
    if (aimCell) target = {...target, aimCell};
    const budget = rules.attackQueue(room.game, attacker, target, weapons);
    const previousCost = attacker.plan?.actionCost ?? 0;
    weapon = weapons[0];
    const intent = {
      aimCell,
      attacker: attacker.id,
      target: target.id,
      targetCell: target.groundTarget ? { x: target.x, y: target.y } : undefined,
      weapon: weapon.id,
      seat,
      weapons: weapons.map((w) => w.id),
      actionCost: budget.ap,
    };
    const index = room.plans.findIndex((plan) => plan.attacker === attacker.id);
    intent.order = index < 0 ? ++room.planSequence : room.plans[index].order;
    if (index < 0) room.plans.push(intent);
    else room.plans[index] = intent;
    attacker.actionPoints = rules.actionPoints(attacker) + previousCost - budget.ap;
    attacker.plan = {
      target: target.id,
      targetCell: intent.targetCell,
      aimCell: intent.aimCell,
      weapon: weapon.id,
      weapons: intent.weapons,
      actionCost: budget.ap,
    };
    attacker.acted = true;
    // 持用武器随计划写入权威状态，避免快照刷新后恢复成初始武器。
    if (weapon.changeHeldWeapon !== false) attacker.heldWeapon = weapon.id;
    if (weapon.special?.type === "snipe") attacker.heldWeapon = weapon.special.baseWeapon;
    rules.faceTarget(attacker, target);
    return intent;
  }
  function cancel(room, attacker) {
    if (!attacker.plan) throw Error("该单位没有攻击计划");
    room.plans = room.plans.filter((plan) => plan.attacker !== attacker.id);
    attacker.actionPoints = rules.actionPoints(attacker) + (attacker.plan.actionCost ?? 0);
    delete attacker.plan;
    attacker.acted = false;
  }
  function next(room) {
    room.pending = null;
    if (room.game.winner !== null) {
      room.plans = [];
      for (const unit of room.game.units) delete unit.plan;
      return null;
    }
    while (room.plans.length) {
      const intent = room.plans.shift(),
        attacker = find(room, intent.attacker),
        target = find(room, intent.target);
      const weapon = attacker && rules.eventWeapon(attacker, intent);
      if (
        !attacker ||
        !target ||
        !weapon ||
        !rules.canAttack(room.game, attacker, target, weapon)
      ) {
        if (attacker) {
          delete attacker.plan;
          attacker.acted = true;
        }
        continue;
      }
      rules.faceTarget(attacker, target);
      rules.faceTarget(target, attacker);
      const attacks = [intent];
      room.plans = room.plans.filter((other) => {
        if (other.target !== intent.target) return true;
        const from = find(room, other.attacker);
        const weapon = from && rules.eventWeapon(from, other);
        if (from && weapon && rules.canAttack(room.game, from, target, weapon)) attacks.push(other);
        else if (from) delete from.plan;
        return false;
      });
      room.pending = { ...intent, attacks, id: randomId() };
      return room.pending;
    }
    return null;
  }
  function expandSpecials(room) {
    const result = [];
    room.emptyImpacts = [];
    const expanded = room.plans.flatMap((intent) =>
      (intent.weapons || [intent.weapon]).map((weapon, index) => ({
        ...intent,
        weapon,
        weapons: undefined,
        order: intent.order + index / 1000,
        queueIndex: index,
        queueLength: (intent.weapons || [intent.weapon]).length,
      })),
    );
    for (const intent of expanded) {
      const attacker = find(room, intent.attacker),
        weapon = attacker && rules.modelOf(attacker).weapons.find((w) => w.id === intent.weapon);
      if (!weapon) continue;
      if (weapon.special?.type === "snipe" && !intent.charged) {
        attacker.snipeOrder = {
          target: intent.target,
          aimCell: intent.aimCell,
          weapon: intent.weapon,
          readyRound: room.game.round + 2,
        };
        delete attacker.plan;
        continue;
      }
      if (weapon.special?.type === "nuke") {
        const target = intent.targetCell
          ? rules.groundTarget(room.game, attacker, intent.targetCell.x, intent.targetCell.y)
          : find(room, intent.target);
        if (!target || !rules.canAttack(room.game, attacker, target, weapon)) {
          delete attacker.plan;
          continue;
        }
        const impact = intent.aimCell ?? rules.center(target);
        const victims = room.game.units
          .filter(
            (unit) =>
              unit.team !== attacker.team &&
              rules.onMap(unit) &&
              rules.blastContains(impact, unit, weapon.special.radius) &&
              rules.canAttack(room.game, attacker, unit, { ...weapon, blastCenter: impact }),
          )
          .sort((a, b) => a.id.localeCompare(b.id, "en"));
        if (!victims.length) {
          room.emptyImpacts.push({
            ...intent,
            target: null,
            energySpent: weapon.en,
            impactCell: impact,
            noCounter: true,
          });
        } else
          victims.forEach((victim, index) =>
            result.push({
              ...intent,
              target: victim.id,
              aimCell: victim.id === intent.target ? intent.aimCell : undefined,
              energySpent: index === 0 ? weapon.en : 0,
              freeFollowup: index > 0,
              impactCell: impact,
              noCounter: true,
              order: intent.order + index / 10000,
            }),
          );
        continue;
      }
      if (weapon.special?.type !== "mortar") {
        result.push(intent);
        continue;
      }
      const target = intent.targetCell
        ? rules.groundTarget(room.game, attacker, intent.targetCell.x, intent.targetCell.y)
        : find(room, intent.target);
      if (!target || !rules.canAttack(room.game, attacker, target, weapon)) {
        delete attacker.plan;
        continue;
      }
      const center = intent.aimCell ?? rules.center(target),
        cells = [];
      for (let y = -1; y <= 1; y++)
        for (let x = -1; x <= 1; x++)
          cells.push({ x: Math.floor(center.x) + x, y: Math.floor(center.y) + y });
      let bag = [];
      const usable = [
        ...new Set(rules.availableStrikes(attacker, weapon, target).map((s) => s.shotIndex)),
      ];
      for (let index = 0; index < usable.length; index++) {
        const shot = usable[index];
        if (!bag.length) bag = cells.map((c) => ({ ...c }));
        const cell = bag.splice(Math.floor(rules.random(room.game) * bag.length), 1)[0];
        const occupant = rules.at(room.game, cell.x, cell.y),
          enemy = occupant && rules.canAttack(room.game, attacker, occupant, weapon);
        const expanded = {
          ...intent,
          target: enemy ? occupant.id : null,
          aimCell: enemy ? cell : undefined,
          shotIndices: [shot],
          energySpent: index === 0 ? weapon.en : 0,
          impactCell: cell,
          noCounter: true,
          order: intent.order + shot / 10000,
        };
        if (enemy) result.push(expanded);
        else room.emptyImpacts.push(expanded);
      }
    }
    room.plans = result;
  }
  function resumeCharges(room) {
    for (const unit of room.game.units) {
      if (!unit.readySnipe) continue;
      const order = unit.readySnipe;
      delete unit.readySnipe;
      room.plans.push({
        attacker: unit.id,
        target: order.target,
        aimCell: order.aimCell,
        weapon: order.weapon,
        seat: rules.ownerOf(unit),
        charged: true,
        order: ++room.planSequence,
      });
    }
  }
  // 一次建立全部目标单位的应战请求，各玩家分别领取自己的第一项。
  function prepare(room) {
    if (room.reactions?.length) return room.reactions;
    room.reactions = [];
    if (room.plans.length) expandSpecials(room);
    while (room.plans.length) {
      const request = next(room);
      if (request) room.reactions.push(request);
    }
    room.pending = room.reactions[0] || null;
    return room.reactions;
  }
  function respond(room, reactionId, response, counterId, allowCounter = true) {
    if (!room.pending || reactionId !== room.pending.id)
      throw Error("应战请求已过期，请处理当前交战");
    const attacker = find(room, room.pending.attacker),
      target = find(room, room.pending.target);
    const weapon = rules.eventWeapon(attacker, room.pending);
    const actors = JSON.parse(JSON.stringify([attacker, target]));
    const before = Object.fromEntries(room.game.units.map((unit) => [unit.id, unit.hp]));
    const acted = attacker.acted;
    attacker.acted = false;
    let events;
    try {
      const combatWeapon = room.pending.freeFollowup
        ? { ...weapon, en: 0, maxUses: undefined }
        : weapon;
      events = rules.fight(
        room.game,
        attacker,
        target,
        combatWeapon,
        response,
        counterId,
        allowCounter,
      );
    } catch (error) {
      attacker.acted = acted;
      throw error;
    }
    for (const event of events) {
      if (event.from === attacker.id) {
        if (room.pending.shotIndices) event.shotIndices = room.pending.shotIndices;
        event.energySpent = weapon.en;
        if (room.pending.impactCell) event.impactCell = room.pending.impactCell;
      }
    }
    delete attacker.plan;
    const battle = {
      id: randomId(),
      matchId: room.matchId,
      a: attacker.id,
      b: target.id,
      actors,
      before,
      events,
    };
    room.combats.push(battle);
    room.combats = room.combats.slice(-128);
    room.pending = null;
    return battle;
  }
  function counterOptions(room, attacker, target, intent = null) {
    if (intent?.noCounter) return { remaining: 0, ids: [] };
    const reserved = { ...target };
    for (const choice of room.responses || []) {
      if (choice.response !== "counter" || choice.intent.target !== target.id) continue;
      const weapons = (choice.counterIds || [choice.counterId]).map((id) =>
        rules.modelOf(target).weapons.find((w) => w.id === id),
      );
      reserved.counterCount = (reserved.counterCount || 0) + 1;
      reserved.counterTargetId = choice.counterTargetId || choice.intent.attacker;
      reserved.en -= weapons.reduce((sum, w) => sum + (w ? rules.weaponStats(w, target).en : 0), 0);
    }
    return {
      remaining: rules.countersRemaining(reserved),
      ids: rules
        .modelOf(target)
        .weapons.filter((weapon) => rules.canCounter(room.game, reserved, attacker, weapon))
        .map((weapon) => weapon.id),
    };
  }
  // 先收集选择，不扣 EN、不掷命中，也不提前移除任何单位。
  function choose(room, reactionId, response, counterId, counterTargetId) {
    const pending =
      room.reactions?.find((request) => request.id === reactionId) ||
      (room.pending?.id === reactionId ? room.pending : null);
    if (!pending) throw Error("应战请求已过期，请处理当前交战");
    counterTargetId ??= pending.attacker;
    if (!["counter", "defend", "evade"].includes(response)) throw Error("未知应战方式");
    const attack = (pending.attacks || [pending]).find(
      (attack) => attack.attacker === counterTargetId,
    );
    if (response === "counter" && !attack) throw Error("反击目标必须是正在攻击该单位的敌人");
    const attacker = find(room, counterTargetId),
      target = find(room, pending.target);
    const counterIds = Array.isArray(counterId) ? [...counterId] : [counterId];
    if (response === "counter") {
      if (attack.noCounter) throw Error("反击次数已用完，或武器不满足射程与 EN 条件");
      const options = counterOptions(room, attacker, target, attack).ids;
      if (counterIds.some((id) => !options.includes(id)))
        throw Error("反击次数已用完，或武器不满足射程与 EN 条件");
      rules.counterQueue(
        room.game,
        target,
        attacker,
        counterIds.map((id) => rules.modelOf(target).weapons.find((w) => w.id === id)),
      );
    }
    if (response === "counter") rules.faceTarget(target, attacker);
    (room.responses ||= []).push({
      intent: pending,
      response,
      counterId: counterIds[0],
      counterIds: response === "counter" ? counterIds : [],
      counterTargetId: response === "counter" ? counterTargetId : null,
    });
    room.reactions = (room.reactions || []).filter((request) => request.id !== reactionId);
    room.pending = room.reactions[0] || null;
  }
  function resolve(room) {
    if (room.pending || room.reactions?.length || room.plans.length)
      throw Error("还有未完成的应战选择");
    const choices = room.responses || [];
    room.responses = [];
    room.combatBatch = [];
    const executions = choices.flatMap((choice) =>
      (choice.intent.attacks || [choice.intent]).map((intent) => ({ ...choice, intent })),
    );
    executions.push(...(room.emptyImpacts || []).map((intent) => ({ intent, response: "evade" })));
    room.emptyImpacts = [];
    executions.sort((a, b) => (a.intent.order || 0) - (b.intent.order || 0));
    const counterExecutions = new Set();
    for (const choice of executions) {
      const { intent, counterId } = choice;
      const counterKey = choice.intent.target + ":" + (choice.counterTargetId || intent.attacker);
      const later = executions.some(
        (other) =>
          other.intent.attacker === intent.attacker &&
          other.intent.target === intent.target &&
          (other.intent.order || 0) > (intent.order || 0),
      );
      const allowCounter =
        !later &&
        !counterExecutions.has(counterKey) &&
        choice.response === "counter" &&
        !intent.noCounter &&
        (choice.counterTargetId || intent.attacker) === intent.attacker;
      const attacker = find(room, intent.attacker),
        target = find(room, intent.target);
      const weapon = attacker && rules.eventWeapon(attacker, intent);
      const validationWeapon =
        intent.freeFollowup && weapon ? { ...weapon, en: 0, maxUses: undefined } : weapon;
      if (attacker && weapon && intent.impactCell && (!target || target.hp <= 0)) {
        if (attacker.hp <= 0 || attacker.en < validationWeapon.en) continue;
        const ghost = {
          ...JSON.parse(JSON.stringify(attacker)),
          id: "impact-" + randomId(),
          ...intent.impactCell,
          team: 1 - attacker.team,
          hp: 1,
          shield: 0,
          visualOnly: true,
        };
        const before = Object.fromEntries([attacker, ghost].map((u) => [u.id, u.hp]));
        const actors = JSON.parse(JSON.stringify([attacker, ghost]));
        attacker.en -= validationWeapon.en;
        if (Number.isInteger(validationWeapon.maxUses))
          (attacker.weaponUses ||= {})[weapon.id] = (attacker.weaponUses[weapon.id] || 0) + 1;
        attacker.acted = true;
        delete attacker.plan;
        const event = {
          from: attacker.id,
          to: ghost.id,
          weapon: weapon.id,
          type: weapon.type,
          shotIndices: intent.shotIndices,
          energySpent: weapon.en,
          impactCell: intent.impactCell,
          empty: true,
          hit: false,
          damage: 0,
          before: 1,
          after: 1,
          shieldBefore: 0,
          shieldAfter: 0,
          shieldDamage: 0,
          hitCount: 0,
          strikeCount: weapon.attack.strikes.length,
          response: "evade",
          strikes: weapon.attack.strikes.map((step) => ({
            ...step,
            executed: true,
            hit: false,
            damage: 0,
            shieldDamage: 0,
            before: 1,
            after: 1,
          })),
        };
        const battle = {
          id: randomId(),
          matchId: room.matchId,
          a: attacker.id,
          b: ghost.id,
          actors,
          before,
          events: [event],
        };
        room.combats.push(battle);
        room.combatBatch.push(battle);
        continue;
      }
      if (
        room.game.winner !== null ||
        !attacker ||
        !target ||
        !weapon ||
        !rules.canAttack(room.game, attacker, target, validationWeapon)
      )
        continue;
      const counterIds = (choice.counterIds || [counterId]).filter((id) => {
        const weapon = rules.modelOf(target).weapons.find((w) => w.id === id);
        return rules.canCounter(room.game, target, attacker, weapon);
      });
      // 先前交战破坏部位或消耗 EN 后，只保留仍可执行的序列。
      const live = [];
      for (const id of counterIds) {
        try {
          rules.counterQueue(
            room.game,
            target,
            attacker,
            [...live, id].map((id) => rules.modelOf(target).weapons.find((w) => w.id === id)),
          );
          live.push(id);
        } catch {}
      }
      const response = allowCounter && !live.length ? "defend" : choice.response;
      room.pending = { ...intent, id: randomId() };
      const battle = respond(room, room.pending.id, response, live, allowCounter);
      if (allowCounter) counterExecutions.add(counterKey);
      battle.attackQueue = {
        attacker: intent.attacker,
        index: intent.queueIndex ?? 0,
        length: intent.queueLength ?? 1,
      };
      room.combatBatch.push(battle);
    }
    room.pending = null;
    for (const choice of executions) {
      const attacker = find(room, choice.intent.attacker);
      if (attacker) delete attacker.plan;
    }
    // Apply after the entire batch so mortar pellets do not block one another.
    for (const battle of room.combatBatch)
      for (const event of battle.events) {
        const unit = find(room, event.from);
        if (unit && event.strikes?.some((strike) => strike.executed))
          rules.startWeaponCooldown(
            unit,
            rules.modelOf(unit).weapons.find((w) => w.id === event.weapon),
          );
      }
    return room.combatBatch;
  }
  return {
    reset,
    plan,
    cancel,
    next,
    prepare,
    respond,
    choose,
    resolve,
    counterOptions,
    resumeCharges,
  };
}
if (typeof module !== "undefined") module.exports = { createAttackPlanner };
