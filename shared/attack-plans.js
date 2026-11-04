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
  function syncPlan(room, attacker) {
    const orders = room.plans.filter((order) => order.attacker === attacker.id);
    if (!orders.length) {
      delete attacker.plan;
      return;
    }
    const last = orders.at(-1);
    attacker.plan = {
      target: last.target,
      targetCell: last.targetCell,
      aimCell: last.aimCell,
      weapon: last.weapon,
      weapons: last.weapons,
      attacks: orders.map((order) => ({
        target: order.target,
        targetCell: order.targetCell,
        aimCell: order.aimCell,
        weapon: order.weapon,
        weapons: order.weapons,
        order: order.order,
      })),
    };
  }
  function skillWeapon(attacker, requested) {
    const ids = Array.isArray(requested) ? requested : [requested];
    return ids.length === 1 && rules.modelOf(attacker).weapons.find(w =>
      w.id === ids[0]?.id && w.slot === "skill");
  }
  function planOne(room, attacker, target, weapon, seat, combatMode = "melee") {
    const skill = skillWeapon(attacker, weapon);
    if (attacker.attackSkillRound === room.game.round) throw Error("本回合已使用攻击类技能");
    if (skill) {
      if (attacker.plan || attacker.acted || attacker.team !== room.game.team || !rules.canAttack(room.game, attacker, target, skill))
        throw Error("攻击类技能不能与普通攻击同时使用");
      const intent = { automatic: false, attacker: attacker.id, target: target.id,
        ...(target.groundTarget ? { targetCell: {x:target.x,y:target.y} } : {}),
        aimCell: target.aimCell, seat, weapon: skill.id, weapons: [skill.id],
        noCounter: !!skill.noCounter, order: ++room.planSequence };
      room.plans.push(intent);
      syncPlan(room, attacker);
      attacker.attackSkillRound = room.game.round;
      attacker.acted = true;
      rules.faceTarget(attacker,target);
      return intent;
    }
    if (
      !target ||
      target.groundTarget ||
      attacker.team !== room.game.team ||
      (attacker.acted && !attacker.plan)
    )
      throw Error("当前不能攻击此目标");
    const firePlan = rules.firePlan(room.game, attacker, target, { combatMode });
    const automatic = firePlan.weapons;
    if (!automatic.length) throw Error("没有满足射程、EN与部位条件的武器");
    const intent = {
      automatic: true,
      enCost: firePlan.en,
      combatMode,
      attacker: attacker.id,
      target: target.id,
      targetSquad: rules.squadAttackMembers(room.game, target).map((unit) => unit.id),
      seat,
      weapon: automatic[0].id,
      weapons: automatic.map((w) => w.id),
      noCounter: automatic.every((w) => w.noCounter),
      order: ++room.planSequence,
    };
    room.plans = room.plans.filter((order) => order.attacker !== attacker.id);
    room.plans.push(intent);
    syncPlan(room, attacker);
    attacker.acted = true;
    rules.faceTarget(attacker, target);
    return intent;
  }
  function plan(
    room,
    attacker,
    target,
    weapon,
    seat,
    combatMode = "melee",
    single = false,
    manualPlans = null,
  ) {
    if (manualPlans !== null) throw Error("当前模式不支持手动选择武器");
    if (!["melee", "shooting"].includes(combatMode)) throw Error("无效的交战方式");
    const members = single || skillWeapon(attacker, weapon) ? [attacker] : rules.squadAttackMembers(room.game, attacker)
      .filter(unit => !unit.embarked?.exposed || !unit.acted || unit.plan || unit.squadOrder);
    if (members.length === 1) return planOne(room, attacker, target, weapon, seat, combatMode);
    // Stage the whole squad: a rejected command must never reserve only half its members.
    const ids = new Set(members.map((unit) => unit.id));
    const staged = {
      ...room,
      plans: room.plans.filter((intent) => !ids.has(intent.attacker)),
      game: {
        ...room.game,
        units: room.game.units.map((unit) => (ids.has(unit.id) ? structuredClone(unit) : unit)),
      },
    };
    for (const unit of staged.game.units.filter((unit) => ids.has(unit.id)))
      if (unit.plan || unit.squadOrder) {
        delete unit.plan;
        delete unit.squadOrder;
        unit.acted = false;
      }
    let first = null;
    for (let index = 0; index < members.length; index++) {
      const original = members[index],
        unit = find(staged, original.id);
      if (rules.controllerOf(room.game, original) !== rules.controllerOf(room.game, attacker))
        throw Error("不能操作其他玩家的小队成员");
      if (unit.acted && !unit.plan) throw Error("小队中存在已行动单位");
      if (!rules.firePlan(staged.game, unit, target, { combatMode }).weapons.length) continue;
      const intent = planOne(staged, unit, target, weapon, seat, combatMode);
      first ||= intent;
    }
    if (!first) throw Error("没有满足射程、EN与部位条件的武器");
    room.plans = staged.plans;
    room.planSequence = staged.planSequence;
    for (const original of members) {
      delete original.plan;
      delete original.squadOrder;
      Object.assign(original, find(staged, original.id));
      original.acted = true;
      original.squadOrder = true;
      rules.faceTarget(original, target);
    }
    return first;
  }
  // Validate every target against an isolated copy before reserving any resources.
  function planBatch(room, attacker, orders, seat, single = false) {
    if (!Array.isArray(orders) || orders.length !== 1) throw Error("请选择有效的武器序列");
    const previewUnits = structuredClone(room.game.units);
    const preview = previewUnits.find((unit) => unit.id === attacker.id);
    const staged = {
      ...room,
      plans: [...room.plans],
      game: {
        ...room.game,
        units: previewUnits,
      },
    };
    const intents = orders.map((order) => {
      const target = order && find(staged, order.targetId);
      if (!target) throw Error("攻击目标无效");
      return plan(staged, preview, target, null, seat, "melee", single);
    });
    room.plans = staged.plans;
    room.planSequence = staged.planSequence;
    for (const unit of room.game.units) Object.assign(unit, find(staged, unit.id));
    return intents;
  }
  function cancelOne(room, attacker, targetId = null) {
    if (attacker.attackSkillRound === room.game.round) throw Error("攻击类技能发动后不能取消攻击");
    if (!attacker.plan) throw Error("该单位没有攻击计划");
    const removed = room.plans.filter(
      (order) => order.attacker === attacker.id && (targetId === null || order.target === targetId),
    );
    if (!removed.length) throw Error("该目标没有攻击计划");
    room.plans = room.plans.filter((order) => !removed.includes(order));
    syncPlan(room, attacker);
    attacker.acted = !!attacker.plan;
  }
  function followSquad(room, joined) {
    const members = rules.squadAttackMembers(room.game, joined);
    const ids = new Set(members.map(unit => unit.id));
    const order = room.plans.find(intent => intent.automatic && ids.has(intent.attacker));
    const target = order && find(room, order.target);
    if (!target || target.hp <= 0) return;
    for (const unit of members) {
      if (unit.acted || unit.plan || unit.pendingMove || unit.attackSkillRound === room.game.round) continue;
      if (!rules.firePlan(room.game, unit, target, { combatMode: order.combatMode }).weapons.length) continue;
      planOne(room, unit, target, null, order.seat, order.combatMode);
      unit.squadOrder = true;
    }
  }
  function cancel(room, attacker, targetId = null, single = false) {
    const members = single ? [attacker] : rules.squadAttackMembers(room.game, attacker);
    const candidates = members.filter(
      (member) =>
        member.plan &&
        room.plans.some(
          (intent) =>
            intent.attacker === member.id && (targetId === null || intent.target === targetId),
        ),
    );
    if (!candidates.length) throw Error("该单位没有攻击计划");
    if (candidates.some(member => member.attackSkillRound === room.game.round))
      throw Error("攻击类技能发动后不能取消攻击");
    for (const member of candidates) cancelOne(room, member, targetId);
    for (const member of members) {
      if (member.squadOrder && !member.plan) member.acted = false;
      delete member.squadOrder;
    }
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
        !(intent.automatic
          ? rules
              .squadMembers(room.game, target)
              .some((enemy) =>
                rules
                  .automaticWeapons(room.game, attacker, enemy)
                  .some((w) => intent.weapons.includes(w.id)),
              )
          : rules.canAttack(room.game, attacker, target, weapon))
      ) {
        if (attacker) {
          delete attacker.plan;
          attacker.acted = true;
        }
        continue;
      }
      rules.faceTarget(attacker, target);
      rules.faceTarget(target, attacker);
      // A defender squad has one response panel. Include incoming fire aimed
      // at any member, so the panel can select every attacking enemy squad.
      const targetIds = new Set(rules.squadAttackMembers(room.game, target).map((unit) => unit.id));
      const attacks = [intent];
      room.plans = room.plans.filter((other) => {
        if (!targetIds.has(other.target)) return true;
        const from = find(room, other.attacker);
        const weapon = from && rules.eventWeapon(from, other);
        if (
          from &&
          weapon &&
          (other.automatic
            ? rules
                .squadMembers(room.game, target)
                .some((enemy) =>
                  rules
                    .automaticWeapons(room.game, from, enemy)
                    .some((w) => other.weapons.includes(w.id)),
                )
            : rules.canAttack(room.game, from, target, weapon))
        )
          attacks.push(other);
        else if (from) delete from.plan;
        return false;
      });
      const defenders = rules.squadAttackMembers(room.game, target);
      const representative =
        defenders.find(
          (member) => rules.automaticSquadQueue(room.game, member, attacker, true).length,
        ) ||
        defenders[0] ||
        target;
      room.pending = { ...intent, target: representative.id, attacks, id: randomId() };
      return room.pending;
    }
    return null;
  }
  function expandSpecials(room) {
    const result = [];
    room.emptyImpacts = [];
    const counts = new Map(),
      positions = new Map();
    for (const intent of room.plans)
      counts.set(
        intent.attacker,
        (counts.get(intent.attacker) || 0) + (intent.weapons || [intent.weapon]).length,
      );
    const expanded = room.plans.flatMap((intent) =>
      intent.automatic
        ? [intent]
        : (intent.weapons || [intent.weapon]).map((weapon, index) => {
            const queueIndex = positions.get(intent.attacker) || 0;
            positions.set(intent.attacker, queueIndex + 1);
            return {
              ...intent,
              weapon,
              weapons: undefined,
              order: intent.order + index / 1000,
              queueIndex,
              queueLength: counts.get(intent.attacker),
            };
          }),
    );
    for (const intent of expanded) {
      if (intent.automatic) {
        const attacker = find(room, intent.attacker);
        intent.weapons = intent.weapons.filter((id) => {
          const weapon = rules.modelOf(attacker).weapons.find((w) => w.id === id);
          if (weapon?.special?.type !== "snipe") return true;
          // Charging remains a next-own-turn shot; selecting weapons is automatic.
          if (!attacker.snipeOrder) {
            attacker.snipeOrder = {
              target: intent.target,
              weapon: id,
              readyRound: room.game.round + 2,
            };
          }
          return false;
        });
        if (intent.weapons.length) {
          intent.weapon = intent.weapons[0];
          intent.noCounter = intent.weapons.every(
            (id) => rules.modelOf(attacker).weapons.find((w) => w.id === id).noCounter,
          );
          result.push(intent);
        } else delete attacker.plan;
        continue;
      }
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
      if (["nuke", "blast"].includes(weapon.special?.type)) {
        const target = intent.targetCell
          ? rules.groundTarget(room.game, attacker, intent.targetCell.x, intent.targetCell.y)
          : find(room, intent.target);
        if (!target || !rules.canAttack(room.game, attacker, target, weapon)) {
          delete attacker.plan;
          continue;
        }
        const impact = intent.aimCell ?? rules.attackAimCell(room.game, attacker, target, [weapon]) ?? rules.center(target);
        const blastId = randomId();
        // A mortar salvo is launched once at a cell. Resolve every occupant at
        // each shell's impact, rather than queuing a full hidden salvo per victim.
        if (weapon.category === "mortar") {
          result.push({ ...intent, impactCell: impact, blastId, cellBlast: true });
          continue;
        }
        const victims = room.game.units
          .filter(
            (unit) =>
              unit.team !== attacker.team &&
              rules.onMap(unit) &&
              rules.blastContains(impact, unit, weapon.special.radius, weapon.special.shape) &&
              rules.canAttack(room.game, attacker, unit, { ...weapon, blastCenter: impact }),
          )
          .sort((a, b) => a.id.localeCompare(b.id, "en"));
        if (!victims.length) {
          room.emptyImpacts.push({
            ...intent,
            target: null,
            energySpent: weapon.en,
            impactCell: impact,
            blastId,
            noCounter: weapon.noCounter === true,
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
              blastId,
              noCounter: weapon.noCounter === true,
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
          turnUseContinuation: index > 0,
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
      unit.attackSkillRound = room.game.round;
      unit.acted = true;
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
    // Unfocused squad members can counter without duplicating incoming fire.
    for (const request of [...room.reactions])
      for (const member of rules.squadAttackMembers(room.game, find(room, request.target)))
        if (!room.reactions.some((other) => other.target === member.id))
          room.reactions.push({ ...request, id: randomId(), target: member.id, supportOnly: true });
    room.pending = room.reactions[0] || null;
    return room.reactions;
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
        .automaticSquadQueue(room.game, reserved, attacker, true)
        .map((weapon) => weapon.id),
    };
  }
  // 先收集选择，不扣 EN、不掷命中，也不提前移除任何单位。
  function chooseOne(room, reactionId, response, counterId, counterTargetId, manualIds = null) {
    const pending =
      room.reactions?.find((request) => request.id === reactionId) ||
      (room.pending?.id === reactionId ? room.pending : null);
    if (!pending) throw Error("应战请求已过期，请处理当前交战");
    if (manualIds !== null) throw Error("当前模式不支持手动选择武器");
    counterTargetId ??= pending.attacker;
    if (!["counter", "defend", "evade"].includes(response)) throw Error("未知应战方式");
    const attack = rules
      .counterTargetEntries(room.game, pending)
      .find((attack) => attack.attacker === counterTargetId);
    if (response === "counter" && !attack) throw Error("反击目标必须是正在攻击该单位的敌人");
    const attacker = find(room, counterTargetId),
      target = find(room, pending.target);
    const counterIds = Array.isArray(counterId) ? [...counterId] : [counterId];
    if (response === "counter") {
      if (attack.noCounter) throw Error("本次不能反击");
      const reserved = { ...target };
      for (const choice of room.responses || []) {
        if (choice.response !== "counter" || choice.intent.target !== target.id) continue;
        const used = (choice.counterIds || []).map((id) =>
          rules.modelOf(target).weapons.find((w) => w.id === id),
        );
        reserved.en -= used.reduce((sum, w) => sum + rules.weaponStats(w, target).en, 0);
      }
      const plan = rules.firePlan(room.game, reserved, attacker, {
        counter: true,
        combatMode: "melee",
      });
      counterIds.splice(0, counterIds.length, ...plan.weapons.map((w) => w.id));
      if (!counterIds.length) {
        response = "defend";
      }
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
  function choose(room, reactionId, response, counterId, counterTargetId, memberResponses = null) {
    const pending = room.reactions?.find((request) => request.id === reactionId) || room.pending;
    if (!pending || pending.id !== reactionId) throw Error("应战请求已过期，请处理当前交战");
    const members = new Set(
      rules.squadAttackMembers(room.game, find(room, pending.target)).map((unit) => unit.id),
    );
    const overrides = new Map();
    if (memberResponses !== null) {
      if (!Array.isArray(memberResponses) || memberResponses.length > members.size)
        throw Error("无效的小队应战方案");
      for (const choice of memberResponses) {
        if (
          !choice ||
          !members.has(choice.unitId) ||
          overrides.has(choice.unitId) ||
          !["counter", "defend", "evade"].includes(choice.response)
        )
          throw Error("无效的小队应战方案");
        overrides.set(choice.unitId, choice);
      }
    }
    if (members.size < 2) {
      const choice = overrides.get(pending.target);
      return chooseOne(
        room,
        reactionId,
        choice?.response ?? response,
        counterId,
        choice?.counterTargetId ?? counterTargetId,
        choice?.weaponIds ?? null,
      );
    }
    const requests = (room.reactions || [pending]).filter((request) => members.has(request.target));
    const staged = {
      ...room,
      reactions: [...(room.reactions || [])],
      responses: [...(room.responses || [])],
      game: { ...room.game, units: structuredClone(room.game.units) },
    };
    for (const request of requests) {
      const choice = overrides.get(request.target),
        requestedResponse = choice?.response ?? response,
        requestedTarget = choice?.counterTargetId ?? counterTargetId;
      const attacks = rules.counterTargetEntries(staged.game, request);
      const targetId = attacks.some((attack) => attack.attacker === requestedTarget)
        ? requestedTarget
        : request.attacker;
      const defender = find(staged, request.target),
        attacker = find(staged, targetId);
      const stance =
        requestedResponse === "counter" &&
        (request.noCounter ||
          (choice?.weaponIds === undefined &&
            !rules.firePlan(staged.game, defender, attacker, {
              counter: true,
              combatMode: "melee",
            }).weapons.length))
          ? "defend"
          : requestedResponse;
      chooseOne(staged, request.id, stance, counterId, targetId, choice?.weaponIds ?? null);
    }
    room.reactions = staged.reactions;
    room.responses = staged.responses;
    room.pending = staged.pending;
    for (const unit of room.game.units) Object.assign(unit, find(staged, unit.id));
  }
  function chooseBatch(room, reactionId, orders) {
    if (!Array.isArray(orders) || orders.length !== 1) throw Error("反击只能选择一个目标");
    return choose(room, reactionId, "counter", [], orders[0].targetId);
  }
  function resolve(room) {
    if (room.pending || room.reactions?.length || room.plans.length)
      throw Error("还有未完成的应战选择");
    const choices = [
      ...(room.responses || []),
      ...(room.emptyImpacts || []).map((intent) => ({ intent, response: "evade" })),
    ];
    room.emptyImpacts = [];
    return rules.resolveAutomatic(room, choices, randomId);
  }
  return {
    reset,
    plan,
    planBatch,
    followSquad,
    cancel,
    next,
    prepare,
    choose,
    chooseBatch,
    resolve,
    counterOptions,
    resumeCharges,
  };
}
if (typeof module !== "undefined") module.exports = { createAttackPlanner };
