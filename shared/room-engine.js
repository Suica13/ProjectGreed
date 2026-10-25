/* 遭遇战房间规则：服务端和浏览器离线房间复用同一个裁定入口。
 * transport 只收发消息；HP、命中、部署、AI 和回合均在这里决定。
 */
"use strict";
function createRoomEngine({
  rules: G,
  chatChannels = typeof ChatChannels === "undefined" ? require("./chat-channels.js") : ChatChannels,
  rooms = new Map(),
  send,
  onRooms = () => {},
  randomId,
  randomSeed,
  randomToken,
  resultReturnMs = 30000,
  roomReturnMs = 5000,
  aiDelayMs = 500,
  aiBattleMs = 10000,
  hostReconnectMs = 10000,
}) {
  // 未参战的出生点不等待连接；参战席位掉线仍然暂停，保留重连/补位流程。
  const createPlanner =
    typeof createAttackPlanner === "undefined"
      ? require("./attack-plans.js").createAttackPlanner
      : createAttackPlanner;
  const planner = createPlanner(G, randomId);
  const connected = (room) =>
    room.seats.map(
      (player, seat) =>
        !!player?.bot ||
        onlineMember(player) ||
        (room.started && !player && (room.phase === "assembly" || !room.activeSeats?.[seat])),
    );
  const onlineMember = (member) => member?.ws?.readyState === 1;
  const members = (room) => [...room.members.values()];
  const returnTimers = new Map();
  const resultTimers = new Map(),
    hostTimers = new Map();
  function resetReady(room) {
    for (const member of members(room)) member.ready = !!member.bot;
  }
  // 大厅只公开房间摘要，绝不发送战局 seed、席位 token 或完整对局数据。
  function roomList() {
    return [...rooms.values()]
      .map((room) => {
        const online = connected(room);
        return {
          code: room.code,
          players: room.seats.filter((player) => player?.bot || onlineMember(player)).length,
          capacity: room.seats.length,
          mapId: room.settings.mapId,
          costLimit: room.settings.costLimit,
          unitLimit: room.settings.unitLimit,
          spectators: members(room).filter((member) => member.seat === null && onlineMember(member))
            .length,
          started: room.started,
          phase:
            room.game.winner !== null
              ? "finished"
              : room.phase === "assembly"
                ? "assembly"
                : room.started
                  ? online.every(Boolean)
                    ? "playing"
                    : "disconnected"
                  : "waiting",
          joinable: room.members.size < 32,
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
  }
  function broadcastRooms() {
    onRooms(roomList());
  }
  function leaveRoom(ws) {
    const room = rooms.get(ws.room);
    const member = room?.members.get(ws.memberId);
    if (!member || member.ws !== ws) return;
    if (member.seat !== null) {
      room.seats[member.seat] = null;
      if (room.battle) room.battle.ready[member.seat] = false;
    }
    room.members.delete(member.id);
    delete ws.room;
    delete ws.memberId;
    delete ws.seat;
    send(ws, { type: "room_closed", message: "已离开房间。" });
    ws.close(1000, "Left room");
    if (!members(room).some(onlineMember)) {
      destroyRoom(room);
    } else {
      room.revision++;
      broadcast(room);
    }
  }
  // 公开快照不包含随机 seed；席位 token 不放入广播。
  const safeGame = (game) => {
    let { seed, partSeed, ...view } = game;
    return view;
  };
  function state(room, ack, recipient) {
    return {
      type: "state",
      room: room.code,
      revision: room.revision,
      game: safeGame(room.game),
      phase: room.phase,
      pending: reactionForSeat(room, recipient?.seat) || room.pending,
      reactions: room.reactions || [],
      playback: room.playback || null,
      battle: room.battle,
      plans: room.plans || [],
      counterPlans: (room.responses || [])
        .filter((choice) => choice.response === "counter")
        .map((choice) => ({
          attacker: choice.intent.target,
          target: choice.counterTargetId,
          weapon: choice.counterId,
        })),
      // 整批应战完成后一次广播本批全部结果，重连直接使用最终状态。
      combats: room.combatBatch || [],
      connected: connected(room),
      started: room.started,
      hostId: room.hostId,
      settings: room.settings,
      assembly: room.phase === "assembly" ? assemblyView(room, recipient) : null,
      turnDone: room.turnDone,
      matchId: room.matchId,
      returnAt: room.returnAt,
      returnCountdown: room.returnCountdown || null,
      serverTime: Date.now(),
      chat: room.chat.filter(
        (message) => recipient && chatChannels.canRead(recipient.seat, message.channel || "all"),
      ),
      members: members(room).map((member) => ({
        id: member.id,
        name: member.name,
        seat: member.seat,
        ready: member.ready,
        connected: !!member.bot || onlineMember(member),
        bot: !!member.bot,
        aiSettings: member.bot ? member.aiSettings : undefined,
        formationPreset: member.bot ? member.formationPreset || null : undefined,
      })),
      you: recipient ? { id: recipient.id, seat: recipient.seat } : undefined,
      log: room.log,
      logNames: room.logNames || [],
      lastEvent: room.lastEvent,
      ack,
    };
  }
  function clearHostTimer(room) {
    clearTimeout(hostTimers.get(room)?.timer);
    hostTimers.delete(room);
  }
  // Map 保持最初加入顺序；换队、观战与重连不改变房主继任顺序。
  function assignHost(room) {
    clearHostTimer(room);
    room.hostId = members(room).find((member) => !member.bot && onlineMember(member))?.id || null;
  }
  function refreshHost(room) {
    const host = room.members.get(room.hostId);
    if (host && !host.bot && onlineMember(host)) {
      clearHostTimer(room);
      return;
    }
    // 主动退出已删除成员，立即移交；仅连接中断才保留短暂重连窗口。
    if (!host || host.bot || hostReconnectMs <= 0) {
      assignHost(room);
      return;
    }
    if (hostTimers.get(room)?.hostId === host.id) return;
    clearHostTimer(room);
    const entry = { hostId: host.id };
    entry.timer = setTimeout(() => {
      if (hostTimers.get(room) !== entry || rooms.get(room.code) !== room) return;
      if (room.hostId !== entry.hostId || onlineMember(host)) {
        clearHostTimer(room);
        return;
      }
      assignHost(room);
      room.revision++;
      broadcast(room);
    }, hostReconnectMs);
    entry.timer.unref?.();
    hostTimers.set(room, entry);
  }
  function broadcast(room, ack) {
    if (!members(room).some(onlineMember)) {
      destroyRoom(room);
      return;
    }
    refreshHost(room);
    if (!room.returnCountdown) {
      completePlayback(room);
      scheduleResultReturn(room);
    }
    room.updated = Date.now();
    for (const member of members(room)) send(member.ws, state(room, ack, member));
    broadcastRooms();
    scheduleAutoEnd(room);
    scheduleAI(room);
  }
  function destroyRoom(room) {
    if (rooms.get(room.code) !== room) return;
    clearTimeout(autoEndTimers.get(room)?.timer);
    autoEndTimers.delete(room);
    clearTimeout(returnTimers.get(room));
    returnTimers.delete(room);
    clearTimeout(resultTimers.get(room));
    resultTimers.delete(room);
    clearTimeout(aiTimers.get(room));
    aiTimers.delete(room);
    clearHostTimer(room);
    rooms.delete(room.code);
    broadcastRooms();
  }
  function returnToRoom(room) {
    if (rooms.get(room.code) !== room || !room.started) return;
    clearTimeout(returnTimers.get(room));
    returnTimers.delete(room);
    clearTimeout(resultTimers.get(room));
    resultTimers.delete(room);
    room.game = G.create(false, randomSeed());
    room.started = false;
    room.phase = "waiting";
    room.pending = room.battle = null;
    planner.reset(room);
    room.returnAt = null;
    room.returnCountdown = null;
    room.turnNotBefore = 0;
    room.turnDone = Array(room.seats.length).fill(false);
    resetReady(room);
    log(room, "对局结束，已返回房间，请重新准备。");
    room.revision++;
    room.lastEvent = { id: randomId(), type: "return_room", matchId: room.matchId };
    broadcast(room);
  }
  function scheduleResultReturn(room) {
    if (room.phase !== "finished" || room.returnAt !== null) return;
    room.returnAt = Date.now() + resultReturnMs;
    const timer = setTimeout(() => {
      if (room.phase === "finished") returnToRoom(room);
    }, resultReturnMs);
    timer.unref?.();
    resultTimers.set(room, timer);
  }
  const autoEndTimers = new Map();
  function canAutoEnd(room) {
    return (
      rooms.get(room.code) === room &&
      room.started &&
      !room.returnCountdown &&
      room.phase === "idle" &&
      room.game.winner === null &&
      connected(room).every(Boolean) &&
      room.seats.every(
        (player) =>
          !player ||
          player.bot ||
          G.seatTeam(player.seat) !== room.game.team ||
          room.turnDone[player.seat],
      ) &&
      !G.hasActions(room.game)
    );
  }
  function reactionForSeat(room, seat) {
    return (
      (room.reactions || []).find((request) => G.ownerOf(unit(room, request.target)) === seat) ||
      null
    );
  }
  function botReaction(room) {
    return (
      (room.reactions || []).find(
        (request) => room.seats[G.ownerOf(unit(room, request.target))]?.bot,
      ) || null
    );
  }
  function resolvePlans(room, automatic = false) {
    const requests = planner.prepare(room);
    if (room.game.winner !== null) {
      room.phase = "finished";
      return { type: "match_end" };
    }
    if (requests.length) {
      for (const pending of requests) {
        const options = planner.counterOptions(
          room,
          unit(room, pending.attacker),
          unit(room, pending.target),
          pending,
        );
        pending.counterOptions = options.ids;
        const incoming = new Map();
        for (const attack of pending.attacks) {
          const previous = incoming.get(attack.attacker);
          if (previous) {
            previous.weapons.push(attack.weapon);
            continue;
          }
          incoming.set(attack.attacker, {
            ...attack,
            weapons: [attack.weapon],
            options: planner.counterOptions(
              room,
              unit(room, attack.attacker),
              unit(room, pending.target),
              attack,
            ).ids,
          });
        }
        pending.counterTargets = [...incoming.values()];
        pending.countersRemaining = options.remaining;
      }
      room.phase = "reaction";
      return { type: "attack", ...room.pending };
    }
    const battles = planner.resolve(room);
    for (const battle of battles)
      for (const e of battle.events) {
        if (e.empty) {
          log(room, `迫击炮落点 (${e.impactCell.x},${e.impactCell.y})：空地。`);
          continue;
        }
        const from = unit(room, e.from),
          to = unit(room, e.to);
        const weapon = G.modelOf(from).weapons.find((weapon) => weapon.id === e.weapon);
        log(
          room,
          `${unitLabel(room, from)} 使用${weapon.name} → ${unitLabel(room, to)}：${e.hit ? e.damage + "伤害" : "未命中"}（命中 ${e.hitCount}/${e.strikeCount}）${e.brokenParts?.length ? "，部位破坏：" + [...new Set(e.brokenParts)].map((part) => G.partNames[part] || part).join("、") : ""}${e.after <= 0 ? "，击破！" : ""}`,
        );
      }
    if (battles.length) {
      room.playback = {
        id: randomId(),
        matchId: room.matchId,
        members: members(room)
          .filter((member) => !member.bot && onlineMember(member))
          .map((member) => member.id),
        ready: [],
        automatic,
        resumeTurn: !!room.openingSnipe,
      };
      room.phase = "playback";
      return { type: "combat_batch", batchId: room.playback.id };
    }
    room.phase = "idle";
    if (room.openingSnipe) return resumeActionPhase(room, automatic);
    return advanceTurn(room, automatic);
  }
  function completePlayback(room) {
    const playback = room.playback;
    if (room.returnCountdown || room.phase !== "playback" || !playback) return;
    playback.members = playback.members.filter((id) => room.members.has(id));
    if (!playback.members.every((id) => playback.ready.includes(id))) return;
    room.playback = null;
    room.phase = room.game.winner === null ? "idle" : "finished";
    const event =
      room.game.winner === null
        ? playback.resumeTurn
          ? resumeActionPhase(room, playback.automatic)
          : advanceTurn(room, playback.automatic)
        : { type: "match_end" };
    room.revision++;
    room.lastEvent = { id: randomId(), ...event };
  }
  function resumeActionPhase(room, automatic = false) {
    delete room.openingSnipe;
    room.turnNotBefore = Date.now() + G.turnTransitionMs;
    return {
      type: "turn",
      fromTeam: room.game.team,
      toTeam: room.game.team,
      round: room.game.round,
      automatic,
    };
  }
  function advanceTurn(room, automatic = false) {
    delete room.openingSnipe;
    const fromTeam = room.game.team;
    G.end(room.game);
    if (room.game.winner !== null) {
      room.phase = "finished";
      return { type: "match_end" };
    }
    for (const effect of room.game.turnEffects || [])
      if (effect.type === "overdrive")
        log(
          room,
          `${unitLabel(room, unit(room, effect.unitId))} ${effect.skillId}消耗耐久与EN${effect.expired ? "，强化解除" : ""}。`,
        );
    planner.resumeCharges(room);
    room.turnDone = Array(room.seats.length).fill(false);
    room.turnNotBefore = Date.now() + G.turnTransitionMs;
    log(room, `第${room.game.round}回合 · 队伍${room.game.team + 1}开始行动，不自动恢复EN。`);
    if (room.plans.length) {
      room.openingSnipe = true;
      return resolvePlans(room, automatic);
    }
    return { type: "turn", fromTeam, toTeam: room.game.team, round: room.game.round, automatic };
  }
  // 人类必须手动结束个人行动；仅在无需等待人类时保留 AI 的自动推进。
  function scheduleAutoEnd(room) {
    const old = autoEndTimers.get(room);
    if (!canAutoEnd(room)) {
      clearTimeout(old?.timer);
      autoEndTimers.delete(room);
      return;
    }
    if (old?.game === room.game && old.round === room.game.round) return;
    clearTimeout(old?.timer);
    const entry = { game: room.game, round: room.game.round };
    entry.timer = setTimeout(
      () => {
        autoEndTimers.delete(room);
        if (!canAutoEnd(room) || room.game !== entry.game || room.game.round !== entry.round)
          return;
        room.lastEvent = { id: randomId(), ...resolvePlans(room, true) };
        room.revision++;
        broadcast(room);
      },
      Math.max(0, (room.turnNotBefore || 0) - Date.now()) + 1000,
    );
    entry.timer.unref?.();
    autoEndTimers.set(room, entry);
  }
  // AI uses the same validated intents as players. Its controller is only an
  // internal address, never a WebSocket or a reconnectable human identity.
  const aiTimers = new Map();
  function playerBudget(room, player) {
    return player?.bot
      ? G.aiBudget(room.settings.costLimit, player.aiSettings)
      : room.settings.costLimit;
  }
  const playerUnitLimit = (room, player) =>
    player?.bot
      ? G.aiUnitLimit(room.settings.unitLimit, player.aiSettings)
      : room.settings.unitLimit;
  function randomArmy(room, player, seed = randomSeed()) {
    if (player.formationPreset)
      return G.validateFormation(
        player.formationPreset.units.slice(0, playerUnitLimit(room, player)),
        Infinity,
        playerUnitLimit(room, player),
      );
    return G.randomFormation(
      seed,
      playerBudget(room, player),
      G.formationRestrictions(room.settings, player.seat),
      playerUnitLimit(room, player),
    );
  }
  function checkAIArmy(room, player) {
    if (
      !G.planFormation(
        randomArmy(room, player, 7319),
        playerBudget(room, player),
        G.formationRestrictions(room.settings, player.seat),
        playerUnitLimit(room, player),
      ).deployable.length
    )
      throw Error("AI 没有符合房间或队伍限制的可用单位，请调整限制或预算");
  }
  function formationPlan(room, player) {
    const entries = player.formation || randomArmy(room, player, 7319);
    if (!entries.length)
      return {
        entries: [],
        totalCost: 0,
        deployCost: 0,
        disabled: [],
        reasons: {},
        deployable: [],
        indices: [],
      };
    return G.planFormation(
      entries,
      playerBudget(room, player),
      G.formationRestrictions(room.settings, player.seat),
      playerUnitLimit(room, player),
    );
  }
  function assemblyView(room, recipient) {
    return {
      players: room.seats
        .filter(
          (player) =>
            player &&
            (recipient?.seat === null ||
              (recipient?.seat !== undefined &&
                G.seatTeam(recipient.seat) === G.seatTeam(player.seat))),
        )
        .map((player) => ({
          memberId: player.id,
          seat: player.seat,
          name: player.name,
          bot: !!player.bot,
          ready: !!player.finalReady,
          limit: playerBudget(room, player),
          unitLimit: playerUnitLimit(room, player),
          ...formationPlan(room, player),
        })),
    };
  }
  function resetFinalReady(room) {
    for (const player of members(room)) player.finalReady = !!player.bot;
  }
  function startGame(room) {
    if (
      room.started ||
      !room.seats
        .filter(Boolean)
        .every((player) => (player.bot || onlineMember(player)) && player.ready) ||
      ![0, 1].every((team) =>
        room.seats.some((player, seat) => player && G.seatTeam(seat) === team),
      )
    )
      return;
    const armies = room.seats.map((player) =>
      player ? (player.bot ? randomArmy(room, player) : player.formation) : null,
    );
    armies.forEach((army, seat) => {
      if (!room.seats[seat]) return;
      if (
        !army?.length ||
        !G.planFormation(
          army,
          playerBudget(room, room.seats[seat]),
          G.formationRestrictions(room.settings, seat),
          playerUnitLimit(room, room.seats[seat]),
        ).deployable.length
      )
        throw Error("每名玩家至少需要一台符合限制的可出击单位");
    });
    room.seats.forEach((player, seat) => {
      if (player?.bot) player.formation = armies[seat];
    });
    room.started = true;
    room.phase = "assembly";
    room.matchId = randomId();
    room.returnAt = null;
    room.returnCountdown = null;
    resetFinalReady(room);
    // 上一局日志保留到新一局正式进入最终编组。
    room.log = [];
    room.logNames = [];
    log(room, "进入最终编组，确认队友配置后准备出击。");
  }
  function startDeployment(room) {
    if (
      room.phase !== "assembly" ||
      !connected(room).every(Boolean) ||
      !room.seats.every((player) => !player || player.finalReady)
    )
      return;
    const plans = room.seats.map((player) => (player ? formationPlan(room, player) : null));
    if (plans.some((plan) => plan && !plan.deployable.length)) return;
    if (
      ![0, 1].every((team) =>
        room.seats.some((player, seat) => player && G.seatTeam(seat) === team),
      )
    )
      throw Error("两支队伍都至少需要一名玩家或 AI");
    room.activeSeats = room.seats.map(Boolean);
    room.game = G.create(
      false,
      room.game.seed,
      plans.map((plan) => plan?.deployable ?? null),
      true,
      {
        ...room.settings,
        seatCostLimits: room.seats.map((player) => playerBudget(room, player)),
        seatUnitLimits: room.seats.map((player) => playerUnitLimit(room, player)),
        performances: room.seats.map((player) =>
          player?.bot ? G.aiPerformance[player.aiSettings.difficulty] : 1,
        ),
        formationIndices: plans.map((plan) => plan?.indices ?? []),
      },
    );
    room.phase = "deployment";
    planner.reset(room);
    room.turnDone = Array(room.seats.length).fill(false);
    for (const player of room.seats)
      if (player?.bot && G.confirmDeployment(room.game, player.seat)) room.phase = "idle";
    log(room, "最终编组已确认，请在各自出生区部署并确认。");
  }
  function finishBattle(room) {
    room.phase = room.game.winner === null ? "idle" : "finished";
    room.battle = null;
    room.revision++;
    room.lastEvent = { id: randomId(), type: "battle_end" };
  }
  function nextAIAction(room) {
    if (!room.started || !connected(room).every(Boolean)) return null;
    if (room.phase === "battle")
      return room.battle.ready.every(Boolean) ? { finishBattle: true } : null;
    if (room.game.winner !== null) return null;
    if (room.phase === "reaction") {
      const pending = botReaction(room);
      if (!pending) return null;
      const target = unit(room, pending.target);
      const player = room.seats[G.ownerOf(target)];
      if (!player?.bot) return null;
      const attacker = unit(room, pending.attacker);
      const weapon = G.modelOf(attacker).weapons.find((w) => w.id === pending.weapon);
      let response = G.bestResponse(room.game, attacker, target, weapon),
        counterTargetId = attacker.id;
      const candidates = (pending.counterTargets || [])
        .flatMap((entry) => {
          const enemy = unit(room, entry.attacker),
            incoming = G.modelOf(enemy).weapons.find((w) => w.id === entry.weapon);
          const choice = G.bestResponse(room.game, enemy, target, incoming);
          if (choice.response !== "counter" || !entry.options.includes(choice.weapon)) return [];
          const counter = G.modelOf(target).weapons.find((w) => w.id === choice.weapon),
            estimate = G.estimate(room.game, target, enemy, counter, "counter", true);
          return [{ choice, targetId: enemy.id, score: estimate.damage * estimate.hit }];
        })
        .sort((a, b) => b.score - a.score);
      if (candidates.length) {
        response = candidates[0].choice;
        counterTargetId = candidates[0].targetId;
      } else if (response.response === "counter") response = { response: "defend" };
      return {
        player,
        action: "respond",
        fields: {
          reactionId: pending.id,
          response: response.response,
          counterId: response.weapon,
          counterTargetId,
        },
      };
    }
    if (room.phase !== "idle") return null;
    const player = room.seats.find(
      (p) =>
        p?.bot &&
        G.seatTeam(p.seat) === room.game.team &&
        !room.turnDone[p.seat] &&
        room.game.units.some((u) => G.ownerOf(u) === p.seat && u.hp > 0 && !u.acted),
    );
    if (!player) {
      const unfinished = room.seats.find(
        (player) =>
          player?.bot && G.seatTeam(player.seat) === room.game.team && !room.turnDone[player.seat],
      );
      return unfinished ? { player: unfinished, action: "end_turn", fields: {} } : null;
    }
    const u = room.game.units.find((u) => G.ownerOf(u) === player.seat && u.hp > 0 && !u.acted);
    for (const skill of G.unitSkills(u).filter((s) => s.type === "overdrive")) {
      if (
        room.game.units.some(
          (enemy) => enemy.team !== u.team && enemy.hp > 0 && G.dist(u, enemy) <= 6,
        ) &&
        G.canUseSkill(room.game, u, skill.id)
      )
        return {
          player,
          action: "skill",
          fields: { unitId: u.id, skillId: skill.id, x: u.x, y: u.y },
        };
    }
    for (const skill of G.unitSkills(u).filter((s) => ["repair", "recon"].includes(s.type))) {
      const targets = G.skillTargets(room.game, u, skill.id).sort((a, b) => {
        const left = G.at(room.game, a.x, a.y),
          right = G.at(room.game, b.x, b.y);
        return left.hp / G.modelOf(left).hp - right.hp / G.modelOf(right).hp;
      });
      if (targets.length)
        return {
          player,
          action: "skill",
          fields: { unitId: u.id, skillId: skill.id, ...targets[0] },
        };
    }
    if (u.hp < G.modelOf(u).hp * 0.25 && !u.plan) {
      for (const skill of G.unitSkills(u).filter((s) =>
        ["escape", "armor_purge"].includes(s.type),
      )) {
        const enemies = room.game.units.filter((e) => e.hp > 0 && e.team !== u.team);
        const targets = G.skillTargets(room.game, u, skill.id);
        targets.sort(
          (a, b) =>
            Math.min(...enemies.map((e) => G.dist(b, e))) -
            Math.min(...enemies.map((e) => G.dist(a, e))),
        );
        if (targets.length)
          return {
            player,
            action: "skill",
            fields: { unitId: u.id, skillId: skill.id, ...targets[0] },
          };
      }
    }
    const choice = G.aiChoice(room.game, u);
    if (choice?.rotation)
      return { player, action: "rotate", fields: { unitId: u.id, direction: choice.rotation } };
    if (choice && !u.moved && (choice.x !== u.x || choice.y !== u.y))
      return { player, action: "move", fields: { unitId: u.id, x: choice.x, y: choice.y } };
    let best = null;
    for (const target of room.game.units.filter((t) => t.hp > 0 && t.team !== u.team))
      for (const weapon of G.modelOf(u).weapons)
        if (G.canAttack(room.game, u, target, weapon)) {
          const estimate = G.estimate(room.game, u, target, weapon);
          const score = estimate.hit * estimate.damage;
          if (!best || score > best.score) best = { target, weapon, score };
        }
    if (!best) return { player, action: "wait", fields: { unitId: u.id } };
    const weapons = [best.weapon];
    if (best.weapon.slot !== "skill") {
      const candidates = G.modelOf(u).weapons.filter(
        (w) => w.slot !== "skill" && G.canAttack(room.game, u, best.target, w),
      );
      candidates.sort((a, b) => {
        const x = G.estimate(room.game, u, best.target, a),
          y = G.estimate(room.game, u, best.target, b);
        return y.damage * y.hit - x.damage * x.hit;
      });
      while (weapons.length < 32) {
        const next = candidates.find((w) => {
          try {
            G.attackQueue(room.game, u, best.target, [...weapons, w]);
            return true;
          } catch {
            return false;
          }
        });
        if (!next) break;
        weapons.push(next);
      }
    }

    return {
      player,
      action: "attack",
      fields: {
        unitId: u.id,
        targetId: best.target.id,
        weaponId: best.weapon.id,
        weaponIds: weapons.map((w) => w.id),
      },
    };
  }
  function scheduleAI(room) {
    clearTimeout(aiTimers.get(room));
    aiTimers.delete(room);
    // Delay expensive pathfinding until the timer fires; chat/sync never drives AI.
    if (
      !room.started ||
      room.returnCountdown ||
      !connected(room).every(Boolean) ||
      !["idle", "reaction", "battle"].includes(room.phase)
    )
      return;
    if (room.phase === "battle" && !room.battle.ready.every(Boolean)) return;
    if (room.phase === "reaction" && !botReaction(room)) return;
    if (
      room.phase === "idle" &&
      !room.seats.some(
        (p) => p?.bot && G.seatTeam(p.seat) === room.game.team && !room.turnDone[p.seat],
      )
    )
      return;
    const revision = room.revision;
    const movementDelay = room.lastEvent?.type === "move" ? room.lastEvent.path.length * 120 : 0;
    const delay =
      room.phase === "battle"
        ? aiBattleMs
        : Math.max(aiDelayMs, movementDelay, (room.turnNotBefore || 0) - Date.now());
    const timer = setTimeout(() => {
      aiTimers.delete(room);
      if (rooms.get(room.code) !== room || room.revision !== revision) return;
      const intent = nextAIAction(room);
      if (!intent) return;
      if (intent.finishBattle) {
        finishBattle(room);
        broadcast(room);
        return;
      }
      action(intent.player.ws, {
        id: randomId(),
        revision: room.revision,
        round: room.game.round,
        reactionId: room.pending?.id,
        action: intent.action,
        ...intent.fields,
      });
    }, delay);
    timer.unref?.();
    aiTimers.set(room, timer);
  }
  // 使用玩家显示 ID 而非席位编号，避免多人同型号机体的日志混淆。
  function unitLabel(room, unit) {
    if (unit.customName && !room.logNames?.includes(unit.customName))
      (room.logNames ||= []).push(unit.customName);
    const player = room.seats[G.ownerOf(unit)];
    return `[${unit.team ? "红方" : "蓝方"}][${player?.name || "空席位"}]${G.unitName(unit)}`;
  }
  function log(room, text) {
    room.log.unshift(text);
  }
  const unit = (room, id) => room.game.units.find((u) => u.id === id);
  function ownUnit(room, seat, id) {
    let u = unit(room, id);
    if (!u || G.ownerOf(u) !== seat || u.hp <= 0) throw Error("不能操作该单位");
    return u;
  }
  function validateActive(room, seat) {
    if (!room.started || !connected(room).every(Boolean)) throw Error("等待双方玩家连接后继续");
    if (room.game.winner !== null) throw Error("战斗已经结束");
    if (room.game.team !== G.seatTeam(seat) || room.turnDone[seat]) throw Error("当前不是你的回合");
    if (room.phase !== "idle") throw Error("请先完成当前交战");
  }
  // 权限、请求去重和 revision 校验通过后，才调用共用规则。
  function action(ws, msg) {
    let room = rooms.get(ws.room),
      seat = ws.seat;
    const member = room?.members.get(ws.memberId);
    if (!member || member.ws !== ws) throw Error("请先加入房间");
    let id = msg.id;
    if (typeof id !== "string" || id.length < 4 || id.length > 100) throw Error("请求编号无效");
    const cache = member.requests;
    if (cache.has(id)) {
      const cached = cache.get(id);
      if (cached?.type === "chat") {
        if (!chatChannels.canRead(member.seat, cached.message.channel || "all"))
          throw Error("你目前不能查看该聊天频道。");
        send(ws, { type: "chat", message: cached.message, ack: id });
      } else send(ws, state(room, id, member));
      return;
    }
    if (room.returnCountdown && !["sync", "chat", "return_room"].includes(msg.action))
      throw Error("正在返回房间，请稍候。");
    if (msg.action === "playback_ready") {
      const playback = room.playback;
      if (
        room.phase !== "playback" ||
        !playback ||
        playback.id !== msg.batchId ||
        msg.matchId !== room.matchId ||
        !Number.isSafeInteger(msg.revision) ||
        msg.revision > room.revision
      )
        throw Error("演出批次已过期");
      if (!playback.members.includes(member.id)) throw Error("你不在本批演出等待名单中");
      if (playback.ready.includes(member.id)) {
        cache.set(id, true);
        send(ws, state(room, id, member));
        return;
      }
      playback.ready.push(member.id);
      cache.set(id, true);
      room.revision++;
      broadcast(room, id);
      return;
    }
    if (msg.action === "sync") {
      send(ws, state(room, id, member));
      return;
    }
    if (msg.action === "chat") {
      const channel = msg.channel === undefined ? "all" : msg.channel;
      if (!chatChannels.ids.includes(channel)) throw Error("聊天频道无效。");
      if (!chatChannels.canSend(member.seat, channel)) throw Error("你不能向该聊天频道发送消息。");
      if (typeof msg.message !== "string") throw Error("聊天内容无效。");
      const text = msg.message.trim().replace(/[\u0000-\u001f\u007f]/g, " ");
      if (!text || Array.from(text).length > 300) throw Error("聊天内容需为1到300个字符。");
      if (member.chatAt && Date.now() - member.chatAt < 500) throw Error("发送过于频繁，请稍候。");
      member.chatAt = Date.now();
      const message = {
        id: randomId(),
        memberId: member.id,
        name: member.name,
        text,
        channel,
        at: Date.now(),
      };
      room.chat.push(message);
      room.chat = room.chat.slice(-100);
      cache.set(id, { type: "chat", message });
      if (cache.size > 512) cache.delete(cache.keys().next().value);
      for (const player of members(room))
        if (chatChannels.canRead(player.seat, channel))
          send(player.ws, { type: "chat", message, ack: id });
      return;
    }
    if (msg.action === "return_room") {
      if (!room.started) throw Error("当前没有正在进行的对局。");
      if (room.hostId !== member.id) throw Error("只有房主可以让所有人返回房间。");
      if (msg.matchId !== room.matchId) throw Error("对局已更新，请重新同步。");
      cache.set(id, true);
      if (cache.size > 512) cache.delete(cache.keys().next().value);
      if (room.returnCountdown) {
        send(ws, state(room, id, member));
        return;
      }
      clearTimeout(resultTimers.get(room));
      resultTimers.delete(room);
      room.returnCountdown = {
        id: randomId(),
        at: Date.now() + roomReturnMs,
        requestedBy: member.id,
      };
      const countdownId = room.returnCountdown.id;
      const timer = setTimeout(() => {
        returnTimers.delete(room);
        if (room.returnCountdown?.id === countdownId) returnToRoom(room);
      }, roomReturnMs);
      timer.unref?.();
      returnTimers.set(room, timer);
      room.revision++;
      room.lastEvent = { id: randomId(), type: "return_room_countdown", matchId: room.matchId };
      broadcast(room, id);
      return;
    }
    // 准备和席位操作同样有请求 ID、版本校验和去重，观战者只能使用这些房间操作。
    if (
      [
        "configure_room",
        "move_player",
        "kick_player",
        "switch_seat",
        "join_team",
        "set_ready",
        "start_game",
        "add_ai",
        "remove_ai",
        "configure_ai",
        "update_formation",
        "confirm_formation",
      ].includes(msg.action)
    ) {
      if (!Number.isSafeInteger(msg.revision) || msg.revision !== room.revision) {
        send(ws, { type: "error", id, code: "STALE", message: "房间状态已更新，请重试。" });
        send(ws, state(room, undefined, member));
        return;
      }
      if (msg.action === "start_game") {
        if (member.id !== room.hostId) throw Error("只有房主可以开始游戏");
        if (room.started) throw Error("游戏已经开始");
        const players = room.seats.filter(Boolean);
        if (!players.every((player) => player.bot || onlineMember(player)))
          throw Error("等待出战玩家重新连接");
        if (![0, 1].every((team) => players.some((player) => G.seatTeam(player.seat) === team)))
          throw Error("两支队伍都至少需要一名玩家或 AI");
        if (players.some((player) => player !== member && !player.ready))
          throw Error("等待其他出战玩家准备");
        const oldFormation = member.formation,
          oldReady = member.ready;
        try {
          if (member.seat !== null) {
            member.formation = G.validateFormation(
              msg.formation ?? member.formation,
              Infinity,
              room.settings.unitLimit,
            );
            member.ready = true;
          }
          startGame(room);
        } catch (error) {
          member.formation = oldFormation;
          member.ready = oldReady;
          throw error;
        }
      } else if (msg.action === "update_formation" || msg.action === "confirm_formation") {
        if (room.phase !== "assembly" && (room.started || msg.action !== "update_formation"))
          throw Error("当前不是最终编组阶段");
        if (member.seat === null) {
          if (
            msg.action !== "confirm_formation" ||
            member.id !== room.hostId ||
            !room.seats.filter(Boolean).every((player) => player.bot)
          )
            throw Error("观战玩家不能确认编组");
          startDeployment(room);
          room.revision++;
          cache.set(id, true);
          broadcast(room, id);
          return;
        }
        const formation =
          msg.formation === undefined
            ? member.formation
            : G.validateFormation(msg.formation, Infinity, room.settings.unitLimit);
        const plan = G.planFormation(
          formation,
          playerBudget(room, member),
          G.formationRestrictions(room.settings, member.seat),
        );
        if (msg.action === "confirm_formation" && !plan.deployable.length)
          throw Error("至少需要一台可出击单位");
        member.formation = formation;
        // 保存编组保留自己和队友的准备/确认状态。
        if (msg.action === "confirm_formation") member.finalReady = true;
        if (room.phase === "assembly") startDeployment(room);
      } else if (msg.action === "configure_ai") {
        if (room.hostId !== member.id) throw Error("只有房主可以设置 AI");
        if (room.started) throw Error("对局开始后不能修改 AI");
        const bot = room.seats[msg.seat];
        if (!Number.isInteger(msg.seat) || !bot?.bot) throw Error("该席位不是 AI");
        const config = G.validateAISettings(msg.config);
        let preset = bot.formationPreset || null;
        if (Object.hasOwn(msg, "formationPreset")) {
          const value = msg.formationPreset;
          if (value === null) preset = null;
          else {
            if (
              !value ||
              typeof value !== "object" ||
              typeof value.name !== "string" ||
              !value.name.trim() ||
              value.name.length > 80
            )
              throw Error("AI 编组预设无效");
            preset = { name: value.name.trim(), units: G.validateFormation(value.units, Infinity) };
          }
        }
        checkAIArmy(room, { ...bot, aiSettings: config, formationPreset: preset });
        bot.aiSettings = config;
        bot.formationPreset = preset;
        bot.formation = null;
      } else if (msg.action === "add_ai" || msg.action === "remove_ai") {
        if (room.hostId !== member.id) throw Error("只有房主可以添加或移除 AI");
        if (room.started) throw Error("对局开始后不能添加或移除 AI");
        const destination = msg.seat;
        if (!Number.isInteger(destination) || destination < 0 || destination >= room.seats.length)
          throw Error("无效的席位");
        if (msg.action === "add_ai") {
          if (room.seats[destination]) throw Error("只能在空位添加 AI");
          if (room.members.size >= 32) throw Error("房间人数已满");
          const botId = randomId();
          const bot = {
            id: botId,
            name: "AI " + (destination + 1),
            bot: true,
            aiSettings: G.validateAISettings(),
            seat: destination,
            ready: true,
            requests: new Map(),
            ws: { room: room.code, memberId: botId, seat: destination },
          };
          checkAIArmy(room, bot);
          for (const existing of room.seats.filter((player) => player?.bot))
            checkAIArmy(room, existing);
          room.members.set(bot.id, bot);
          room.seats[destination] = bot;
        } else {
          const bot = room.seats[destination];
          if (!bot?.bot) throw Error("该席位不是 AI");
          room.members.delete(bot.id);
          room.seats[destination] = null;
        }
      } else if (msg.action === "configure_room") {
        if (room.hostId !== member.id) throw Error("只有房主可以修改房间设置");
        if (room.started) throw Error("对局开始后不能修改地图和 COST");
        const map = G.getMap(msg.mapId);
        const settings = {
          mapId: map.id,
          costLimit: G.validateCostLimit(msg.costLimit),
          unitLimit: G.validateUnitLimit(msg.unitLimit ?? room.settings.unitLimit),
          unitCostLimit: G.validateUnitCostLimit(msg.unitCostLimit ?? room.settings.unitCostLimit),
          ...G.validateTagRestrictions({
            bannedFactions: msg.bannedFactions ?? room.settings.bannedFactions,
            bannedEras: msg.bannedEras ?? room.settings.bannedEras,
          }),
          teamRestrictions: G.validateTeamRestrictions(
            msg.teamRestrictions ?? room.settings.teamRestrictions,
          ),
        };
        if (JSON.stringify(settings) !== JSON.stringify(room.settings)) {
          const mapChanged = settings.mapId !== room.settings.mapId;
          room.settings = settings;
          for (const player of members(room)) {
            if (player.seat !== null && player.seat >= map.spawns.length) {
              if (player.bot) {
                room.members.delete(player.id);
                continue;
              }
              player.seat = null;
              if (player.ws) player.ws.seat = null;
            }
          }
          room.seats = Array(map.spawns.length).fill(null);
          for (const player of members(room))
            if (player.seat !== null) room.seats[player.seat] = player;
          room.turnDone = Array(map.spawns.length).fill(false);
          if (mapChanged) resetReady(room);
        }
      } else if (msg.action === "kick_player") {
        if (room.hostId !== member.id) throw Error("只有房主可以踢出玩家");
        const target = room.members.get(msg.memberId);
        if (!target || target.id === member.id || target.bot) throw Error("无效的玩家");
        if (target.seat !== null) {
          room.seats[target.seat] = null;
          if (room.battle) room.battle.ready[target.seat] = false;
        }
        room.members.delete(target.id);
        if (target.ws) {
          const targetSocket = target.ws;
          delete targetSocket.room;
          delete targetSocket.memberId;
          delete targetSocket.seat;
          send(targetSocket, { type: "room_closed", message: "你已被房主移出房间。" });
          targetSocket.close(1000, "Removed by host");
        }
      } else if (
        msg.action === "switch_seat" ||
        msg.action === "join_team" ||
        msg.action === "move_player"
      ) {
        let movingMember = member;
        if (msg.action === "move_player") {
          if (room.hostId !== member.id) throw Error("只有房主可以调整玩家席位");
          if (room.started) throw Error("对局开始后不能调整其他玩家席位");
          movingMember = room.members.get(msg.memberId);
          if (!movingMember || movingMember.bot) throw Error("无效的玩家");
        }
        let destination = msg.seat;
        if (msg.action === "join_team") {
          if (msg.team !== 0 && msg.team !== 1) throw Error("无效的队伍。");
          destination =
            movingMember.seat !== null && G.seatTeam(movingMember.seat) === msg.team
              ? movingMember.seat
              : room.seats.findIndex((player, seat) => !player && G.seatTeam(seat) === msg.team);
          if (destination < 0) throw Error("队伍已满，请选择其他队伍或观战席。");
        }
        if (
          destination !== null &&
          (!Number.isInteger(destination) || destination < 0 || destination >= room.seats.length)
        )
          throw Error("无效的席位");
        if (
          destination !== null &&
          room.seats[destination] &&
          room.seats[destination] !== movingMember
        )
          throw Error("这个队伍已有玩家");
        if (movingMember.seat !== destination) {
          if (movingMember.seat !== null) {
            room.seats[movingMember.seat] = null;
            if (room.battle) room.battle.ready[movingMember.seat] = false;
          }
          movingMember.seat = destination;
          if (movingMember.ws) movingMember.ws.seat = destination;
          if (destination !== null) {
            room.seats[destination] = movingMember;
            if (room.battle) room.battle.ready[destination] = false;
          }
          if (room.phase === "assembly") {
            if (destination !== null && !movingMember.formation)
              movingMember.formation = G.randomFormation(
                7319,
                room.settings.costLimit,
                G.formationRestrictions(room.settings, destination),
                room.settings.unitLimit,
              );
          }
        }
      } else {
        if (room.started) throw Error("游戏已经开始");
        if (member.seat === null) throw Error("观战玩家无需准备");
        if (typeof msg.ready !== "boolean") throw Error("准备状态无效");
        const oldFormation = member.formation,
          oldReady = member.ready;
        try {
          if (msg.ready) {
            const formation = G.validateFormation(msg.formation, Infinity, room.settings.unitLimit);
            if (
              !G.planFormation(
                formation,
                playerBudget(room, member),
                G.formationRestrictions(room.settings, member.seat),
              ).deployable.length
            )
              throw Error("至少需要一台符合限制的可出击单位");
            for (const bot of room.seats.filter((player) => player?.bot)) checkAIArmy(room, bot);
            member.formation = formation;
          }
          member.ready = msg.ready;
        } catch (error) {
          member.formation = oldFormation;
          member.ready = oldReady;
          throw error;
        }
      }
      room.revision++;
      cache.set(id, true);
      if (cache.size > 512) cache.delete(cache.keys().next().value);
      broadcast(room, id);
      return;
    }
    if (seat === null) throw Error("观战玩家不能操作战局");
    if (!room.started || !connected(room).every(Boolean)) throw Error("对手已断线，等待重连后继续");
    if (msg.action === "battle_ready") {
      if (!room.combats.some((battle) => battle.id === msg.battleId)) throw Error("交战编号无效");
      cache.set(id, true);
      send(ws, state(room, id, member));
      return;
    }
    const concurrentPlan =
      room.phase === "idle" &&
      msg.round === room.game.round &&
      msg.matchId === room.matchId &&
      ["move", "rotate", "skill", "undo", "wait", "attack", "cancel_attack", "end_turn"].includes(
        msg.action,
      );
    const currentResponse =
      msg.action === "respond" &&
      !!reactionForSeat(room, seat) &&
      msg.reactionId === reactionForSeat(room, seat).id;
    if (
      !Number.isSafeInteger(msg.revision) ||
      msg.revision > room.revision ||
      (msg.revision !== room.revision && !concurrentPlan && !currentResponse)
    ) {
      send(ws, {
        type: "error",
        id,
        code: "STALE",
        message: "战局已更新，已重新同步，请重试。",
      });
      send(ws, state(room, undefined, member));
      return;
    }
    let event;
    switch (msg.action) {
      case "deploy": {
        if (room.phase !== "deployment") throw Error("Not deploying");
        G.deploy(room.game, seat, msg.unitId, msg.x, msg.y);
        log(
          room,
          `${unitLabel(room, unit(room, msg.unitId))} 部署至${G.columnLabel(msg.x)}${msg.y + 1}。`,
        );
        break;
      }
      case "confirm_deployment": {
        if (room.phase !== "deployment") throw Error("Not deploying");
        if (G.confirmDeployment(room.game, seat)) room.phase = "idle";
        break;
      }
      case "rotate": {
        if (room.phase === "deployment") {
          const u = ownUnit(room, seat, msg.unitId);
          G.rotate(room.game, u, msg.direction);
          event = { type: "rotate", unitId: u.id };
        } else {
          validateActive(room, seat);
          const u = ownUnit(room, seat, msg.unitId);
          G.rotate(room.game, u, msg.direction);
          event = { type: "rotate", unitId: u.id };
          log(room, `${unitLabel(room, u)} ${msg.direction < 0 ? "左转" : "右转"}。`);
        }
        break;
      }
      case "skill": {
        validateActive(room, seat);
        const u = ownUnit(room, seat, msg.unitId),
          label = unitLabel(room, u);
        const skill = G.unitSkills(u).find((s) => s.id === msg.skillId);
        event = G.useSkill(room.game, u, msg.skillId, msg.x, msg.y);
        const result = unit(room, event.resultId);
        log(
          room,
          `${label} 使用${skill.name} → ${G.modelOf(result).name}，位于${G.columnLabel(result.x)}${result.y + 1}。`,
        );
        break;
      }
      case "move": {
        validateActive(room, seat);
        let u = ownUnit(room, seat, msg.unitId);
        if (!Number.isInteger(msg.x) || !Number.isInteger(msg.y)) throw Error("目标格无效");
        let from = { x: u.x, y: u.y },
          steps = G.move(room.game, u, msg.x, msg.y);
        event = { type: "move", unitId: u.id, from, path: steps };
        log(room, `${unitLabel(room, u)} 移动至${G.columnLabel(u.x)}${u.y + 1}。`);
        break;
      }
      case "undo": {
        validateActive(room, seat);
        let u = ownUnit(room, seat, msg.unitId);
        if (u.acted || !u.origin) throw Error("无法撤销移动");
        G.undo(room.game, u);
        event = { type: "undo", unitId: u.id };
        log(room, `${unitLabel(room, u)} 撤销移动。`);
        break;
      }
      case "wait": {
        validateActive(room, seat);
        let u = ownUnit(room, seat, msg.unitId);
        if (u.plan) planner.cancel(room, u);
        G.wait(room.game, u);
        event = { type: "wait", unitId: u.id };
        log(room, `${unitLabel(room, u)} 待机。`);
        break;
      }
      case "end_turn": {
        validateActive(room, seat);
        room.turnDone[seat] = true;
        for (const u of room.game.units)
          if (G.ownerOf(u) === seat && u.hp > 0 && !u.acted) G.wait(room.game, u);
        const teammates = room.seats.filter(
          (player) =>
            player &&
            G.seatTeam(player.seat) === room.game.team &&
            room.game.units.some((u) => G.ownerOf(u) === player.seat && u.hp > 0),
        );
        event = teammates.every((player) => room.turnDone[player.seat])
          ? resolvePlans(room)
          : { type: "player_end", seat };
        break;
      }
      case "attack": {
        validateActive(room, seat);
        const a = ownUnit(room, seat, msg.unitId),
          b = unit(room, msg.targetId),
          ids = msg.weaponIds ?? [msg.weaponId],
          weapons = Array.isArray(ids)
            ? ids.map((id) => G.modelOf(a).weapons.find((w) => w.id === id))
            : [],
          w = weapons[0];
        if (!w || !b) throw Error("武器或目标无效");
        const plan = planner.plan(room, a, b, weapons, seat);
        event = { type: "plan_attack", ...plan };
        log(
          room,
          `${unitLabel(room, a)} 计划使用${weapons.map((w) => w.name).join(" → ")}攻击${unitLabel(room, b)}，等待本队结束规划。`,
        );
        break;
      }
      case "cancel_attack": {
        validateActive(room, seat);
        const attacker = ownUnit(room, seat, msg.unitId);
        planner.cancel(room, attacker);
        event = { type: "cancel_plan", unitId: attacker.id };
        log(room, `${unitLabel(room, attacker)} 取消攻击计划。`);
        break;
      }
      case "respond": {
        const pending = reactionForSeat(room, seat);
        if (room.phase !== "reaction" || !pending) throw Error("当前没有待应战的攻击");
        if (msg.reactionId !== pending.id) throw Error("应战请求已过期，请处理当前交战");
        const b = unit(room, pending.target);
        if (G.ownerOf(b) !== seat) throw Error("只有被攻击方能选择应战");
        planner.choose(
          room,
          msg.reactionId,
          msg.response,
          msg.counterId,
          msg.counterTargetId ?? pending.attacker,
        );
        const decision =
          msg.response === "counter" ? "反击" : msg.response === "defend" ? "防御" : "回避";
        log(room, `${unitLabel(room, b)} 选择${decision}。`);
        event = resolvePlans(room);
        break;
      }
      default:
        throw Error("不支持的操作");
    }
    room.revision++;
    room.lastEvent = { id: randomId(), ...event };
    cache.set(id, true);
    if (cache.size > 512) cache.delete(cache.keys().next().value);
    broadcast(room, id);
  }
  function join(ws, msg) {
    if (ws.room) throw Error("当前连接已经加入房间");
    let code = String(msg.room || "")
      .trim()
      .toUpperCase();
    if (!/^[A-Z0-9_-]{3,20}$/.test(code))
      throw Error("房间码需为3–20位英文字母、数字、下划线或短横线");
    if (!["create", "join", "resume"].includes(msg.mode)) throw Error("无效的加入方式");
    let displayName;
    if (msg.mode !== "resume" && msg.name !== undefined) {
      if (typeof msg.name !== "string") throw Error("玩家ID无效。");
      displayName = msg.name.trim().replace(/[\u0000-\u001f\u007f]/g, "");
      if (!displayName || Array.from(displayName).length > 24)
        throw Error("玩家ID需为1到24个字符。");
    }
    let room = rooms.get(code),
      seat = -1;
    if (msg.mode === "create") {
      if (room) throw Error("房间已存在，请使用加入房间或换一个房间码");
      if (rooms.size >= 64) throw Error("房间数量已满");
      room = {
        code,
        game: G.create(false, randomSeed()),
        phase: "waiting",
        revision: 0,
        seats: [null, null],
        settings: G.defaultRoomSettings(),
        turnDone: [false, false],
        members: new Map(),
        nextPlayerNumber: 1,
        hostId: null,
        matchId: null,
        returnAt: null,
        chat: [],
        pending: null,
        battle: null,
        started: false,
        plans: [],
        combats: [],
        log: ["房间已创建，两队准备后开始。"],
        lastEvent: null,
        updated: Date.now(),
      };
      rooms.set(code, room);
      seat = 0;
    } else {
      if (!room) throw Error("房间不存在，请确认IP和房间码；服务端重启后需重新创建");
      seat =
        room.started && room.phase !== "assembly"
          ? null
          : room.seats.findIndex((player) => !player);
      if (seat === -1) seat = null;
    }
    let member;
    if (msg.mode === "resume") {
      if (typeof msg.token !== "string") throw Error("缺少重连凭据");
      member = members(room).find((player) => player.token === msg.token);
      if (!member) throw Error("重连凭据无效，请重新加入房间");
      seat = member.seat;
    } else {
      if (room.members.size >= 32) throw Error("房间人数已满");
      member = {
        id: randomId(),
        name: displayName || "玩家" + room.nextPlayerNumber++,
        seat,
        ready: false,
        finalReady: false,
        formation: G.randomFormation(
          randomSeed(),
          room.settings.costLimit,
          G.formationRestrictions(room.settings, seat),
          room.settings.unitLimit,
        ),
        token: randomToken(),
        ws: null,
        requests: new Map(),
      };
      room.members.set(member.id, member);
      if (!room.hostId) room.hostId = member.id;
      if (seat !== null) {
        room.seats[seat] = member;
      }
    }
    let old = member.ws;
    member.ws = ws;
    ws.room = code;
    ws.seat = seat;
    ws.memberId = member.id;
    if (old && old !== ws) {
      send(old, { type: "replaced", message: "此席位已在另一个连接恢复" });
      old.close(4001, "Session resumed elsewhere");
    }
    room.revision++;
    send(ws, {
      type: "joined",
      protocol: 1,
      room: code,
      seat,
      memberId: member.id,
      token: member.token,
    });
    broadcast(room);
  }

  function disconnect(ws) {
    let room = rooms.get(ws.room);
    const member = room?.members.get(ws.memberId);
    if (member?.ws === ws) {
      member.ws = null;
      room.revision++;
      broadcast(room);
    }
  }
  function close() {
    for (const timer of returnTimers.values()) clearTimeout(timer);
    returnTimers.clear();
    for (const timer of resultTimers.values()) clearTimeout(timer);
    for (const timer of aiTimers.values()) clearTimeout(timer);
    for (const entry of autoEndTimers.values()) clearTimeout(entry.timer);
    for (const entry of hostTimers.values()) clearTimeout(entry.timer);
    hostTimers.clear();
    resultTimers.clear();
    aiTimers.clear();
    autoEndTimers.clear();
    rooms.clear();
  }
  return {
    rooms,
    join,
    action,
    leaveRoom,
    disconnect,
    broadcast,
    broadcastRooms,
    roomList,
    destroyRoom,
    members,
    onlineMember,
    close,
  };
}
if (typeof module !== "undefined") module.exports = { createRoomEngine };
