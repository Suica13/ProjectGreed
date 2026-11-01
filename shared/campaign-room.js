/* Adapter between a persistent campaign and the existing authoritative tactical room. */
"use strict";
function createCampaignRoom({
  G,
  Records,
  randomId,
  randomSeed,
  members,
  planner,
  log,
  pauseBattle,
}) {
  const C = typeof CampaignRules !== "undefined" ? CampaignRules : require("./campaign.js");
  const crews =
    typeof CampaignPilots !== "undefined" ? CampaignPilots : require("./campaign-pilots.js");
  const ctx = {
    G,
    world: G.catalog.scenarios.earth_0079_mid.world,
    production:
      typeof PRODUCTION_CATALOG !== "undefined"
        ? PRODUCTION_CATALOG
        : require("./production-data.cjs"),
    development: typeof Development !== "undefined" ? Development : require("./development.js"),
    validateBattle: (save) => Records.validateSave(G, save),
  };
  const check = (value, message) => {
    if (!value) throw Error(message);
  };
  function indexedMap(room, region) {
    const entry =
      G.catalog.scenarios[room.settings.scenarioId || "earth_0079_mid"]?.regions[region];
    return entry && G.getMap(entry.mapId).spawns.length === room.seats.length ? entry.mapId : null;
  }
  function eligible(room) {
    return room.seats.map(
      (member, seat) =>
        !!member &&
        room.game.units.some(
          (unit) =>
            unit.hp > 0 &&
            (G.ownerOf(unit) === seat ||
              (unit.team === G.seatTeam(seat) && C.commander(members(room), unit.team) === seat)),
        ),
    );
  }
  function resetTurns(room) {
    room.turnDone = eligible(room).map((active) => !active);
    room.campaignSeatCompletion = room.seats.map(() => false);
  }
  function bindTeams(room) {
    for (const member of members(room)) {
      if (Number.isInteger(member.seat)) member.campaignTeam = G.seatTeam(member.seat);
      if (Number.isInteger(member.campaignTeam)) {
        member.characterFaction = room.campaign.teams[member.campaignTeam].faction;
        member.viewTeam = member.campaignTeam;
      }
    }
  }
  function configureDeployment(room) {
    const game = room.game;
    if (!game.campaignBattlefield) return;
    game.campaignBattlefield.deploymentControllers = {};
    game.deployment = room.seats.map(() => true);
    for (const actor of game.units.filter((actor) => actor.campaignDeploying)) {
      const owner =
        room.seats[G.ownerOf(actor)] || room.seats[C.commander(members(room), actor.team)];
      if (!owner) {
        delete actor.campaignDeploying;
        continue;
      }
      game.campaignBattlefield.deploymentControllers[G.ownerOf(actor)] = owner.seat;
      if (owner.bot || room.campaignBattle?.delegatedSeats.includes(owner.seat))
        delete actor.campaignDeploying;
      else game.deployment[owner.seat] = false;
    }
    room.phase = game.deployment.every(Boolean) ? "idle" : "deployment";
  }
  function finishDeployment(room) {
    if (room.campaignBattle) planner.resumeCharges(room);
  }
  function refreshControl(room) {
    const roster = members(room);
    room.settings.campaignCommanders = [0, 1].map((team) => C.commander(roster, team));
    room.game.campaignControllers = Object.fromEntries(room.seats.map((_, seat) =>
      [seat, C.controller(roster, { ownerSeat: seat, team: G.seatTeam(seat) }) ?? seat]));
    for (const actor of room.game.units) {
      const pending = actor.pendingMove;
      if (pending && !room.seats[pending.seat]) pending.seat = G.controllerOf(room.game, actor);
    }
  }
  function refreshSeats(room) {
    refreshControl(room);
    if (room.phase === "deployment") configureDeployment(room);
    const previous = room.activeSeats || [];
    const completed = room.campaignSeatCompletion || room.seats.map(() => false);
    for (let seat = 0; seat < previous.length; seat++)
      if (previous[seat]) completed[seat] = !!room.turnDone[seat];
    room.campaignSeatCompletion = completed;
    room.activeSeats = eligible(room);
    room.turnDone = room.activeSeats.map((active, seat) => !active || completed[seat]);
  }
  // One regional engagement at a time. Choices belong to this exact queue item,
  // never to a player's next battle or to a client-selected region.
  function preparation(room) {
    const state = room.campaign;
    if (!state || room.started || state.phase !== "encounters") return null;
    const next = state.encounters.find(
      (item) => item.turn < state.turn && C.disputed(state, item.region),
    );
    if (!next) return null;
    let pending = room.campaignPreparation;
    if (!pending || pending.region !== next.region || pending.turn !== state.turn) {
      pending = room.campaignPreparation = {
        id: randomId(),
        region: next.region,
        turn: state.turn,
        choices: {},
        mapId: next.battleSave?.game.mapId || indexedMap(room, next.region),
      };
    }
    const participants = members(room).filter(
      (member) =>
        Number.isInteger(member.seat) &&
        (state.units.some(
          (unit) =>
            !unit.destroyed && unit.region === next.region && unit.ownerSeat === member.seat,
        ) ||
          [0, 1].some((team) => C.commander(members(room), team) === member.seat)),
    );
    const seats = new Set(participants.map((member) => member.seat));
    for (const seat of Object.keys(pending.choices))
      if (!seats.has(Number(seat))) delete pending.choices[seat];
    return {
      ...pending,
      participants: participants.map((member) => ({
        seat: member.seat,
        bot: !!member.bot,
        ready: !!member.bot || Object.hasOwn(pending.choices, member.seat),
        delegate: member.bot || pending.choices[member.seat] === true,
      })),
    };
  }
  function view(room, team = null) {
    if (!room.campaign) return null;
    return {
      ...C.view(room.campaign, team),
      preparation: preparation(room),
      activeRegion: room.campaignBattle?.region || null,
      stopRound: room.campaignBattle?.stopRound || null,
      startRound: room.campaignBattle?.startRound || null,
      delegatedSeats: room.campaignBattle?.delegatedSeats || [],
      commanders: [0, 1].map((team) => C.commander(members(room), team)),
    };
  }
  function battlefieldSave(room, preserveTurnDone = false) {
    const result = Records.createSave(G, room);
    // A local wave ending does not mean the regional campaign battle has ended.
    result.game.winner = null;
    for (const actor of result.game.units)
      if (actor.readySnipe && actor.plan?.charged) actor.plan = null;
    // readySnipe retains the paid shot; the planner reconstructs its queue on re-entry.
    if (preserveTurnDone) result.campaignTurnDone = [...room.turnDone];
    return result;
  }
  function captureArmies(state, encounter, game) {
    const present = new Set(game.units.map((actor) => actor.id));
    for (const [actorId, armyId] of Object.entries(encounter.roster)) {
      if (present.has(actorId)) continue;
      const removed = state.units.find((unit) => unit.id === armyId);
      if (removed && removed.region === encounter.region && !removed.pendingTransfer) {
        removed.destroyed = true;
        if (removed.state) removed.state.hp = 0;
      }
    }
    for (const actor of game.units) {
      let armyId = actor.campaignId || encounter.roster[actor.id];
      if (!armyId) {
        const model = G.modelOf(actor);
        armyId = C.addUnit(
          ctx,
          state,
          G.ownerOf(actor),
          encounter.region,
          model.prefabId,
          model.kitId,
        ).id;
      }
      const unit = state.units.find((unit) => unit.id === armyId);
      check(unit, "局地战单位缺少对应战略部队");
      actor.campaignId = armyId;
      encounter.roster[actor.id] = armyId;
      unit.state = Records.clone(actor);
      unit.stateRound = game.round;
      unit.unitId = G.modelOf(actor).prefabId;
      unit.kitId = G.modelOf(actor).kitId;
      unit.ownerSeat = G.ownerOf(actor);
      unit.team = actor.team;
      unit.destroyed = actor.hp <= 0;
    }
    crews.capture(state, game);
  }
  function save(room) {
    const state = Records.clone(room.campaign);
    if (room.started) {
      check(
        room.phase === "idle" &&
          !room.plans.length &&
          !room.game.units.some((unit) => unit.pendingMove),
        "请在完成当前行动和演出后保存战役",
      );
      const encounter = state.encounters.find((item) => item.region === room.campaignBattle.region);
      encounter.battleSave = battlefieldSave(room, true);
      captureArmies(state, encounter, encounter.battleSave.game);
      state.phase = "encounters";
      // A mid-segment save resumes the remaining rounds, rather than granting a new segment.
      encounter.resumeStopRound = room.campaignBattle.stopRound;
      encounter.resumeStartRound = room.campaignBattle.startRound;
      encounter.delegatedSeats = room.campaignBattle.delegatedSeats || [];
    }
    return state;
  }
  function begin(room, regionId, requestedMap) {
    const state = room.campaign;
    check(state && state.phase === "encounters" && !room.started, "当前不能进入局地战");
    const encounter = state.encounters.find(
      (item) => item.region === regionId && item.turn < state.turn,
    );
    check(encounter && C.disputed(state, regionId), "该区域没有待处理的交战");
    const maps = Object.values(G.catalog.maps).filter(
      (map) =>
        map.environment !== "space" &&
        map.spawns.length === room.seats.length &&
        (!map.supportedModes || map.supportedModes.includes("regular")),
    );
    const mapId =
      encounter.battleSave?.game.mapId || indexedMap(room, regionId) || requestedMap || maps[0]?.id;
    check(
      maps.some((map) => map.id === mapId),
      "请选择适合当前席位数的地面局地战地图",
    );
    const settings = {
      ...G.campaignRoomSettings({ mapId }),
      mapId,
      mode: "campaign",
      costLimit: 99999,
      unitCostLimit: 99999,
      unitLimit: 72,
      fogMode: "full",
      shareAlliedUnits: false,
      campaignCommanders: [0, 1].map((team) => C.commander(members(room), team)),
    };
    let game = encounter.battleSave ? Records.clone(encounter.battleSave.game) : null;
    if (game)
      game.units = game.units.filter((actor) => {
        const unit = state.units.find((unit) => unit.id === actor.campaignId);
        if (!unit) return actor.hp <= 0;
        actor.ownerSeat = unit.ownerSeat;
        actor.team = unit.team;
        return unit.region === regionId;
      });
    const incomingDeployment = [];
    const present = new Set((game?.units || []).map((unit) => unit.campaignId));
    const armies = Array(room.seats.length).fill(null);
    const selected = [];
    const regional = state.units.filter(
      (unit) => !unit.destroyed && !unit.pendingTransfer && unit.region === regionId,
    );
    for (const unit of regional) {
      if (present.has(unit.id) || selected.includes(unit)) continue;
      // Deploy transports and their passengers as one group; never strand hidden cargo.
      const group = new Set([unit]);
      for (const source of group)
        for (const other of regional) {
          if (
            (source.state?.embarked?.carrierId &&
              source.state.embarked.carrierId === other.state?.id) ||
            (other.state?.embarked?.carrierId &&
              other.state.embarked.carrierId === source.state?.id)
          )
            group.add(other);
        }
      const incoming = [...group].filter(
        (source) => !present.has(source.id) && !selected.includes(source),
      );
      const trial = Records.clone(armies);
      let legal = true;
      for (const source of incoming) {
        if (!room.seats[source.ownerSeat] && C.commander(members(room), source.team) === null) {
          legal = false;
          break;
        }
        const entries = trial[source.ownerSeat] || [];
        const profile = crews.find(state, source.team, source.pilotId)?.profile;
        trial[source.ownerSeat] = [
          ...entries,
          {
            unitId: source.unitId,
            kitId: source.kitId,
            ...(profile ? { customPilot: profile } : {}),
          },
        ];
      }
      if (!legal) continue;
      try {
        G.create(false, 1, Records.clone(trial), false, settings);
        for (let seat = 0; seat < armies.length; seat++) armies[seat] = trial[seat];
        selected.push(...incoming);
      } catch {
        /* A group that cannot fit this map remains a regional reserve. */
      }
    }
    const fresh = selected.length
      ? G.create(false, randomSeed(), Records.clone(armies), false, settings)
      : null;
    const incoming = fresh?.units.slice() || [];
    if (!game) {
      check(
        fresh && [0, 1].every((team) => fresh.units.some((unit) => unit.team === team)),
        "当前地图无法部署双方部队，请选择其他地图",
      );
      game = fresh;
      game.units = [];
    }
    if (indexedMap(room, regionId) === mapId) {
      if (!game.campaignBattlefield)
        game.campaignBattlefield = G.campaignBattlefield.create(
          G,
          state,
          regionId,
          state.scenarioId || "earth_0079_mid",
        );
      game.campaignBattlefield.defender = state.regions.find(
        (region) => region.id === regionId,
      ).owner;
      game.campaignBattlefield.capturedBaseTeam = null;
      for (const gate of game.campaignBattlefield.layout.gates)
        game.campaignBattlefield.adjacentOwners[gate.region] = state.regions.find(
          (region) => region.id === gate.region,
        ).owner;
      game.campaignBattlefield.version++;
    }
    for (const actor of incoming) {
      const sameOwner = selected.filter((unit) => unit.ownerSeat === G.ownerOf(actor));
      const source = sameOwner[Number(actor.id.split("-")[1])];
      if (!source) continue;
      const preserved = source.state;
      if (preserved) {
        const fresh = {
          x: actor.x,
          y: actor.y,
          angle: actor.angle,
          actionPoints: actor.actionPoints,
          environment: actor.environment,
        };
        const saved = Records.clone(preserved);
        const delta = game.round - (source.stateRound || game.round);
        const rebase = (value, parentKey = "") => {
          for (const [key, child] of Object.entries(value)) {
            if (child && typeof child === "object") rebase(child, key);
            else if (
              Number.isFinite(child) &&
              (key.endsWith("Round") || parentKey === "skillReadyRound")
            )
              value[key] = Math.max(0, child + delta);
          }
        };
        rebase(saved);
        Object.assign(actor, saved, fresh, {
          acted: false,
          moved: false,
          plan: null,
          counterCount: 0,
        });
        for (const key of [
          "pendingMove",
          "origin",
          "readySnipe",
          "readySnipes",
          "counterTargetId",
          "pilotWeaponTurnUses",
        ])
          delete actor[key];
      }
      actor.campaignDurability = G.aiTactics.settings(state.options).teams[source.team].durability;
      if (!preserved) actor.hp = Math.ceil(actor.hp * actor.campaignDurability);
      actor.id = source.state?.id || source.ownerSeat + "-" + source.id.split("-")[1];
      actor.ownerSeat = source.ownerSeat;
      actor.team = source.team;
      actor.campaignId = source.id;
      if (source.entryFrom) actor.campaignEntry = source.entryFrom;
      if (game.campaignBattlefield) {
        const candidates = G.campaignBattlefield.deploymentCells(G, game, actor, source.entryFrom);
        const area = new Set(candidates.map((cell) => G.key(cell.x, cell.y)));
        const position = candidates.find((cell) =>
          G.fits(game, actor, cell.x, cell.y, actor.angle, false, source.ownerSeat, area),
        );
        if (!position) continue;
        actor.x = position.x;
        actor.y = position.y;
      }
      if (game.units.length && !G.fits(game, actor, actor.x, actor.y, actor.angle)) {
        const cell = G.deploymentCells(game, source.ownerSeat, actor).find((cell) =>
          G.fits(game, actor, cell.x, cell.y, actor.angle),
        );
        if (!cell) continue;
        actor.x = cell.x;
        actor.y = cell.y;
      }
      if (!game.units.some((unit) => unit.campaignId === source.id)) {
        if (game.campaignBattlefield) actor.campaignDeploying = true;
        game.units.push(actor);
        incomingDeployment.push(actor);
      }
      encounter.roster[actor.id] = source.id;
    }
    G.hangars.sync(game);
    check(
      [0, 1].every((team) => game.units.some((unit) => unit.team === team && unit.hp > 0)),
      "双方都需要可部署的存活单位",
    );
    settings.campaignOptions = G.aiTactics.settings(state.options);
    game.aiOptions = settings.campaignOptions;
    room.settings = settings;
    room.game = game;
    room.game.winner = null;
    room.started = true;
    room.startedFromSave = true; // Suppress ordinary account rewards; campaign income is settled separately.
    room.resumeSave = null;
    room.matchId = randomId();
    room.phase = "idle";
    room.campaignBattle = {
      region: regionId,
      stopRound: Math.min(encounter.resumeStopRound ?? Infinity, game.round + state.rounds),
      startRound: encounter.resumeStartRound ?? game.round,
      delegatedSeats: Object.entries(room.campaignPreparation?.choices || {})
        .filter(([, delegated]) => delegated)
        .map(([owner]) => Number(owner)),
    };
    refreshControl(room);
    if (game.campaignBattlefield) configureDeployment(room);
    delete encounter.resumeStopRound;
    delete encounter.resumeStartRound;
    room.campaignPreparation = null;
    room.activeSeats = eligible(room);
    resetTurns(room);
    if (encounter.battleSave?.campaignTurnDone)
      room.turnDone = room.turnDone.map(
        (done, seat) => done || encounter.battleSave.campaignTurnDone[seat],
      );
    room.turnNotBefore = 0;
    room.returnAt = room.returnCountdown = room.playback = room.battle = null;
    room.log = Records.clone(encounter.battleSave?.log || []);
    room.teamLogs = Records.clone(encounter.battleSave?.teamLogs || {});
    room.logNames = Records.clone(encounter.battleSave?.logNames || []);
    room.logTeamIds = [0, 1];
    const directionNames = { west: "西", east: "东", north: "北", south: "南" };
    for (const actor of incomingDeployment) {
      const gate = game.campaignBattlefield?.layout.gates.find((gate) => gate.region === actor.campaignEntry);
      const origin = ctx.world.regions.find((region) => region.id === actor.campaignEntry)?.name;
      const source = gate ? `${origin || gate.region}（${directionNames[gate.side]}方向）` : "本区域据点";
      log(room, `${G.unitLogName(actor)} 从${source}部署。`, { teams: [actor.team] });
    }
    room.techAwards = [];
    room.economyAwards = [];
    room.pilotAwards = [];
    room.playerDamage = {};
    room.pilotDamage = {};
    room.battleRoster = {};
    room.teamDestroyedCost = [0, 0];
    room.economySettled = false;
    room.record = null;
    room.turnSave = null;
    room.saveTurn = null;
    planner.reset(room);
    if (room.phase === "idle" && game.round < room.campaignBattle.stopRound)
      planner.resumeCharges(room);
    log(
      room,
      "战略局地战：" +
        ctx.world.regions.find((region) => region.id === regionId).name +
        "，本阶段最多" +
        state.rounds +
        "回合。",
    );
    if (game.round >= room.campaignBattle.stopRound && pauseBattle) pauseBattle(room);
  }
  function checkpoint(room) {
    const state = room.campaign,
      encounter = state.encounters.find((item) => item.region === room.campaignBattle.region);
    captureArmies(state, encounter, room.game);
    const settled = new Set(encounter.settled);
    // Local battles persist losses and crew experience, but award no resources or technology.
    for (const actor of room.game.units) {
      const campaignId = actor.campaignId || encounter.roster[actor.id];
      const unit = state.units.find((unit) => unit.id === campaignId);
      if (unit?.destroyed) settled.add(unit.id);
    }
    encounter.settled = [...settled];
    delete encounter.delegatedSeats;
    encounter.turn = state.turn;
    const region = state.regions.find((region) => region.id === encounter.region);
    const captured = room.game.campaignBattlefield?.capturedBaseTeam;
    if ([0, 1].includes(captured)) region.owner = captured;
    if (!C.disputed(state, encounter.region)) {
      const survivor = state.units.find((unit) => !unit.destroyed && unit.region === region.id);
      if (survivor) region.owner = survivor.team;
      state.encounters = state.encounters.filter((item) => item !== encounter);
    } else {
      encounter.battleSave = battlefieldSave(room);
    }
    state.history.push(
      ctx.world.regions.find((item) => item.id === region.id).name +
        "：局地战阶段结束，已保留战场与损伤",
    );
    state.history = state.history.slice(-100);
    if (
      !state.encounters.some((item) => C.disputed(state, item.region) && item.turn < state.turn)
    ) {
      state.phase = "strategy";
      state.turn++;
      C.arrive(ctx, state);
    }
    if (new Set(state.regions.map((region) => region.owner)).size === 1)
      state.winner = state.regions[0].owner;
    room.started = false;
    room.startedFromSave = false;
    room.phase = "waiting";
    room.campaignBattle = null;
    room.playback = null;
    room.returnCountdown = null;
    room.activeSeats = room.seats.map(() => false);
    planner.reset(room);
    return { type: "campaign_checkpoint" };
  }
  function transfer(room, actor, regionId) {
    check(
      room.campaignBattle &&
        G.campaignBattlefield.exits(G, room.game, actor).some((gate) => gate.region === regionId),
      "单位不在该区块的边缘补给线出口附近",
    );
    const encounter = room.campaign.encounters.find(
      (item) => item.region === room.campaignBattle.region,
    );
    const departing = new Set([actor]);
    for (const carrier of departing)
      for (const passenger of room.game.units)
        if (passenger.hp > 0 && passenger.embarked?.carrierId === carrier.id)
          departing.add(passenger);
    crews.capture(room.campaign, { units: [...departing] });
    for (const unit of departing) {
      const source = room.campaign.units.find((item) => item.id === unit.campaignId);
      check(source, "转移部队缺少战略记录");
      source.state = Records.clone(unit);
      source.state.actionPoints = 0;
      source.stateRound = room.game.round;
      source.pendingTransfer = {
        from: source.region,
        to: regionId,
        arriveTurn: room.campaign.turn + 1,
      };
      delete encounter.roster[unit.id];
      room.game.units = room.game.units.filter((item) => item !== unit);
      log(
        room,
        C.unitLabel(ctx, source) +
          " 转移至 " +
          ctx.world.regions.find((region) => region.id === regionId).name +
          "，下一战略回合抵达。",
        { teams: [unit.team] },
      );
    }
    const alive = [0, 1].map((team) =>
      room.game.units.some((unit) => unit.hp > 0 && unit.team === team),
    );
    if (!alive[0] || !alive[1]) room.game.winner = alive[0] ? 0 : 1;
    return { type: "region_transfer", unitId: actor.id, region: regionId };
  }
  function freeze(room) {
    const encounter = room.campaign.encounters.find(
      (item) => item.region === room.campaignBattle.region,
    );
    encounter.battleSave = battlefieldSave(room);
    captureArmies(room.campaign, encounter, encounter.battleSave.game);
  }
  function boundary(room) {
    if (!room.campaignBattle) return null;
    if (room.game.winner !== null || room.game.round >= room.campaignBattle.stopRound)
      return pauseBattle ? pauseBattle(room) : checkpoint(room);
    resetTurns(room);
    return null;
  }
  function start(room, member, rounds) {
    check(
      member.id === room.hostId &&
        room.settings.mode === "campaign" &&
        !room.started &&
        !room.campaign,
      "只有房主可开始战略模式房间",
    );
    room.campaign = C.create(ctx, members(room), { rounds, campaignOptions: room.settings.campaignOptions });
    bindTeams(room);
  }
  function handle(room, member, msg) {
    check(room.settings.mode === "campaign", "请先选择战略模式房间");
    check(member.id === room.hostId || room.campaign, "当前没有战役");
    if (msg.action === "campaign_import_begin") {
      check(
        member.id === room.hostId &&
          !room.started &&
          Number.isSafeInteger(msg.length) &&
          msg.length > 0 &&
          msg.length < 16 * 1024 * 1024,
        "战役导入无效",
      );
      member.campaignUpload = { text: "", length: msg.length, sequence: 0 };
      return { quiet: true };
    }
    if (msg.action === "campaign_import_chunk") {
      const upload = member.campaignUpload;
      check(
        member.id === room.hostId &&
          !room.started &&
          upload &&
          msg.sequence === upload.sequence &&
          typeof msg.text === "string" &&
          msg.text.length <= 10000 &&
          upload.text.length + msg.text.length <= upload.length,
        "战役上传片段无效",
      );
      upload.text += msg.text;
      upload.sequence++;
      return { quiet: true };
    }
    if (msg.action === "campaign_import_finish") {
      const upload = member.campaignUpload;
      check(
        member.id === room.hostId &&
          !room.started &&
          upload &&
          upload.text.length === upload.length,
        "战役上传未完成",
      );
      const input = JSON.parse(upload.text, (key, value) => {
        check(!["__proto__", "constructor", "prototype"].includes(key), "存档字段无效");
        return value;
      });
      room.campaign = C.validate(ctx, input, members(room));
      room.settings.campaignOptions = G.aiTactics.settings(room.campaign.options);
      bindTeams(room);
      room.campaignPreparation = null;
      member.campaignUpload = null;
      return;
    }
    check(room.campaign, "请先创建或导入战役");
    if (msg.action === "campaign_delegate") {
      check(room.started && room.campaignBattle && room.game.winner === null, "当前没有进行中的局地战");
      check(Number.isInteger(member.seat) && room.seats[member.seat] === member && !member.bot,
        "只有参战玩家可切换自己的AI委任");
      check(typeof msg.delegate === "boolean", "AI委任状态无效");
      const seats = new Set(room.campaignBattle.delegatedSeats || []);
      if (msg.delegate) seats.add(member.seat);
      else seats.delete(member.seat);
      room.campaignBattle.delegatedSeats = [...seats];
      const wasDeploying = room.phase === "deployment";
      if (wasDeploying) {
        configureDeployment(room);
        if (room.phase === "idle") finishDeployment(room);
      }
      log(room, `${member.name} ${msg.delegate ? "开启" : "关闭"}AI委任（本阶段）。`,
        { teams: [G.seatTeam(member.seat)] });
      return;
    }
    if (msg.action === "campaign_export") {
      check(member.id === room.hostId, "战役存档由房主保管");
      return { quiet: true, save: save(room) };
    }
    if (msg.action === "campaign_enter") {
      const pending = preparation(room);
      check(
        pending && msg.preparationId === pending.id && msg.region === pending.region,
        "本场局地战准备已变化",
      );
      check(
        pending.participants.some((player) => player.seat === member.seat && !player.bot),
        "观战者不能确认参战",
      );
      check(typeof msg.delegate === "boolean", "请选择AI委任或手动指挥");
      const maps = Object.values(G.catalog.maps).filter(
        (map) =>
          map.environment !== "space" &&
          map.spawns.length === room.seats.length &&
          (!map.supportedModes || map.supportedModes.includes("regular")),
      );
      const mapId = pending.mapId || msg.mapId || maps[0]?.id;
      check(
        maps.some((map) => map.id === mapId),
        "局地战地图无效",
      );
      check(!pending.mapId || !msg.mapId || pending.mapId === msg.mapId, "本场局地战地图已确定");
      const previous = { ...room.campaignPreparation.choices };
      room.campaignPreparation.mapId = mapId;
      room.campaignPreparation.choices[member.seat] = msg.delegate;
      const ready = preparation(room);
      if (ready.participants.every((player) => player.ready)) {
        try {
          begin(room, pending.region, mapId);
        } catch (error) {
          room.campaignPreparation.choices = previous;
          if (!Object.keys(previous).length) room.campaignPreparation.mapId = null;
          throw error;
        }
      }
      return;
    }
    check(!room.started, "请先完成当前局地战阶段");
    C.action(ctx, room.campaign, members(room), member.seat, msg);
  }
  return {
    start,
    handle,
    view,
    boundary,
    checkpoint,
    freeze,
    transfer,
    resetTurns,
    refreshSeats,
    refreshControl,
    finishDeployment,
    preparation,
    controls: (room, seat, actor) =>
      actor &&
      room.campaign &&
      C.controls(room.campaign, members(room), seat, {
        ownerSeat: G.ownerOf(actor),
        team: actor.team,
      }),
  };
}
if (typeof module !== "undefined") module.exports = { createCampaignRoom };
