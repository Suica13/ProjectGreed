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
  hostReconnectMs = 60000,
  reconnectGraceMs = 60000,
}) {
  const Records =
    typeof MatchRecords === "undefined" ? require("./match-records.js") : MatchRecords;
  function captureRecord(room) {
    const chatOnly = ["move_preview", "move_cancel"].includes(room.lastEvent?.type);
    if (chatOnly && room.recordChat === room.chat.at(-1)?.id) return;
    if (
      !room.started ||
      ["assembly", "waiting", "deployment", "replay"].includes(room.phase) ||
      room.replay
    )
      return;
    if (!room.record || room.record.id !== room.matchId) {
      room.record = Records.create(G, room.matchId, room.settings, room.game.tiles);
      room.recordPrevious = {};
      room.recordBytes = 0;
      room.recordEvent = null;
      room.recordTurn = null;
      room.saveTurn = null;
      room.recordChat = null;
      room.recordSourceEvent = null;
    }
    const saveTurn = room.game.round + ":" + room.game.team;
    if (
      room.phase === "idle" &&
      room.game.winner === null &&
      room.saveTurn !== saveTurn &&
      !room.plans?.length &&
      !chatOnly
    ) {
      room.turnSave = Records.createSave(G, room);
      room.saveTurn = saveTurn;
    }
    const sourceEvent = room.lastEvent?.id + ":" + room.phase;
    const chatFrame = chatOnly || room.recordSourceEvent === sourceEvent;
    const key = sourceEvent + ":" + (room.chat.at(-1)?.id || "");
    if (room.recordEvent === key || room.record.truncated) return;
    const turn = room.game.round + ":" + room.game.team;
    const turnStart =
      room.phase === "idle" &&
      room.game.winner === null &&
      room.recordTurn !== turn &&
      !room.plans?.length;
    const frame = {
      at: Date.now(),
      round: room.game.round,
      team: room.game.team,
      turnStart,
      views: {},
    };
    const next = {};
    for (const perspective of room.record.perspectives) {
      const team = perspective === "global" ? null : Number(perspective.slice(5));
      const snapshot =
        chatFrame && room.recordPrevious[perspective]
          ? Records.clone(room.recordPrevious[perspective])
          : Records.publicView(state(room, undefined, { seat: null, viewTeam: team }));
      snapshot.chat = room.chat.filter((message) =>
        chatChannels.canRead(team, message.channel || "all"),
      );
      if (chatFrame) {
        // A chat frame must not replay the previous volley, move or turn cut-in.
        snapshot.lastEvent = { id: room.chat.at(-1)?.id, type: "chat" };
        snapshot.effectEvent = null;
        snapshot.combats = [];
        snapshot.effectCombats = [];
        snapshot.combatActors = [];
      }
      frame.views[perspective] = Records.pack(room.recordPrevious[perspective], snapshot);
      next[perspective] = Records.unpack(
        room.recordPrevious[perspective],
        frame.views[perspective],
        room.record.tiles,
      );
    }
    const checkpoint = turnStart
      ? { frame: room.record.frames.length, round: room.game.round, team: room.game.team }
      : null;
    const size =
      new TextEncoder().encode(JSON.stringify(frame)).length +
      (checkpoint ? new TextEncoder().encode(JSON.stringify(checkpoint)).length : 0);
    if (
      room.recordBytes + size > Records.maxBytes - 100000 ||
      room.record.frames.length >= Records.maxFrames
    ) {
      room.record.truncated = true;
      return;
    }
    room.record.frames.push(frame);
    room.recordBytes += size;
    room.recordPrevious = next;
    room.recordEvent = key;
    room.recordSourceEvent = sourceEvent;
    room.recordChat = room.chat.at(-1)?.id;
    if (checkpoint) {
      room.record.checkpoints.push(checkpoint);
      room.recordTurn = turn;
    }
  }
  function replaySnapshot(room, member) {
    const replay = room.replay;
    if (!replay) return null;
    const perspective = replay.record.perspectives.includes(member?.replayView)
      ? member.replayView
      : replay.record.perspectives[0];
    let cached = replay.cache.get(perspective);
    if (cached?.index !== replay.index) {
      const frame =
        cached?.index + 1 === replay.index
          ? Records.unpack(
              cached.frame,
              replay.record.frames[replay.index].views[perspective],
              replay.record.tiles,
            )
          : Records.view(replay.record, replay.index, perspective);
      cached = { index: replay.index, frame };
      replay.cache.set(perspective, cached);
    }
    return {
      id: replay.id,
      recordId: replay.record.id,
      gameVersion: replay.record.gameVersion || "unknown",
      index: replay.index,
      total: replay.record.frames.length,
      token: replay.token,
      playing: replay.playing,
      speed: replay.speed,
      perspective,
      perspectives: replay.record.perspectives,
      checkpoints: replay.record.checkpoints,
      frame: cached.frame,
      truncated: !!replay.record.truncated,
    };
  }
  function advanceReplay(room) {
    const replay = room.replay;
    if (!replay?.playing) return;
    const viewers = members(room).filter((m) => !m.bot && onlineMember(m));
    if (!viewers.length || !viewers.every((m) => replay.ready.has(m.id))) return;
    if (replay.index + 1 >= replay.record.frames.length) {
      replay.playing = false;
      return;
    }
    replay.index++;
    replay.token = randomId();
    replay.ready.clear();
    room.revision++;
  }
  function recordAction(room, member, msg) {
    if (
      !msg.action.startsWith("record_") &&
      !msg.action.startsWith("replay_") &&
      !msg.action.startsWith("save_")
    )
      return false;
    const host = room.hostId === member.id,
      read = ["replay_log", "replay_ready", "replay_view"].includes(msg.action);
    if (!read && !host) throw Error("只有房主可以控制回放或载入存档。");
    if (msg.action === "replay_fork") throw Error("回放不能接管游戏，请在房间加载存档。");
    if (msg.action === "replay_log") {
      const replay = room.replay;
      if (
        !replay ||
        msg.replayId !== replay.id ||
        !replay.record.perspectives.includes(msg.perspective)
      )
        throw Error("回放视角无效。");
      const log = Records.view(replay.record, replay.record.frames.length - 1, msg.perspective).log;
      send(member.ws, { type: "record_reply", ack: msg.id, log });
      return true;
    }
    const cached = member.requests.get(msg.id);
    if (cached?.type === "record_reply") {
      send(member.ws, cached);
      return true;
    }
    if (!Number.isSafeInteger(msg.revision) || msg.revision > room.revision)
      throw Error("回放状态已更新。");
    if (
      room.started &&
      ![
        "replay_ready",
        "replay_view",
        "record_export",
        "save_export",
        "replay_save_export",
      ].includes(msg.action)
    )
      throw Error("请先让全员返回大厅，再载入或开始回放。");
    let result = {};
    switch (msg.action) {
      case "record_export":
        if (!room.record?.frames.length) throw Error("当前没有回放记录。");
        result.record = room.record;
        break;
      case "replay_save_export": {
        const replay = room.replay;
        if (!replay || msg.replayId !== replay.id) throw Error("回放已结束。");
        result.save = Records.saveFromReplay(
          G,
          replay.record,
          msg.index,
          randomSeed(),
          randomSeed(),
        );
        break;
      }
      case "save_export":
        if (!room.turnSave) throw Error("进入对局回合后才能保存存档。");
        result.save = room.turnSave;
        break;
      case "save_load":
        if (msg.revision !== room.revision) throw Error("房间状态已更新，请重新加载存档。");
        if (!room.loadedSave) throw Error("请先选择存档文件。");
        loadSavedRoom(room, room.loadedSave);
        break;
      case "record_upload_begin":
        if (!Number.isInteger(msg.length) || msg.length < 1 || msg.length > Records.maxBytes)
          throw Error("对局记录大小无效。");
        room.recordUpload = {
          id: randomId(),
          owner: member.id,
          kind: msg.kind === "save" ? "save" : "replay",
          length: msg.length,
          text: "",
          sequence: 0,
        };
        result.uploadId = room.recordUpload.id;
        break;
      case "record_upload_chunk": {
        const upload = room.recordUpload;
        if (
          !upload ||
          upload.id !== msg.uploadId ||
          upload.owner !== member.id ||
          msg.sequence !== upload.sequence ||
          typeof msg.text !== "string" ||
          msg.text.length > 20000 ||
          upload.text.length + msg.text.length > upload.length
        )
          throw Error("记录上传分块无效。");
        upload.text += msg.text;
        upload.sequence++;
        break;
      }
      case "record_upload_finish": {
        const upload = room.recordUpload;
        if (
          !upload ||
          upload.id !== msg.uploadId ||
          upload.owner !== member.id ||
          upload.text.length !== upload.length
        )
          throw Error("记录上传尚未完成。");
        if (upload.kind === "save")
          room.loadedSave = Records.validateSave(G, JSON.parse(upload.text));
        else room.loadedRecord = Records.validate(G, JSON.parse(upload.text));
        delete room.recordUpload;
        result.loaded = true;
        break;
      }
      case "replay_open": {
        const record = msg.loaded ? room.loadedRecord : room.record;
        if (!record?.frames.length) throw Error("当前没有对局记录。");
        room.replay = {
          id: randomId(),
          record,
          index: 0,
          token: randomId(),
          playing: false,
          speed: 1,
          ready: new Set(),
          cache: new Map(),
        };
        break;
      }
      case "replay_close":
        room.replay = null;
        break;
      case "replay_control": {
        const replay = room.replay;
        if (!replay || msg.replayId !== replay.id) throw Error("回放已结束。");
        if (msg.playing !== undefined && typeof msg.playing !== "boolean")
          throw Error("播放状态无效。");
        if (msg.speed !== undefined && ![0.5, 1, 2, 4].includes(msg.speed))
          throw Error("播放速度无效。");
        if (msg.index !== undefined) {
          if (
            !Number.isInteger(msg.index) ||
            msg.index < 0 ||
            msg.index >= replay.record.frames.length
          )
            throw Error("回放位置无效。");
          replay.index = msg.index;
          replay.token = randomId();
          replay.ready.clear();
        }
        if (msg.playing !== undefined) {
          if (typeof msg.playing !== "boolean") throw Error("播放状态无效。");
          replay.playing = msg.playing;
        }
        if (msg.speed !== undefined) {
          if (![0.5, 1, 2, 4].includes(msg.speed)) throw Error("播放速度无效。");
          replay.speed = msg.speed;
        }
        break;
      }
      case "replay_ready": {
        const replay = room.replay;
        if (!replay || msg.replayId !== replay.id || msg.token !== replay.token)
          throw Error("回放帧已更新。");
        replay.ready.add(member.id);
        break;
      }
      case "replay_view": {
        const replay = room.replay;
        if (!replay || !replay.record.perspectives.includes(msg.perspective))
          throw Error("回放视角无效。");
        member.replayView = msg.perspective;
        replay.ready.delete(member.id);
        break;
      }
      default:
        throw Error("不支持的对局记录操作。");
    }
    const reply = { type: "record_reply", ack: msg.id, ...result };
    member.requests.set(msg.id, reply);
    if (member.requests.size > 512) member.requests.delete(member.requests.keys().next().value);
    if (
      !msg.action.startsWith("record_upload") &&
      !["record_export", "save_export"].includes(msg.action)
    ) {
      room.revision++;
      broadcast(room);
    }
    send(member.ws, reply);
    return true;
  }
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
  const reconnectTimers = new Map();
  const retained = (room) => members(room).some((m) => onlineMember(m) || reconnectTimers.has(m));
  const onlineMember = (member) => member?.ws?.readyState === 1;
  const members = (room) => [...room.members.values()];
  const returnTimers = new Map();
  const resultTimers = new Map(),
    hostTimers = new Map();
  function resetReady(room) {
    for (const member of members(room)) member.ready = !!member.bot;
  }
  function forcedFaction(room, seat) {
    if (room.settings.mode === "quick") return "PMC";
    return seat === null ? null : room.settings.teamFactions?.[G.seatTeam(seat)] || null;
  }
  function applyForcedFaction(room, member) {
    const faction = forcedFaction(room, member.seat);
    if (!faction || member.characterFaction === faction) return false;
    member.characterFaction = faction;
    member.formation = null;
    member.formationPreset = null;
    member.ready = !!member.bot;
    return true;
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
          mode: room.settings.mode || "regular",
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
  function presenceMessage(room, member, event) {
    room.chat.push({
      id: randomId(),
      channel: "all",
      system: true,
      event,
      memberId: member.id,
      name: member.name,
      characterFaction: member.characterFaction,
      at: Date.now(),
    });
    room.chat = room.chat.slice(-100);
  }
  function leaveRoom(ws) {
    const room = rooms.get(ws.room);
    const member = room?.members.get(ws.memberId);
    if (!member || member.ws !== ws) return;
    cancelSeatMoves(room, member.seat);
    if (member.seat !== null) {
      room.seats[member.seat] = null;
      if (room.battle) room.battle.ready[member.seat] = false;
    }
    clearReconnect(member);
    room.members.delete(member.id);
    presenceMessage(room, member, "离开了房间");
    delete ws.room;
    delete ws.memberId;
    delete ws.seat;
    send(ws, { type: "room_closed", message: "已离开房间。" });
    ws.close(1000, "Left room");
    if (!retained(room)) {
      destroyRoom(room);
    } else {
      room.revision++;
      broadcast(room);
    }
  }
  const logTeamIds = (room) =>
    room.logTeamIds ||
    [...new Set(room.seats.map((_, seat) => G.seatTeam(seat)))].sort((a, b) => a - b);
  const viewTeam = (member) =>
    member?.seat === null
      ? (member.viewTeam ?? null)
      : member?.seat === undefined
        ? null
        : G.seatTeam(member.seat);
  const logPerspective = (team) => (team === null ? "global" : "team:" + team);
  const logsUnlocked = (room) =>
    !!room.matchId && (!!room.logsUnlocked || room.phase === "finished" || !!room.returnCountdown);
  function exportPerspectives(room, member) {
    if (!room.matchId) return [];
    if (logsUnlocked(room)) return ["global", ...logTeamIds(room).map(logPerspective)];
    const team = viewTeam(member);
    return team === null ? [] : [logPerspective(team)];
  }
  // 公开快照不包含随机 seed；席位 token 不放入广播。
  const safeGame = (game, recipient, intel) => {
    let { seed, partSeed, ...view } = game;
    if (intel)
      view.units = game.units
        .filter((u) => u.team === intel.team || intel.visibleIds.includes(u.id))
        .map((u) => (u.team === intel.team ? u : { ...u, origin: null, pendingMove: null }));
    if (intel) {
      view.visionAreas = (game.visionAreas || []).filter((area) => area.team === intel.team);
      view.intel = intel;
      const ids = new Set(view.units.map((u) => u.id));
      view.turnEffects = (view.turnEffects || []).filter((e) => !e.unitId || ids.has(e.unitId));
    }
    return view;
  };
  // Fog presentation is separate from tactical intel and team logs. Only visual
  // state leaves the server; real HP, EN, hit probabilities and orders do not.
  function effectActor(actor) {
    const fields = [
      "id",
      "model",
      "x",
      "y",
      "angle",
      "aimAngle",
      "flying",
      "heldWeapon",
      "brokenParts",
      "environment",
      "visualOnly",
    ];
    return {
      ...Object.fromEntries(
        fields.filter((key) => actor[key] !== undefined).map((key) => [key, actor[key]]),
      ),
      hp: actor.hp > 0 ? 1 : 0,
      shield: actor.shield > 0 ? 1 : 0,
      en: 1,
      effectsOnly: true,
    };
  }
  function effectBattle(battle) {
    const scrub = (value, key = "") => {
      if (
        ["before", "after", "shieldBefore", "shieldAfter"].includes(key) &&
        typeof value === "number"
      )
        return value > 0 ? 1 : 0;
      if (["damage", "shieldDamage", "damagePerShot", "energySpent"].includes(key)) return 0;
      if (Array.isArray(value)) return value.map((item) => scrub(item));
      if (value && typeof value === "object")
        return Object.fromEntries(
          Object.entries(value)
            .filter(
              ([field]) =>
                ![
                  "hitChance",
                  "accuracy",
                  "modulesBefore",
                  "modulesAfter",
                  "moduleHp",
                  "evacuations",
                ].includes(field),
            )
            .map(([field, item]) => [field, scrub(item, field)]),
        );
      return value;
    };
    return {
      id: battle.id,
      matchId: battle.matchId,
      a: battle.a,
      b: battle.b,
      effectsOnly: true,
      visibleActorIds: [],
      actors: battle.actors.map(effectActor),
      before: Object.fromEntries(battle.actors.map((actor) => [actor.id, actor.hp > 0 ? 1 : 0])),
      events: battle.events.map((event) => ({ ...scrub(event), effectsOnly: true })),
    };
  }
  const combatVisibility = new WeakMap();
  function state(room, ack, recipient) {
    const team = viewTeam(recipient);
    const intel = team === null ? null : G.sensors.view(room.game, team);
    const known = (id) =>
      team === null ||
      room.game.units.some(
        (u) => u.id === id && (u.team === team || intel.visibleIds.includes(id)),
      );
    const relevant = (event) =>
      team === null ||
      [event.attacker, event.target].some((id) =>
        room.game.units.some((u) => u.id === id && u.team === team),
      );
    const reactions = (room.reactions || []).filter(relevant);
    const pending =
      reactionForSeat(room, recipient?.seat) ||
      reactions[0] ||
      (room.pending && relevant(room.pending) ? room.pending : null);
    const combats = (room.combatBatch || []).filter(
      (b) =>
        team === null ||
        b.actors?.some((u) => u.team === team) ||
        b.actors?.every((u) => known(u.id)),
    );
    // Incoming fire supplies the actors required for response UI, not vision or radar acquisition.
    const actorIds = new Set(
      reactions.flatMap((r) => [
        r.attacker,
        r.target,
        ...(r.attacks || []).flatMap((a) => [a.attacker, a.target]),
      ]),
    );
    if (pending) {
      actorIds.add(pending.attacker);
      actorIds.add(pending.target);
    }
    const combatActors = room.game.units.filter((u) => actorIds.has(u.id));
    const hiddenIds =
      team === null ? [] : room.game.units.filter((u) => !known(u.id)).map((u) => u.id);
    let lastEvent =
      room.lastEvent &&
      !hiddenIds.some((id) => JSON.stringify(room.lastEvent).includes('"' + id + '"'))
        ? room.lastEvent
        : null;
    if (
      team !== null &&
      ["move_preview", "move_cancel"].includes(lastEvent?.type) &&
      unit(room, lastEvent.unitId)?.team !== team
    )
      lastEvent = null;
    if (team !== null && lastEvent?.type === "move") {
      const actor = unit(room, lastEvent.unitId);
      if (actor && actor.team !== team) {
        const points = [lastEvent.from, ...lastEvent.path];
        let start = points.length - 1;
        while (start > 0 && G.sensors.visible(room.game, team, { ...actor, ...points[start - 1] }))
          start--;
        lastEvent = { ...lastEvent, from: points[start], path: points.slice(start + 1) };
      }
    }
    return {
      record: room.record
        ? {
            frames: room.record.frames.length,
            checkpoints: room.record.checkpoints.length,
            truncated: !!room.record.truncated,
            unlocked: logsUnlocked(room),
          }
        : null,
      saveAvailable: !!room.turnSave,
      loadedSave: room.resumeSave
        ? {
            round: room.resumeSave.game.round,
            team: room.resumeSave.game.team,
            gameVersion: room.resumeSave.gameVersion,
          }
        : null,
      savedFormation:
        room.resumeSave && recipient?.seat !== null && recipient?.seat !== undefined
          ? savedPlan(room, recipient.seat).entries
          : null,
      replay: replaySnapshot(room, recipient),
      combatIntel: room.phase === "playback" && team !== null
        ? room.playbackIntel?.[team] || null : null,
      pilotAwards: recipient ? (room.pilotAwards || []).filter(a => a.memberId === recipient.id).map(({ memberId, ...a }) => a) : [],
      techAwards: recipient ? (room.techAwards || [])
        .filter((award) => award.memberId === recipient.id)
        .map(({ memberId, ...award }) => award) : [],
      type: "state",
      room: room.code,
      revision: room.revision,
      game: safeGame(room.game, recipient, intel),
      combatActors,
      effectActors:
        team === null
          ? []
          : room.game.units
              .filter((actor) => actor.hp > 0 && !actor.embarked && !known(actor.id))
              .map((actor) => ({
                ...effectActor(actor),
                lowHp: actor.hp < G.modelOf(actor).hp * 0.25,
              })),
      effectEvent:
        room.lastEvent && !lastEvent && ["move", "launch", "skill"].includes(room.lastEvent.type)
          ? Object.fromEntries(
              [
                "id",
                "type",
                "unitId",
                "from",
                "to",
                "path",
                "effect",
                "sound",
                "reconMode",
                "weaponDisplayIndex",
              ]
                .filter((key) => room.lastEvent[key] !== undefined)
                .map((key) => [key, room.lastEvent[key]]),
            )
          : null,
      effectCombats: (room.combatBatch || [])
        .filter((battle) => !combats.includes(battle))
        .map(effectBattle),
      phase: room.phase,
      pending,
      reactions,
      playback: room.playback || null,
      battle: room.battle && relevant(room.battle) ? room.battle : null,
      plans: (room.plans || []).filter((p) => known(p.attacker) && (!p.target || known(p.target))),
      counterPlans: (room.responses || [])
        .filter(
          (choice) =>
            choice.response === "counter" &&
            known(choice.intent.target) &&
            known(choice.counterTargetId),
        )
        .map((choice) => ({
          attacker: choice.intent.target,
          target: choice.counterTargetId,
          weapon: choice.counterId,
          weapons: choice.counterIds || [choice.counterId],
        })),
      // 整批应战完成后一次广播本批全部结果，重连直接使用最终状态。
      combats: combats.map((battle) => ({
        ...battle,
        visibleActorIds: battle.actors
          .filter(
            (actor) =>
              team === null ||
              actor.team === team ||
              (combatVisibility.get(battle)?.[team] || intel.visibleIds).includes(actor.id),
          )
          .map((actor) => actor.id),
      })),
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
      reservedSeats: members(room)
        .filter((m) => reconnectTimers.has(m) && m.seat !== null)
        .map((m) => ({ memberId: m.id, seat: m.seat, until: m.disconnectedUntil })),
      members: members(room)
        .filter((m) => m.bot || onlineMember(m))
        .map((member) => ({
          id: member.id,
          name: member.name,
          characterFaction: member.characterFaction || null,
          seat: member.seat,
          ready: member.ready,
          connected: !!member.bot || onlineMember(member),
          bot: !!member.bot,
          shareUnits: !!member.shareUnits,
          aiSettings: member.bot ? member.aiSettings : undefined,
          formationPreset: member.formationPreset || null,
          armySettings: G.armySettings(member),
        })),
      you: recipient ? { id: recipient.id, seat: recipient.seat } : undefined,
      viewTeam: team,
      viewTeams: logTeamIds(room),
      logExport: {
        unlocked: logsUnlocked(room),
        perspective: logPerspective(team),
        options: exportPerspectives(room, recipient),
      },
      log: team === null || !room.matchId ? room.log : room.teamLogs?.[team] || [],
      logNames: !room.started
        ? room.logNames || []
        : [
            ...new Set(
              (team === null ? room.game.units : room.game.units.filter((u) => known(u.id)))
                .map((u) => u.customName)
                .filter(Boolean),
            ),
          ],
      lastEvent,
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
    if (!retained(room)) {
      destroyRoom(room);
      return;
    }
    refreshHost(room);
    if (!room.returnCountdown) {
      completePlayback(room);
      scheduleResultReturn(room);
    }
    captureRecord(room);
    advanceReplay(room);
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
    for (const member of members(room)) clearReconnect(member);
    rooms.delete(room.code);
    broadcastRooms();
  }
  function returnToRoom(room) {
    if (rooms.get(room.code) !== room || !room.started) return;
    clearTimeout(returnTimers.get(room));
    returnTimers.delete(room);
    clearTimeout(resultTimers.get(room));
    resultTimers.delete(room);
    room.logsUnlocked = true;
    room.resumeSave = null;
    room.startedFromSave = false;
    room.techAwards = [];
    room.pilotAwards = [];
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
    for (const member of members(room)) member.shareUnits = false;
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
      (room.reactions || []).find((request) =>
        canControl(room, seat, unit(room, request.target)),
      ) || null
    );
  }
  function botReaction(room) {
    return (
      (room.reactions || []).find((request) => {
        const owner = G.ownerOf(unit(room, request.target));
        return room.seats[owner]?.bot && reactionForSeat(room, owner)?.id === request.id;
      }) || null
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
    const intelBeforeCombat = Object.fromEntries(
      [...new Set(room.game.units.map((u) => u.team))].map((team) => [
        team, G.sensors.view(room.game, team),
      ]),
    );
    const visibleBeforeCombat = Object.fromEntries(
      Object.entries(intelBeforeCombat).map(([team, intel]) => [team, intel.visibleIds]),
    );
    const battles = planner.resolve(room);
    for (const battle of battles) combatVisibility.set(battle, visibleBeforeCombat);
    for (const battle of battles)
      for (const e of battle.events) {
        for (const evacuation of e.evacuations || [])
          log(
            room,
            `${unitLabel(room, unit(room, evacuation.unitId))} 舰毁紧急退出：${evacuation.escaped ? "成功，损失25%耐久和盾牌" : "未能生还"}。`,
            { units: [unit(room, evacuation.unitId)] },
          );
        if (e.empty) {
          log(room, `迫击炮落点 (${e.impactCell.x},${e.impactCell.y})：空地。`, {
            cell: e.impactCell,
          });
          continue;
        }
        const from = unit(room, e.from),
          to = unit(room, e.to);
        const defeatedModel = G.models[battle.actors.find((actor) => actor.id === e.to)?.model] ||
          G.modelOf(to);
        if (e.before > 0 && e.after <= 0) {
          if (from.team !== to.team) recordPilotBattle(room, from, "kill", defeatedModel.cost);
          recordPilotBattle(room, to, "loss", defeatedModel.cost);
        }
        for (const evacuation of e.evacuations || []) {
          if (evacuation.escaped) continue;
          const passenger = unit(room, evacuation.unitId);
          const cost = G.modelOf(passenger).cost;
          if (from.team !== passenger.team) recordPilotBattle(room, from, "kill", cost);
          recordPilotBattle(room, passenger, "loss", cost);
        }
        if (e.before > 0 && e.after <= 0 && !room.startedFromSave &&
            ["EFSF", "ZEON"].includes(G.modelOf(from).faction)) {
          const owner = room.seats[G.ownerOf(from)];
          if (owner && !owner.bot) {
            const defeatedOwner = room.seats[G.ownerOf(to)];
            const aiStrength = room.settings.mode !== "quick" && defeatedOwner?.bot
              ? G.aiPerformance[G.armySettings(defeatedOwner).difficulty] : 1;
            const rate = (owner.characterFaction === "PMC" ? 0.5 : 1) *
              (room.settings.mode === "quick" ? 0.25 : 1) * aiStrength;
            const points = defeatedModel.cost > 0
              ? Math.max(1, Math.floor(defeatedModel.cost * rate)) : 0;
            if (points) room.techAwards.push({
              id: randomId(), matchId: room.matchId, memberId: owner.id,
              faction: G.modelOf(from).faction, targetId: e.to, points,
            });
          }
        }
        const weapon = G.modelOf(from).weapons.find((weapon) => weapon.id === e.weapon);
        log(
          room,
          `${unitLabel(room, from)} 使用${weapon.name} → ${unitLabel(room, to)}：${e.hit ? e.damage + "伤害" : "未命中"}（命中 ${e.hitCount}/${e.strikeCount}）${e.brokenParts?.length ? "，部位破坏：" + [...new Set(e.brokenParts)].map((part) => G.partNames[part] || part).join("、") : ""}${e.after <= 0 ? "，击破！" : ""}`,
          {
            units: [from, to],
            visibleBy: visibleBeforeCombat,
            partial: (team) =>
              to.team === team
                ? `${unitLabel(room, to)} 受到视野外敌人的攻击：${e.hit ? e.damage + "伤害" : "未命中"}${e.after <= 0 ? "，击破！" : ""}`
                : null,
          },
        );
      }
    if (battles.length) {
      room.playbackIntel = intelBeforeCombat;
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
    room.playbackIntel = null;
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
  function recordPilotBattle(room, actor, kind, cost) {
    if (!actor?.pilot?.custom) return;
    const owner = room.seats[G.ownerOf(actor)];
    const points = Math.max(0, Math.floor(cost));
    actor.pilot = G.pilots.battleResult(actor.pilot, kind, points);
    if (owner && !owner.bot)
      (room.pilotAwards ||= []).push({ id: randomId(), memberId: owner.id,
        pilotId: actor.pilot.id, kind, points });
  }
  function advanceTurn(room, automatic = false) {
    delete room.openingSnipe;
    const fromTeam = room.game.team;
    const living = new Map(room.game.units.filter(u => u.hp > 0).map(u => [u.id, G.modelOf(u).cost]));
    G.end(room.game);
    for (const actor of room.game.units)
      if (actor.hp <= 0 && living.has(actor.id)) recordPilotBattle(room, actor, "loss", living.get(actor.id));
    for (const effect of room.game.turnEffects || [])
      if (effect.type === "evacuation")
        log(
          room,
          `${unitLabel(room, unit(room, effect.unitId))} 舰毁紧急退出：${effect.escaped ? "成功" : "未能生还"}。`,
          { units: [unit(room, effect.unitId)] },
        );
    if (room.game.winner !== null) {
      room.phase = "finished";
      return { type: "match_end" };
    }
    for (const effect of room.game.turnEffects || [])
      if (effect.type === "overdrive")
        log(
          room,
          `${unitLabel(room, unit(room, effect.unitId))} ${effect.skillId}消耗耐久与EN${effect.expired ? "，强化解除" : ""}。`,
          { units: [unit(room, effect.unitId)] },
        );
    planner.resumeCharges(room);
    room.turnDone = Array(room.seats.length).fill(false);
    room.turnNotBefore = Date.now() + G.turnTransitionMs;
    log(room, `第${room.game.round}回合 · 队伍${room.game.team + 1}开始行动。`);
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
  const playerBudget = (room, player) => G.armyBudget(room.settings, player);
  const playerUnitLimit = (room, player) => G.armyUnitLimit(room.settings, player);
  const playerRestrictions = (room, player) => G.armyRestrictions(room.settings, player);
  // Preview generation is deterministic and independent of the room roster.
  // Cache by all effective inputs, never by mutable player/room identity.
  const previewArmies = new Map();
  function randomArmy(room, player, seed = randomSeed()) {
    if (player.formationPreset)
      return G.validateFormation(
        player.formationPreset.units.slice(0, playerUnitLimit(room, player)),
        Infinity,
        playerUnitLimit(room, player),
      );
    const args = [
      seed,
      playerBudget(room, player),
      playerRestrictions(room, player),
      playerUnitLimit(room, player),
    ];
    const key = JSON.stringify(args);
    if (seed === 7319 && previewArmies.has(key)) return structuredClone(previewArmies.get(key));
    const army = G.randomFormation(...args);
    if (seed === 7319) {
      if (previewArmies.size >= 128) previewArmies.clear();
      previewArmies.set(key, structuredClone(army));
    }
    return army;
  }
  function checkAIArmy(room, player) {
    if (room.resumeSave) return;
    if (
      !G.planFormation(
        randomArmy(room, player, 7319),
        playerBudget(room, player),
        playerRestrictions(room, player),
        playerUnitLimit(room, player),
      ).deployable.length
    )
      throw Error("AI 没有符合房间或队伍限制的可用单位，请调整限制或预算");
  }
  function savedPlan(room, seat) {
    const units = room.resumeSave.game.units.filter((unit) => G.ownerOf(unit) === seat);
    const entries = units.map((unit) => {
      const model = G.models[unit.model];
      return {
        unitId: model.prefabId,
        kitId: model.kitId,
        ...(unit.customName ? { customName: unit.customName } : {}),
        ...(unit.pilot?.custom ? { customPilot: G.pilots.custom(unit.pilot) } : {}),
      };
    });
    const cost = units.reduce((sum, unit) => sum + G.models[unit.model].cost + G.pilots.cost(unit.pilot?.custom ? unit.pilot : null), 0);
    const restrictions = G.armyRestrictions(room.settings, room.seats[seat]);
    const reasons = {};
    units.forEach((unit, index) => {
      if (unit.hp <= 0) return;
      const reason = G.restrictionReason(G.models[unit.model], restrictions);
      if (reason) reasons[index] = reason;
    });
    return {
      entries,
      totalCost: cost,
      deployCost: cost,
      disabled: Object.keys(reasons).map(Number),
      reasons,
      deployable: entries,
      indices: entries.map((_, i) => i),
      dead: units.flatMap((unit, i) => (unit.hp <= 0 ? [i] : [])),
    };
  }
  function loadSavedRoom(room, save) {
    const count = G.getMap(save.settings.mapId).spawns.length;
    const lobbyGame = G.create(false, randomSeed(), Array(count).fill(null), false, save.settings);
    room.resumeSave = Records.clone(save);
    room.turnSave = Records.clone(save);
    room.settings = { ...G.defaultRoomSettings(), ...Records.clone(save.settings) };
    room.replay = null;
    room.started = false;
    room.phase = "waiting";
    room.seats = Array(count).fill(null);
    for (const player of members(room)) {
      if (player.seat !== null && player.seat >= count) {
        if (player.bot) {
          room.members.delete(player.id);
          continue;
        }
        player.seat = null;
      }
      if (player.ws) player.ws.seat = player.seat;
      if (player.seat !== null) {
        room.seats[player.seat] = player;
        if (save.armies[player.seat]) player.armySettings = Records.clone(save.armies[player.seat]);
      }
      player.ready = !!player.bot;
      player.finalReady = false;
      player.formationPreset = null;
    }
    planner.reset(room);
    room.game = lobbyGame;
    room.turnDone = Array(count).fill(false);
    room.returnAt = room.returnCountdown = null;
    room.lastEvent = { id: randomId(), type: "save_loaded" };
  }
  function resumeSavedGame(room) {
    const save = room.resumeSave;
    room.game = Records.clone(save.game);
    room.game.fogMode = room.settings.fogMode;
    room.game.costLimit = room.settings.costLimit;
    room.game.unitLimit = room.settings.unitLimit;
    for (const unit of room.game.units) {
      const player = room.seats[G.ownerOf(unit)];
      if (!player) continue;
      unit.performance = G.aiPerformance[G.armySettings(player).difficulty];
      const model = G.modelOf(unit);
      unit.hp = Math.min(unit.hp, model.hp);
      unit.en = Math.min(unit.en, model.en);
    }
    room.activeSeats = room.seats.map(Boolean);
    room.phase = "idle";
    planner.reset(room);
    room.battle = null;
    room.turnDone = Array(room.seats.length).fill(false);
    room.turnNotBefore = 0;
    room.log = Records.clone(save.log);
    room.teamLogs = Records.clone(save.teamLogs);
    room.logNames = Records.clone(save.logNames);
    room.resumeSave = null;
    room.lastEvent = { id: randomId(), type: "save_resumed" };
    log(room, "存档编组已确认，继续对局。");
  }
  function formationPlan(room, player) {
    if (room.resumeSave) return savedPlan(room, player.seat);
    const entries =
      player.formationPreset?.units || player.formation || randomArmy(room, player, 7319);
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
      playerRestrictions(room, player),
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
          unitCostLimit: playerRestrictions(room, player).unitCostLimit,
          assignedPreset: !!player.formationPreset,
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
      player
        ? room.resumeSave
          ? savedPlan(room, player.seat).entries
          : player.formationPreset?.units ||
            (player.bot ? randomArmy(room, player) : player.formation)
        : null,
    );
    if (!room.resumeSave)
      armies.forEach((army, seat) => {
        if (!room.seats[seat]) return;
        if (
          !army?.length ||
          !G.planFormation(
            army,
            playerBudget(room, room.seats[seat]),
            playerRestrictions(room, room.seats[seat]),
            playerUnitLimit(room, room.seats[seat]),
          ).deployable.length
        )
          throw Error("每名玩家至少需要一台符合限制的可出击单位");
      });
    room.seats.forEach((player, seat) => {
      if (player?.bot) player.formation = armies[seat];
    });
    room.turnSave = room.resumeSave ? Records.clone(room.resumeSave) : null;
    room.startedFromSave = !!room.resumeSave;
    room.techAwards = [];
    room.pilotAwards = [];
    room.saveTurn = null;
    room.started = true;
    room.phase = "assembly";
    room.matchId = randomId();
    room.returnAt = null;
    room.returnCountdown = null;
    resetFinalReady(room);
    // 上一局日志保留到新一局正式进入最终编组。
    room.log = [];
    room.teamLogs = {};
    room.logTeamIds = [...new Set(room.seats.map((_, seat) => G.seatTeam(seat)))].sort(
      (a, b) => a - b,
    );
    room.logsUnlocked = false;
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
    if (room.resumeSave) {
      if (plans.some((plan) => plan && Object.keys(plan.reasons).length))
        throw Error("存档编组不符合当前模式或房间禁用标签规则。");
      resumeSavedGame(room);
      return;
    }
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
        seatFormationRules: room.seats.map((player) => playerRestrictions(room, player)),
        performances: room.seats.map(
          (player) => G.aiPerformance[G.armySettings(player).difficulty],
        ),
        formationIndices: plans.map((plan) => plan?.indices ?? []),
      },
    );
    room.phase = "deployment";
    planner.reset(room);
    room.turnDone = Array(room.seats.length).fill(false);
    for (const player of room.seats)
      if (player?.bot && G.confirmDeployment(room.game, player.seat)) room.phase = "idle";
    logDeploymentArmies(room);
    log(room, "最终编组已确认，请在各自出生区部署并确认。");
  }
  // 从已裁定的出战单位生成一次开局编制记录，包含载员，不统计禁用单位。
  function logDeploymentArmies(room) {
    const lines = [];
    for (const player of room.seats) {
      if (!player) continue;
      const units = room.game.units.filter((u) => G.ownerOf(u) === player.seat),
        cost = units.reduce((sum, u) => sum + G.modelOf(u).cost, 0),
        prefix = `[${G.seatTeam(player.seat) ? "红方" : "蓝方"}][${player.name}]`;
      const roster = [`${prefix}部署编制：${units.length}台 · 总计COST ${cost}。`];
      for (const u of units) {
        const model = G.modelOf(u),
          carrier = u.embarked && unit(room, u.embarked.carrierId);
        roster.push(
          `${unitLabel(room, u)} 编制：${model.kitName} · COST ${model.cost}${carrier ? " · 预先搭载于" + G.unitName(carrier) + " / " + u.embarked.hangarId : ""}。`,
        );
      }
      lines.push({ text: roster.join("\n"), team: G.seatTeam(player.seat) });
    }
    // LOG按新到旧保存，反向写入以保持玩家与单位的编组顺序。
    for (const line of lines.reverse()) log(room, line.text, { teams: [line.team] });
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
      const counterIds = [];
      if (response.response === "counter") {
        const enemy = unit(room, counterTargetId);
        const options = pending.counterTargets?.find(
          (entry) => entry.attacker === counterTargetId,
        )?.options;
        const weapons = G.modelOf(target)
          .weapons.filter(
            (w) =>
              G.canCounter(room.game, target, enemy, w) && (!options || options.includes(w.id)),
          )
          .sort((a, b) => {
            const ea = G.estimate(room.game, target, enemy, a, "counter", true),
              eb = G.estimate(room.game, target, enemy, b, "counter", true);
            return (eb.damage * eb.hit) / G.actionCost(b) - (ea.damage * ea.hit) / G.actionCost(a);
          });
        const preferred = weapons.find((w) => w.id === response.weapon);
        if (preferred) counterIds.push(preferred.id);
        while (counterIds.length < 32) {
          const next = weapons.find((w) => {
            try {
              G.counterQueue(
                room.game,
                target,
                enemy,
                [...counterIds, w.id].map((id) =>
                  G.modelOf(target).weapons.find((w) => w.id === id),
                ),
              );
              return true;
            } catch {
              return false;
            }
          });
          if (!next) break;
          counterIds.push(next.id);
        }
      }
      return {
        player,
        action: "respond",
        fields: {
          reactionId: pending.id,
          response: response.response,
          counterId: response.weapon,
          counterIds,
          counterTargetId,
        },
      };
    }
    if (room.phase !== "idle") return null;
    const pendingMover = room.game.units.find(
      (u) => u.pendingMove && room.seats[u.pendingMove.seat]?.bot,
    );
    if (pendingMover)
      return {
        player: room.seats[pendingMover.pendingMove.seat],
        action: "confirm_move",
        fields: { unitId: pendingMover.id },
      };
    for (const passenger of room.game.units.filter((u) => u.embarked && u.hp > 0)) {
      const owner = room.seats[G.ownerOf(passenger)];
      if (!owner?.bot || room.turnDone[owner.seat]) continue;
      const point = G.aiLaunchChoice(room.game, passenger);
      if (
        owner?.bot &&
        !room.turnDone[owner.seat] &&
        point &&
        G.hangars.shouldLaunch(room.game, passenger)
      )
        return {
          player: owner,
          action: "launch",
          fields: { unitId: passenger.id, x: point.x, y: point.y },
        };
    }
    // Let passengers approach/board before their carriers move away this turn.
    for (const passenger of room.game.units) {
      const owner = room.seats[G.ownerOf(passenger)];
      if (!owner?.bot || passenger.team !== room.game.team || room.turnDone[owner.seat]) continue;
      const transport = G.hangars.recoveryOrder(room.game, passenger);
      if (transport) return { player: owner, ...transport };
    }
    const player = room.seats.find(
      (p) =>
        p?.bot &&
        G.seatTeam(p.seat) === room.game.team &&
        !room.turnDone[p.seat] &&
        room.game.units.some((u) => G.ownerOf(u) === p.seat && G.onMap(u) && !u.acted),
    );
    if (!player) {
      const unfinished = room.seats.find(
        (player) =>
          player?.bot && G.seatTeam(player.seat) === room.game.team && !room.turnDone[player.seat],
      );
      return unfinished ? { player: unfinished, action: "end_turn", fields: {} } : null;
    }
    const u = room.game.units.find((u) => G.ownerOf(u) === player.seat && G.onMap(u) && !u.acted);
    for (const skill of G.unitSkills(u).filter((s) => s.type === "flight")) {
      if (!u.flying && !u.moved && G.canUseSkill(room.game, u, skill.id))
        return {
          player,
          action: "skill",
          fields: { unitId: u.id, skillId: skill.id, x: u.x, y: u.y },
        };
    }
    for (const skill of G.unitSkills(u).filter((s) =>
      ["overdrive", "fullboost"].includes(s.type),
    )) {
      if (
        room.game.units.some(
          (enemy) =>
            enemy.team !== u.team &&
            G.onMap(enemy) &&
            G.sensors.visible(room.game, u.team, enemy) &&
            G.dist(u, enemy) <= 6,
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
        if (skill.type === "recon") {
          const direction = u.team === 0 ? 1 : -1;
          const desired = { x: u.x + direction * 12, y: u.y };
          return (
            Math.hypot(a.x - desired.x, a.y - desired.y) -
            Math.hypot(b.x - desired.x, b.y - desired.y)
          );
        }
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
        const enemies = room.game.units.filter(
          (e) => G.onMap(e) && e.team !== u.team && G.sensors.visible(room.game, u.team, e),
        );
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
    const pressure = G.aiTargetPressure(room.game, u.team);
    let best = null;
    for (const target of room.game.units.filter((t) => G.onMap(t) && t.team !== u.team))
      for (const weapon of G.modelOf(u).weapons)
        if (G.canAttack(room.game, u, target, weapon)) {
          try {
            G.attackQueue(room.game, u, target, [weapon]);
          } catch {
            continue;
          }
          const estimate = G.estimate(room.game, u, target, weapon);
          const commitment = pressure.get(target.id);
          const remaining = Math.max(0, target.hp - (commitment?.damage || 0));
          const expected = estimate.hit * estimate.damage / 100;
          const score = Math.min(expected, remaining) +
            (remaining > 0 && expected >= remaining ? remaining * 0.1 : 0);
          const useful = score > 0;
          const assignedAttackers = commitment?.attackers || 0;
          if (!best || (useful && !best.useful) ||
            (useful === best.useful &&
              (assignedAttackers < best.assignedAttackers ||
                (assignedAttackers === best.assignedAttackers && score > best.score))))
            best = { target, weapon, score, remaining, useful, assignedAttackers };
        }
    if (!best) return { player, action: "wait", fields: { unitId: u.id } };
    const weapons = [best.weapon];
    let plannedDamage = G.estimate(room.game, u, best.target, best.weapon);
    plannedDamage = plannedDamage.damage * plannedDamage.hit / 100;
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
        // A small margin covers misses without spending the entire queue on an
        // enemy that allied plans already expect to destroy.
        if (plannedDamage >= best.remaining * 1.25) break;
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
        const estimate = G.estimate(room.game, u, best.target, next);
        plannedDamage += estimate.damage * estimate.hit / 100;
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
      let intent;
      try {
        intent = nextAIAction(room);
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
      } catch (error) {
        console.error("AI action failed", room.code, intent?.action, error);
        // A rejected bot command must never terminate the shared server.
        // End only this unit's action when it is still safe to do so.
        const unit = room.game.units.find((u) => u.id === intent?.fields?.unitId);
        if (
          room.phase === "idle" &&
          unit &&
          !unit.acted &&
          !unit.plan &&
          G.onMap(unit) &&
          unit.team === room.game.team
        ) {
          try {
            action(intent.player.ws, {
              id: randomId(),
              revision: room.revision,
              round: room.game.round,
              action: "wait",
              unitId: unit.id,
            });
          } catch (fallbackError) {
            console.error("AI fallback failed", room.code, fallbackError);
          }
        }
      }
    }, delay);
    timer.unref?.();
    aiTimers.set(room, timer);
  }
  // 使用玩家显示 ID 而非席位编号，避免多人同型号机体的日志混淆。
  function unitLabel(room, unit) {
    if (unit.customName && !room.logNames?.includes(unit.customName))
      (room.logNames ||= []).push(unit.customName);
    if (unit.pilot?.custom && !room.logNames?.includes(unit.pilot.name))
      (room.logNames ||= []).push(unit.pilot.name);
    const player = room.seats[G.ownerOf(unit)];
    const model = G.modelOf(unit);
    return `[${unit.team ? "红方" : "蓝方"}][${player?.name || "空席位"}]${G.pilotUnitName(unit)}(${model.code} ${model.name})`;
  }
  // Record the information available when an event happens, never retroactively reveal it.
  function log(
    room,
    text,
    {
      units = [],
      teams = null,
      cell = null,
      movement = null,
      visibleBy = null,
      partial = null,
    } = {},
  ) {
    room.log.unshift(text);
    room.teamLogs ||= {};
    const involved = units.filter(Boolean);
    for (const team of logTeamIds(room)) {
      if (teams && !teams.includes(team)) continue;
      const history = (room.teamLogs[team] ||= []);
      const seen = (u) =>
        u.team === team ||
        (visibleBy ? visibleBy[team]?.includes(u.id) : G.sensors.visible(room.game, team, u));
      if (movement && involved[0]?.team !== team) {
        const actor = involved[0];
        const points = [movement.from, ...movement.path];
        let lastVisible = null,
          disappearance = null;
        for (const point of points) {
          if (seen({ ...actor, ...point })) lastVisible = point;
          else if (lastVisible) {
            const dx = Math.sign(point.x - lastVisible.x),
              dy = Math.sign(point.y - lastVisible.y);
            const direction =
              (dy < 0 ? "北" : dy > 0 ? "南" : "") + (dx < 0 ? "西" : dx > 0 ? "东" : "");
            disappearance = `敌人从${G.columnLabel(lastVisible.x)}${lastVisible.y + 1}格失踪，朝向${direction || "未知"}方向。`;
            lastVisible = null;
          }
        }
        if (seen(actor)) history.unshift(text);
        else if (disappearance) history.unshift(disappearance);
        continue;
      }
      if (cell && !G.sensors.view(room.game, team).visibleCells.includes(cell.x + "," + cell.y))
        continue;
      if (involved.some((u) => !seen(u))) {
        const summary = partial?.(team);
        if (summary) history.unshift(summary);
        continue;
      }
      history.unshift(text);
    }
  }
  const unit = (room, id) => room.game.units.find((u) => u.id === id);
  function cancelSeatMoves(room, seat) {
    for (const u of room.game.units)
      if (u.pendingMove?.seat === seat) {
        G.cancelMove(room.game, u);
        room.lastEvent = { id: randomId(), type: "move_cancel", unitId: u.id };
      }
  }
  const canControl = (room, seat, u) => G.canControlUnit(room.settings, members(room), seat, u);
  function ownUnit(room, seat, id, allowCargo = false, allowPending = false) {
    let u = unit(room, id);
    if (!u || !canControl(room, seat, u) || u.hp <= 0 || (!allowCargo && u.embarked))
      throw Error("不能操作该单位");
    if (u.pendingMove && !allowPending) throw Error("请先确认或取消移动");
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
    if (typeof msg.action !== "string") throw Error("无效的操作。");
    if (recordAction(room, member, msg)) return;
    if (room.replay && !["sync", "chat"].includes(msg.action)) throw Error("请先结束回放。");
    // Recheck every download, including retried IDs after a seat or match change.
    if (msg.action === "download_log") {
      if (msg.matchId !== room.matchId || !room.matchId) throw Error("战报所属对局已更新。");
      if (!exportPerspectives(room, member).includes(msg.perspective))
        throw Error("对局中只能下载当前队伍视角的战报。");
      const entries =
        msg.perspective === "global"
          ? room.log
          : room.teamLogs?.[Number(msg.perspective.slice(5))] || [];
      send(ws, {
        type: "battle_log",
        ack: id,
        matchId: room.matchId,
        perspective: msg.perspective,
        log: entries.slice(),
      });
      return;
    }
    if (cache.has(id)) {
      const cached = cache.get(id);
      if (cached?.type === "chat") {
        if (!chatChannels.canRead(member.seat, cached.message.channel || "all"))
          throw Error("你目前不能查看该聊天频道。");
        send(ws, { type: "chat", message: cached.message, ack: id });
      } else send(ws, state(room, id, member));
      return;
    }
    if (room.returnCountdown && !["sync", "chat", "return_room", "spectate"].includes(msg.action))
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
    if (msg.action === "spectate") {
      if (member.seat !== null) throw Error("只有观战玩家可以切换视角。");
      if (
        msg.matchId !== room.matchId ||
        !Number.isSafeInteger(msg.revision) ||
        msg.revision > room.revision
      )
        throw Error("对局已更新，请重新同步。");
      if (
        msg.team !== null &&
        (!Number.isInteger(msg.team) || !logTeamIds(room).includes(msg.team))
      )
        throw Error("观战队伍无效。");
      member.viewTeam = msg.team;
      cache.set(id, true);
      if (cache.size > 512) cache.delete(cache.keys().next().value);
      send(ws, state(room, id, member));
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
        characterFaction: member.characterFaction,
        text,
        channel,
        at: Date.now(),
      };
      room.chat.push(message);
      room.chat = room.chat.slice(-100);
      captureRecord(room);
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
        "rename_unit",
        "share_units",
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
        "configure_player",
        "set_faction",
        "update_formation",
        "confirm_formation",
      ].includes(msg.action)
    ) {
      if (!Number.isSafeInteger(msg.revision) || msg.revision !== room.revision) {
        send(ws, { type: "error", id, code: "STALE", message: "房间状态已更新，请重试。" });
        send(ws, state(room, undefined, member));
        return;
      }
      if (msg.action === "rename_unit") {
        if (
          !room.started ||
          ["assembly", "finished"].includes(room.phase) ||
          seat === null ||
          msg.matchId !== room.matchId
        )
          throw Error("当前不能修改单位名称");
        const target = unit(room, msg.unitId);
        if (!target || !G.canControlUnit(room.settings, members(room), seat, target))
          throw Error("不能修改该单位名称");
        const name = G.normalizeUnitName(msg.name),
          before = unitLabel(room, target);
        if ((target.customName || "") !== name) {
          if (name) target.customName = name;
          else delete target.customName;
          log(room, `${before} 更名为 ${G.unitName(target)}。`, { units: [target] });
          unitLabel(room, target);
        }
      } else if (msg.action === "share_units") {
        if (!room.started || ["assembly", "finished"].includes(room.phase) || seat === null)
          throw Error("只有出战玩家可以在战斗中共享单位");
        if (msg.matchId !== room.matchId) throw Error("对局已更新，请重新同步。");
        if (!member.shareUnits) {
          member.shareUnits = true;
          log(room, `${member.name} 已将自己的单位共享给友军。`, { teams: [G.seatTeam(seat)] });
        }
      } else if (msg.action === "start_game") {
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
            if (!room.resumeSave)
              member.formation = G.validateFormation(
                member.formationPreset?.units ?? msg.formation ?? member.formation,
                Infinity,
                playerUnitLimit(room, member),
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
        if (room.resumeSave) {
          if (msg.action !== "confirm_formation" || room.phase !== "assembly")
            throw Error("存档编组不可更改。");
          if (member.seat === null && member.id !== room.hostId)
            throw Error("观战玩家不能确认编组。");
          if (member.seat !== null && Object.keys(savedPlan(room, member.seat).reasons).length)
            throw Error("存档编组不符合当前模式或房间禁用标签规则。");
          if (member.seat !== null) member.finalReady = true;
          startDeployment(room);
          room.revision++;
          cache.set(id, true);
          broadcast(room, id);
          return;
        }
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
          member.formationPreset?.units ||
          (msg.formation === undefined
            ? member.formation
            : G.validateFormation(msg.formation, Infinity, playerUnitLimit(room, member)));
        const plan = G.planFormation(
          formation,
          playerBudget(room, member),
          playerRestrictions(room, member),
          playerUnitLimit(room, member),
        );
        if (msg.action === "confirm_formation" && !plan.deployable.length)
          throw Error("至少需要一台可出击单位");
        member.formation = formation;
        // 保存编组保留自己和队友的准备/确认状态。
        if (msg.action === "confirm_formation") member.finalReady = true;
        if (room.phase === "assembly") startDeployment(room);
      } else if (msg.action === "configure_player") {
        if (room.settings.mode !== "quick")
          throw Error("常规战不能调整玩家独立规则。");
        if (room.hostId !== member.id) throw Error("只有房主可以调整玩家独立规则。");
        if (room.started) throw Error("对局开始后不能修改玩家独立规则。");
        const target = room.members.get(msg.memberId);
        if (!target || target.bot) throw Error("目标玩家无效。");
        if (!msg.config || typeof msg.config !== "object" || Array.isArray(msg.config) ||
            !Object.keys(msg.config).length ||
            Object.keys(msg.config).some((key) =>
              !["fill", "countPercent", "unitCostPercent", "difficulty"].includes(key)))
          throw Error("玩家独立规则无效。");
        target.armySettings = G.validateArmySettings({
          ...G.armySettings(target), ...msg.config,
          ...(Object.hasOwn(msg.config, "unitCostPercent") ? { unitCostLimit: null } : {}),
        });
        target.ready = false;
      } else if (msg.action === "set_faction") {
        if (room.started) throw Error("对局开始后不能切换阵营。");
        if (room.settings.mode === "quick" && msg.faction !== "PMC")
          throw Error("快速战固定使用 PMC 阵营。");
        if (!["PMC", "EFSF", "ZEON"].includes(msg.faction))
          throw Error("玩家阵营无效。");
        const required = forcedFaction(room, member.seat);
        if (required && required !== msg.faction)
          throw Error("本队已设置强制阵营。");
        if (member.characterFaction !== msg.faction) {
          member.characterFaction = msg.faction;
          member.formation = null;
          member.formationPreset = null;
          member.ready = false;
        }
      } else if (msg.action === "configure_ai") {
        if (room.hostId !== member.id) throw Error("只有房主可以设置 AI。");
        if (room.started) throw Error("对局开始后不能修改 AI。");
        const bot = room.seats[msg.seat];
        if (!Number.isInteger(msg.seat) || !bot?.bot) throw Error("该席位不是 AI。");
        if (Object.hasOwn(msg, "formationPreset"))
          throw Error("房主不能修改 AI 编组预设。");
        const allowed = room.settings.mode === "quick"
          ? ["fill", "countPercent", "unitCostPercent", "difficulty"] : ["difficulty"];
        if (!msg.config || typeof msg.config !== "object" ||
            Array.isArray(msg.config) ||
            Object.keys(msg.config).some((key) => !allowed.includes(key)))
          throw Error(room.settings.mode === "quick"
            ? "AI 独立规则无效。" : "房主只能调整 AI 单位强度。");
        const armySettings = G.validateArmySettings({
          ...G.armySettings(bot), ...msg.config,
          ...(Object.hasOwn(msg.config, "unitCostPercent") ? { unitCostLimit: null } : {}),
        });
        const characterFaction = msg.characterFaction ?? bot.characterFaction;
        if (!["PMC", "EFSF", "ZEON"].includes(characterFaction))
          throw Error("AI 阵营无效。");
        if (room.settings.mode === "quick" && characterFaction !== "PMC")
          throw Error("快速战 AI 固定使用 PMC 阵营。");
        const required = forcedFaction(room, bot.seat);
        if (required && required !== characterFaction)
          throw Error("本队已设置强制阵营。");
        checkAIArmy(room, {
          ...bot, armySettings, characterFaction,
        });
        bot.armySettings = armySettings;
        bot.aiSettings = {
          difficulty: armySettings.difficulty,
          fill: armySettings.fill,
          countPercent: armySettings.countPercent,
        };
        bot.characterFaction = characterFaction;
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
            characterFaction:
              forcedFaction(room, destination) || msg.characterFaction ||
              (G.seatTeam(destination) === 0 ? "EFSF" : "ZEON"),
            aiSettings: G.validateAISettings(),
            seat: destination,
            ready: true,
            requests: new Map(),
            ws: { room: room.code, memberId: botId, seat: destination },
          };
          if (!["PMC", "EFSF", "ZEON"].includes(bot.characterFaction))
            throw Error("AI 阵营角色无效");
          if (room.resumeSave?.armies[destination])
            bot.armySettings = Records.clone(room.resumeSave.armies[destination]);
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
        if (room.resumeSave && msg.mapId !== room.resumeSave.settings.mapId)
          throw Error("存档地图不可更改。");
        const map = G.getMap(msg.mapId);
        if (msg.shareAlliedUnits !== undefined && typeof msg.shareAlliedUnits !== "boolean")
          throw Error("友军单位共享设置无效");
        const settings = {
          mode: G.validateBattleMode(msg.battleMode ?? room.settings.mode),
          mapId: map.id,
          fogMode: G.validateFogMode(msg.fogMode ?? room.settings.fogMode),
          shareAlliedUnits: msg.shareAlliedUnits ?? room.settings.shareAlliedUnits ?? false,
          costLimit: G.validateCostLimit(msg.costLimit),
          unitLimit: G.validateUnitLimit(msg.unitLimit ?? room.settings.unitLimit),
          unitCostLimit: G.validateUnitCostLimit(msg.unitCostLimit ?? room.settings.unitCostLimit),
          ...G.validateTagRestrictions({
            bannedFactions: msg.bannedFactions ?? room.settings.bannedFactions,
            bannedEras: msg.bannedEras ?? room.settings.bannedEras,
            bannedTypes: msg.bannedTypes ?? room.settings.bannedTypes,
          }),
          teamRestrictions: G.validateBattleMode(msg.battleMode ?? room.settings.mode) === "quick"
            ? G.validateTeamRestrictions(
                msg.teamRestrictions ?? room.settings.teamRestrictions ?? [{}, {}],
              )
            : [G.validateTagRestrictions(), G.validateTagRestrictions()],
          teamFactions: G.validateBattleMode(msg.battleMode ?? room.settings.mode) === "quick"
            ? [null, null]
            : G.validateTeamFactions(
                msg.teamFactions ?? room.settings.teamFactions ?? [null, null],
              ),
        };
        if (JSON.stringify(settings) !== JSON.stringify(room.settings)) {
          const mapChanged = settings.mapId !== room.settings.mapId;
          const modeChanged = settings.mode !== room.settings.mode;
          const factionsChanged =
            JSON.stringify(settings.teamFactions) !== JSON.stringify(room.settings.teamFactions);
          const tagsChanged = ["bannedFactions", "bannedEras", "bannedTypes", "teamRestrictions"]
            .some((key) => JSON.stringify(settings[key]) !== JSON.stringify(room.settings[key]));
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
          for (const player of members(room)) applyForcedFaction(room, player);
          if (modeChanged && settings.mode === "regular") {
            for (const player of members(room)) {
              const difficulty = player.bot ? G.armySettings(player).difficulty : "medium";
              player.armySettings = G.validateArmySettings({ difficulty });
              if (player.bot) player.aiSettings = {
                difficulty, fill: 100, countPercent: 100,
              };
            }
          }
          room.turnDone = Array(map.spawns.length).fill(false);
          if (mapChanged || modeChanged || factionsChanged || tagsChanged) resetReady(room);
        }
      } else if (msg.action === "kick_player") {
        if (room.hostId !== member.id) throw Error("只有房主可以踢出玩家");
        const target = room.members.get(msg.memberId);
        if (!target || target.id === member.id || target.bot) throw Error("无效的玩家");
        cancelSeatMoves(room, target.seat);
        if (target.seat !== null) {
          room.seats[target.seat] = null;
          if (room.battle) room.battle.ready[target.seat] = false;
        }
        clearReconnect(target);
        room.members.delete(target.id);
        presenceMessage(room, target, "被房主移出了房间");
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
          if (!movingMember) throw Error("无效的玩家");
          if (movingMember.bot && msg.seat === null) throw Error("AI不能移入观战席");
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
          cancelSeatMoves(room, movingMember.seat);
          if (movingMember.seat !== null) {
            room.seats[movingMember.seat] = null;
            if (room.battle) room.battle.ready[movingMember.seat] = false;
          }
          movingMember.seat = destination;
          movingMember.shareUnits = false;
          if (movingMember.ws) movingMember.ws.seat = destination;
          applyForcedFaction(room, movingMember);
          movingMember.ready = !!movingMember.bot;
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
          if (msg.ready && !room.resumeSave) {
            const formation = G.validateFormation(
              member.formationPreset?.units || msg.formation,
              Infinity,
              playerUnitLimit(room, member),
            );
            if (
              !G.planFormation(
                formation,
                playerBudget(room, member),
                playerRestrictions(room, member),
                playerUnitLimit(room, member),
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
    // 部署也允许各席位基于同一快照同时操作；占位、所有权仍用最新战局校验。
    const concurrentDeployment =
      room.phase === "deployment" &&
      msg.matchId === room.matchId &&
      msg.round === room.game.round &&
      ["deploy", "rotate", "confirm_deployment", "embark", "launch"].includes(msg.action);
    const concurrentPlan =
      room.phase === "idle" &&
      msg.round === room.game.round &&
      msg.matchId === room.matchId &&
      [
        "move",
        "confirm_move",
        "cancel_move",
        "rotate",
        "skill",
        "undo",
        "wait",
        "attack",
        "cancel_attack",
        "end_turn",
        "embark",
        "launch",
      ].includes(msg.action);
    const currentResponse =
      msg.action === "respond" &&
      !!reactionForSeat(room, seat) &&
      msg.reactionId === reactionForSeat(room, seat).id;
    if (
      !Number.isSafeInteger(msg.revision) ||
      msg.revision > room.revision ||
      (msg.revision !== room.revision &&
        !concurrentPlan &&
        !concurrentDeployment &&
        !currentResponse)
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
    const pendingMove = room.game.units.find((u) => u.pendingMove?.seat === seat);
    if (
      pendingMove &&
      [
        "move",
        "rotate",
        "skill",
        "undo",
        "wait",
        "attack",
        "cancel_attack",
        "end_turn",
        "embark",
        "launch",
      ].includes(msg.action)
    )
      throw Error("请先确认或取消移动");
    let event;
    switch (msg.action) {
      case "embark":
      case "launch": {
        if (room.phase !== "deployment") validateActive(room, seat);
        const passenger = ownUnit(room, seat, msg.unitId, msg.action === "launch");
        if (msg.action === "embark") {
          const carrier = unit(room, msg.carrierId);
          event = G.hangars.embark(room.game, passenger, carrier, msg.hangarId);
          log(room, `${unitLabel(room, passenger)} 搭载至${unitLabel(room, carrier)}。`, {
            units: [passenger, carrier],
          });
        } else {
          event = G.hangars.launch(room.game, passenger, msg.x, msg.y);
          log(
            room,
            `${unitLabel(room, passenger)} 出击至${G.columnLabel(passenger.x)}${passenger.y + 1}。`,
            { units: [passenger] },
          );
        }
        break;
      }
      case "deploy": {
        if (room.phase !== "deployment") throw Error("Not deploying");
        const deployingUnit = ownUnit(room, seat, msg.unitId);
        G.deploy(room.game, G.ownerOf(deployingUnit), msg.unitId, msg.x, msg.y);
        log(
          room,
          `${unitLabel(room, unit(room, msg.unitId))} 部署至${G.columnLabel(msg.x)}${msg.y + 1}。`,
          { teams: [deployingUnit.team] },
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
          log(room, `${unitLabel(room, u)} ${msg.direction < 0 ? "左转" : "右转"}。`, {
            units: [u],
          });
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
          { units: [u, result] },
        );
        break;
      }
      case "move": {
        validateActive(room, seat);
        let u = ownUnit(room, seat, msg.unitId);
        if (!Number.isInteger(msg.x) || !Number.isInteger(msg.y)) throw Error("目标格无效");
        let from = { x: u.x, y: u.y },
          steps = member.bot
            ? G.move(room.game, u, msg.x, msg.y)
            : G.previewMove(room.game, u, msg.x, msg.y, seat);
        event = { type: member.bot ? "move" : "move_preview", unitId: u.id, from, path: steps };
        if (member.bot)
          log(room, `${unitLabel(room, u)} 移动至${G.columnLabel(u.x)}${u.y + 1}。`, {
            units: [u],
            movement: event,
          });
        break;
      }
      case "confirm_move":
      case "cancel_move": {
        validateActive(room, seat);
        const u = ownUnit(room, seat, msg.unitId, false, true);
        if (!u.pendingMove || u.pendingMove.seat !== seat) throw Error("没有属于你的待确认移动");
        if (msg.action === "cancel_move") {
          G.cancelMove(room.game, u);
          event = { type: "move_cancel", unitId: u.id };
        } else {
          const from = { x: u.x, y: u.y },
            path = G.confirmMove(room.game, u);
          event = { type: "move", unitId: u.id, from, path, previewTeam: u.team };
          log(room, `${unitLabel(room, u)} 移动至${G.columnLabel(u.x)}${u.y + 1}。`, {
            units: [u],
            movement: event,
          });
        }
        break;
      }
      case "undo": {
        validateActive(room, seat);
        let u = ownUnit(room, seat, msg.unitId);
        if (u.acted || !u.origin) throw Error("无法撤销移动");
        const from = { x: u.x, y: u.y };
        G.undo(room.game, u);
        event = { type: "undo", unitId: u.id };
        log(room, `${unitLabel(room, u)} 撤销移动。`, {
          units: [u],
          movement: { from, path: [{ x: u.x, y: u.y }] },
        });
        break;
      }
      case "wait": {
        validateActive(room, seat);
        let u = ownUnit(room, seat, msg.unitId);
        if (u.plan) planner.cancel(room, u);
        G.wait(room.game, u);
        event = { type: "wait", unitId: u.id };
        log(room, `${unitLabel(room, u)} 待机。`, { units: [u] });
        break;
      }
      case "end_turn": {
        validateActive(room, seat);
        room.turnDone[seat] = true;
        for (const u of room.game.units)
          if (G.ownerOf(u) === seat && G.onMap(u) && !u.acted) G.wait(room.game, u);
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
          b = msg.targetCell
            ? G.groundTarget(room.game, a, msg.targetCell.x, msg.targetCell.y)
            : unit(room, msg.targetId),
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
          `${unitLabel(room, a)} 计划使用${weapons.map((w) => w.name).join(" → ")}攻击${b.groundTarget ? G.columnLabel(b.x) + (b.y + 1) : unitLabel(room, b)}，等待本队结束规划。`,
          { units: b.groundTarget ? [a] : [a, b] },
        );
        break;
      }
      case "cancel_attack": {
        validateActive(room, seat);
        const attacker = ownUnit(room, seat, msg.unitId);
        planner.cancel(room, attacker);
        event = { type: "cancel_plan", unitId: attacker.id };
        log(room, `${unitLabel(room, attacker)} 取消攻击计划。`, { units: [attacker] });
        break;
      }
      case "respond": {
        const pending = reactionForSeat(room, seat);
        if (room.phase !== "reaction" || !pending) throw Error("当前没有待应战的攻击");
        if (msg.reactionId !== pending.id) throw Error("应战请求已过期，请处理当前交战");
        const b = unit(room, pending.target);
        if (!canControl(room, seat, b)) throw Error("不能操作该单位的应战");
        planner.choose(
          room,
          msg.reactionId,
          msg.response,
          msg.counterIds ?? msg.counterId,
          msg.counterTargetId ?? pending.attacker,
        );
        const decision =
          msg.response === "counter" ? "反击" : msg.response === "defend" ? "防御" : "回避";
        log(room, `${unitLabel(room, b)} 选择${decision}。`, { units: [b] });
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
    let characterFaction = msg.characterFaction;
    if (!["PMC", "EFSF", "ZEON"].includes(characterFaction)) throw Error("角色阵营无效。");
    let code = String(msg.room || "")
      .trim()
      .toUpperCase();
    if (!/^[\p{Script=Han}A-Z0-9_-]{1,20}$/u.test(code))
      throw Error("房间名称需为1–20位中文、英文字母、数字、下划线或短横线");
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
        settings: {
          ...G.defaultRoomSettings(),
          mode: G.validateBattleMode(msg.roomMode),
        },
        turnDone: [false, false],
        members: new Map(),
        nextPlayerNumber: 1,
        hostId: null,
        matchId: null,
        startedFromSave: false,
        techAwards: [],
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
    if (msg.mode !== "resume")
      characterFaction = forcedFaction(room, seat) || characterFaction;
    let member;
    if (msg.mode === "resume") {
      if (typeof msg.token !== "string") throw Error("缺少重连凭据");
      member = members(room).find((player) => player.token === msg.token);
      if (!member) throw Error("重连凭据无效，请重新加入房间");

      seat = member.seat;
      applyForcedFaction(room, member);
    } else {
      if (room.members.size >= 32) throw Error("房间人数已满");
      member = {
        id: randomId(),
        name: displayName || "玩家" + room.nextPlayerNumber++,
        characterFaction,
        seat,
        ready: false,
        finalReady: false,
        formation: G.randomFormation(
          randomSeed(),
          room.settings.costLimit,
          G.armyRestrictions(room.settings, { seat, characterFaction }),
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
    clearReconnect(member);
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
    presenceMessage(room, member, msg.mode === "resume" ? "已重新连接" : "加入了房间");
    broadcast(room);
  }

  function clearReconnect(member) {
    clearTimeout(reconnectTimers.get(member));
    reconnectTimers.delete(member);
    delete member.disconnectedUntil;
  }
  function disconnect(ws) {
    let room = rooms.get(ws.room);
    const member = room?.members.get(ws.memberId);
    if (member?.ws === ws) {
      member.ws = null;
      clearReconnect(member);
      member.disconnectedUntil = Date.now() + reconnectGraceMs;
      presenceMessage(room, member, "连接断开，等待重连");
      const timer = setTimeout(() => {
        if (
          rooms.get(room.code) !== room ||
          room.members.get(member.id) !== member ||
          onlineMember(member)
        )
          return;
        clearReconnect(member);
        cancelSeatMoves(room, member.seat);
        if (member.seat !== null && room.seats[member.seat] === member)
          room.seats[member.seat] = null;
        room.members.delete(member.id);
        presenceMessage(room, member, "重连超时，已离开房间");
        room.revision++;
        broadcast(room);
      }, reconnectGraceMs);
      timer.unref?.();
      reconnectTimers.set(member, timer);
      room.revision++;
      broadcast(room);
    }
  }
  function close() {
    for (const member of [...reconnectTimers.keys()]) clearReconnect(member);
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
