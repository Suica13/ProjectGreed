/* 攻击计划只预留行动；所有应战选择完成后统一按顺序扣 EN、判定命中和伤害。
 * 此模块不管理网络、计时或客户端演出，便于独立验证。 */
"use strict";
function createAttackPlanner(rules, randomId) {
  const find = (room, id) => room.game.units.find((unit) => unit.id === id);
  function reset(room) {
    room.plans = [];
    room.combats = [];
    room.pending = null;
    room.responses = [];
    room.combatBatch = [];
    room.playback = null;
    room.planSequence = 0;
  }
  function plan(room, attacker, target, weapon, seat) {
    if ((attacker.acted && !attacker.plan) || !rules.canAttack(room.game, attacker, target, weapon))
      throw Error("目标、武器、射程或资源不满足条件");
    const intent = { attacker: attacker.id, target: target.id, weapon: weapon.id, seat };
    const index = room.plans.findIndex((plan) => plan.attacker === attacker.id);
    intent.order = index < 0 ? ++room.planSequence : room.plans[index].order;
    if (index < 0) room.plans.push(intent);
    else room.plans[index] = intent;
    attacker.plan = { target: target.id, weapon: weapon.id };
    attacker.acted = true;
    // 持用武器随计划写入权威状态，避免快照刷新后恢复成初始武器。
    if (weapon.changeHeldWeapon !== false) attacker.heldWeapon = weapon.id;
    rules.faceTarget(attacker, target);
    return intent;
  }
  function cancel(room, attacker) {
    if (!attacker.plan) throw Error("该单位没有攻击计划");
    room.plans = room.plans.filter((plan) => plan.attacker !== attacker.id);
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
      const weapon =
        attacker && rules.modelOf(attacker).weapons.find((weapon) => weapon.id === intent.weapon);
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
        const weapon =
          from && rules.modelOf(from).weapons.find((weapon) => weapon.id === other.weapon);
        if (from && weapon && rules.canAttack(room.game, from, target, weapon)) attacks.push(other);
        else if (from) delete from.plan;
        return false;
      });
      room.pending = { ...intent, attacks, id: randomId() };
      return room.pending;
    }
    return null;
  }
  function respond(room, reactionId, response, counterId, allowCounter = true) {
    if (!room.pending || reactionId !== room.pending.id)
      throw Error("应战请求已过期，请处理当前交战");
    const attacker = find(room, room.pending.attacker),
      target = find(room, room.pending.target);
    const weapon = rules
      .modelOf(attacker)
      .weapons.find((weapon) => weapon.id === room.pending.weapon);
    const actors = JSON.parse(JSON.stringify([attacker, target]));
    const before = Object.fromEntries(room.game.units.map((unit) => [unit.id, unit.hp]));
    const acted = attacker.acted;
    attacker.acted = false;
    let events;
    try {
      events = rules.fight(room.game, attacker, target, weapon, response, counterId, allowCounter);
    } catch (error) {
      attacker.acted = acted;
      throw error;
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
  function counterOptions(room, attacker, target) {
    const reserved = { ...target };
    for (const choice of room.responses || []) {
      if (choice.response !== "counter" || choice.intent.target !== target.id) continue;
      const weapon = rules.modelOf(target).weapons.find((weapon) => weapon.id === choice.counterId);
      reserved.counterCount = (reserved.counterCount || 0) + 1;
      reserved.counterTargetId = choice.counterTargetId || choice.intent.attacker;
      reserved.en -= weapon?.en || 0;
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
  function choose(room, reactionId, response, counterId, counterTargetId = room.pending?.attacker) {
    if (!room.pending || reactionId !== room.pending.id)
      throw Error("应战请求已过期，请处理当前交战");
    if (!["counter", "defend", "evade"].includes(response)) throw Error("未知应战方式");
    const attack = (room.pending.attacks || [room.pending]).find(
      (attack) => attack.attacker === counterTargetId,
    );
    if (response === "counter" && !attack) throw Error("反击目标必须是正在攻击该单位的敌人");
    const attacker = find(room, counterTargetId),
      target = find(room, room.pending.target);
    const counter = rules.modelOf(target).weapons.find((weapon) => weapon.id === counterId);
    if (
      response === "counter" &&
      (!counter || !counterOptions(room, attacker, target).ids.includes(counterId))
    )
      throw Error("反击次数已用完，或武器不满足射程与 EN 条件");
    if (response === "counter") rules.faceTarget(target, attacker);
    (room.responses ||= []).push({
      intent: room.pending,
      response,
      counterId,
      counterTargetId: response === "counter" ? counterTargetId : null,
    });
    room.pending = null;
  }
  function resolve(room) {
    if (room.pending || room.plans.length) throw Error("还有未完成的应战选择");
    const choices = room.responses || [];
    room.responses = [];
    room.combatBatch = [];
    const executions = choices.flatMap((choice) =>
      (choice.intent.attacks || [choice.intent]).map((intent) => ({ ...choice, intent })),
    );
    executions.sort((a, b) => (a.intent.order || 0) - (b.intent.order || 0));
    for (const choice of executions) {
      const { intent, counterId } = choice;
      const allowCounter =
        choice.response === "counter" &&
        (choice.counterTargetId || intent.attacker) === intent.attacker;
      const attacker = find(room, intent.attacker),
        target = find(room, intent.target);
      const weapon =
        attacker && rules.modelOf(attacker).weapons.find((weapon) => weapon.id === intent.weapon);
      if (
        room.game.winner !== null ||
        !attacker ||
        !target ||
        !weapon ||
        !rules.canAttack(room.game, attacker, target, weapon)
      )
        continue;
      const counter = rules.modelOf(target).weapons.find((weapon) => weapon.id === counterId);
      // 先前交战可能消耗了反击次数或 EN；此时保留防御，不能让整批结算失败。
      const response =
        allowCounter && (!counter || !rules.canCounter(room.game, target, attacker, counter))
          ? "defend"
          : choice.response;
      room.pending = { ...intent, id: randomId() };
      room.combatBatch.push(respond(room, room.pending.id, response, counterId, allowCounter));
    }
    room.pending = null;
    for (const choice of executions) {
      const attacker = find(room, choice.intent.attacker);
      if (attacker) delete attacker.plan;
    }
    return room.combatBatch;
  }
  return { reset, plan, cancel, next, respond, choose, resolve, counterOptions };
}
if (typeof module !== "undefined") module.exports = { createAttackPlanner };
