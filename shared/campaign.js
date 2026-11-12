/* Persistent Earth campaign. Clients submit orders; this module owns resources and armies. */
"use strict";
const CampaignRules = (() => {
  const pricing = typeof Economy !== "undefined" ? Economy : require("./economy.js");
  const rewards = typeof BattleEconomy !== "undefined" ? BattleEconomy : require("./battle-economy.js");
  const crews =
    typeof CampaignPilots !== "undefined" ? CampaignPilots : require("./campaign-pilots.js");
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const teamOf = (seat) => seat % 2;
  const intelligenceRules = Object.freeze({ initial: 50, price: 2000, gain: 30, decay: 15 });
  const intelligenceOf = (pool) =>
    pool.intelligence || { progress: intelligenceRules.initial, fundedTurn: 0 };
  // A report stays stable within a strategic turn, so reopening it cannot average away its error.
  function intelligenceCount(count, progress, key) {
    if (progress < 25) return null;
    if (progress >= 75 || count === 0) return count;
    const error = progress >= 50 ? 0.25 : 0.5;
    let hash = 2166136261;
    for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    const low = Math.max(1, Math.ceil(count * (1 - error)));
    const high = Math.floor(count * (1 + error));
    return low + ((hash >>> 0) % (high - low + 1));
  }
  function commander(members, team) {
    return (
      members
        .filter((member) => Number.isInteger(member.seat) && teamOf(member.seat) === team)
        .sort((a, b) => a.seat - b.seat)[0]?.seat ?? null
    );
  }
  function controller(members, unit) {
    const owner = members.find((member) => member.seat === unit.ownerSeat && teamOf(member.seat) === unit.team);
    return owner ? owner.seat : commander(members, unit.team);
  }
  function controls(state, members, seat, unit) {
    return (
      Number.isInteger(seat) &&
      !unit.pendingTransfer &&
      unit.team === teamOf(seat) &&
      (unit.ownerSeat === seat || commander(members, unit.team) === seat)
    );
  }
  function model(ctx, unit) {
    const base = ctx.G.models[unit.unitId + "__" + unit.kitId],
      factor = unit.campaignDurability ?? unit.state?.campaignDurability ?? 1;
    return !base || factor === 1 ? base : { ...base, hp: Math.ceil(base.hp * factor) };
  }
  function quote(ctx, unitId, kitId = ctx.production.defaultKits[unitId]) {
    const prefab = ctx.G.catalog.prefabs.find((item) => item.id === unitId);
    if (!prefab?.weaponKits.some((kit) => kit.id === kitId) || !ctx.G.models[unitId + "__" + kitId])
      return null;
    // Campaigns use the same per-chassis and absolute kit prices, without licenses.
    return pricing.productionOffer(unitId, kitId, ctx.production, ctx.G.models);
  }

  function dismissalQuote(ctx, unit) {
    const prefab = ctx.G.catalog.prefabs.find((item) => item.id === unit.unitId);
    const base = unit.pilotBase || { unitId: prefab?.formOf || unit.unitId, kitId: unit.kitId };
    const price = quote(ctx, base.unitId, base.kitId) || quote(ctx, base.unitId);
    return price && {
      money: Math.floor(price.money / price.quantity / 2),
      supplies: Math.floor(price.supplies / price.quantity / 2),
    };
  }
  function canDismiss(ctx, state, members, seat, unit) {
    return !!(unit && !unit.destroyed && state.phase === "strategy" && state.winner === null &&
      !state.ready.includes(seat) && controls(state, members, seat, unit) &&
      !unit.pendingTransfer && !unit.moveTo && !busy(state, unit) &&
      !state.transfers.some((transfer) => transfer.ids.includes(unit.id)) &&
      !state.units.some((other) => !other.destroyed && (other.carrierArmyId === unit.id ||
        (unit.state?.id && other.state?.embarked?.carrierId === unit.state.id))) &&
      dismissalQuote(ctx, unit));
  }
  function updateSavedArmy(state, unit) {
    if (!unit.state) return;
    for (const encounter of state.encounters) {
      const game = encounter.battleSave?.game;
      const actor = game?.units.find((item) => item.campaignId === unit.id);
      if (!actor) continue;
      const position = { id: actor.id, x: actor.x, y: actor.y, angle: actor.angle };
      Object.assign(actor, copy(unit.state), position);
      if (!unit.state.embarked) delete actor.embarked;
    }
  }
  function equipmentQuote(ctx, unit, kitId) {
    const prefab = ctx.G.catalog.prefabs.find((item) => item.id === unit.unitId);
    if (
      !prefab?.weaponKits.some((kit) => kit.id === kitId) ||
      !ctx.G.models[unit.unitId + "__" + kitId]
    )
      return null;
    return {money:0,supplies:0};
  }
  function available(ctx, state, team, unitId, kit = ctx.production.defaultKits[unitId]) {
    const faction = state.teams[team].faction;
    const prefab = ctx.G.catalog.prefabs.find((item) => item.id === unitId);
    const m = ctx.G.models[unitId + "__" + kit];
    return !!(
      prefab &&
      m &&
      !prefab.disabled &&
      !prefab.formOnly &&
      ctx.development.allowsPointCaps(unitId, ctx.technologyCaps) &&
      (prefab.availableFactions || [prefab.faction]).includes(faction) &&
      prefab.production?.enabled !== false &&
      !m.requiredPilotId &&
      m.adaptability.ground > 0 &&
      quote(ctx, unitId, kit) &&
      ctx.development
        .nodes(faction)
        .some(
          (node) => state.teams[team].researched.includes(node.id) && node.unlocks.includes(unitId),
        )
    );
  }
  function addUnit(ctx, state, ownerSeat, region, unitId, kitId) {
    check(state.units.length < 5000, "战役单位数量已达上限");
    const unit = {
      id: "army-" + state.nextId++,
      ownerSeat,
      team: teamOf(ownerSeat),
      campaignDurability: state.options?.teams[teamOf(ownerSeat)]?.durability ?? 1,
      region,
      unitId,
      kitId: kitId || ctx.production.defaultKits[unitId],
      moveTo: null,
      state: null,
      destroyed: false,
    };
    check(model(ctx, unit), "战役单位不存在");
    state.units.push(unit);
    return unit;
  }
  function saveName(value, fallback) {
    check(
      value === undefined ||
        (typeof value === "string" &&
          value.trim().length > 0 &&
          value.length <= 80 &&
          !/[\u0000-\u001f\u007f]/.test(value)),
      "战役存档名称无效",
    );
    return value?.trim() || fallback || "战略战役";
  }
  function create(ctx, members, options = {}) {
    const rounds = Number(options.rounds ?? 10);
    check(integer(rounds, 1, 10), "局地战回合数应为1至10");
    const state = {
      format: "ProjectGreed-campaign",
      version: 1,
      options: ctx.G.aiTactics.settings(options.campaignOptions),
      scenarioId: options.scenarioId || ctx.scenarioId || "earth_0079_mid",
      name: saveName(options.name, ctx.world.name),
      geographyVersion: ctx.world.geographyVersion || 1,
      turn: 1,
      phase: "strategy",
      rounds,
      nextId: 1,
      winner: null,
      ready: [],
      units: [],
      pilots: [],
      orders: [],
      transfers: [],
      encounters: [],
      battleLogs: {},
      marches: [],
      history: [],
      regions: ctx.world.regions.map((region) => ({ id: region.id, owner: region.owner })),
      teams: ["EFSF", "ZEON"].map((faction, team) => ({
        faction,
        intelligence: { progress: intelligenceRules.initial, fundedTurn: 0 },
        researchQueue: [],
        kits: {},
        money: Math.floor(ctx.world.settings.startingMoney * ctx.G.aiTactics.settings(options.campaignOptions).teams[team].resources),
        supplies: Math.floor(ctx.world.settings.startingSupplies * ctx.G.aiTactics.settings(options.campaignOptions).teams[team].resources),
        technology: ctx.world.settings.startingTechnology,
        researched: ctx.development
          .nodes(faction)
          .filter((node) => !node.requires.length)
          .map((node) => node.id),
      })),
    };
    for (const region of ctx.world.regions) {
      const players = members
        .filter((member) => member.seat !== null && teamOf(member.seat) === region.owner)
        .sort((a, b) => a.seat - b.seat);
      check(players.length, "两个阵营都需要玩家或AI");
      const owner = players[ctx.world.regions.indexOf(region) % players.length];
      const faction = state.teams[region.owner].faction;
      const coreRoster = region.factory && ctx.world.settings.initialCoreForces?.[faction];
      const roster = coreRoster || ctx.world.settings.initialForces?.[faction];
      if (roster) {
        for (const [unitId, count] of Object.entries(roster))
          for (let i = 0; i < count * (region.factory && !coreRoster ? 3 : 1); i++)
            addUnit(ctx, state, owner.seat, region.id, unitId);
      } else {
        const ids = region.owner === 0 ? ["Type61", "FF_B2"] : ["MS_06F", "MS_06J"];
        for (let i = 0; i < (region.initialUnits ?? (region.factory ? 4 : 2)); i++)
          addUnit(ctx, state, owner.seat, region.id, ids[i % ids.length]);
      }
    }
    // Use the same type/capacity validation as manual strategic boarding.
    for (const unit of state.units) {
      const option = embarkOptions(ctx, state, unit).find((option) =>
        ["Medea", "FatUncle"].includes(state.units.find((carrier) => carrier.id === option.carrierId)?.unitId));
      if (!option) continue;
      const carrier = state.units.find((carrier) => carrier.id === option.carrierId);
      const actor = ensureArmyState(ctx, state, unit), parent = ensureArmyState(ctx, state, carrier);
      actor.embarked = { carrierId: parent.id, hangarId: option.hangarId, boardRound: null };
      actor.x = parent.x; actor.y = parent.y;
    }
    return state;
  }
  function disputed(state, id) {
    if (state.intelRegions)
      return !!state.intelRegions.find((region) => region.id === id)?.contested;
    return (
      new Set(
        state.units
          .filter((unit) => !unit.destroyed && !unit.pendingTransfer && unit.region === id)
          .map((unit) => unit.team),
      ).size > 1
    );
  }
  function busy(state, unit) {
    return state.encounters.some(
      (encounter) => encounter.region === unit.region && encounter.turn === state.turn,
    );
  }
  function canRedeploy(state, unit) {
    return !!unit && !unit.destroyed && !unit.pendingTransfer &&
      !busy(state, unit) && !disputed(state, unit.region);
  }
  function charge(team, price) {
    if (team.money < price.money || team.supplies < price.supplies) return false;
    team.money -= price.money;
    team.supplies -= price.supplies;
    return true;
  }
  function clearReady(state, seat) {
    state.ready = state.ready.filter((item) => item !== seat);
  }
  function transportGroup(state, units) {
    const result = new Set(units);
    for (const unit of result) {
      const carrierId = unit.state?.embarked?.carrierId;
      if (carrierId) {
        const carrier = state.units.find(
          (item) => !item.destroyed && item.region === unit.region && item.state?.id === carrierId,
        );
        check(carrier, "搭载关系无效，请先恢复局地战处理");
        result.add(carrier);
      }
      for (const passenger of state.units.filter(
        (item) =>
          !item.destroyed &&
          item.region === unit.region &&
          unit.state?.id &&
          item.state?.embarked?.carrierId === unit.state.id,
      ))
        result.add(passenger);
    }
    return [...result];
  }
  function unitLabel(ctx, unit) {
    return ctx.G.unitLogName({ model: unit.unitId + "__" + unit.kitId, campaignId: unit.id });
  }
  function recordOrder(ctx, state, members, seat, command, previous = {}) {
    const player = members.find((member) => member.seat === seat)?.name || "玩家" + (seat + 1);
    const regionName = (id) => ctx.world.regions.find((region) => region.id === id)?.name || id;
    const unit = state.units.find((unit) => unit.id === command.armyId);
    const name = unit ? unitLabel(ctx, unit) : "";
    const references = (ids) =>
      [...new Set(ids || [])]
        .map((id) => state.units.find((unit) => unit.id === id))
        .filter(Boolean)
        .map((unit) => unitLabel(ctx, unit))
        .join("、");
    let text;
    switch (command.action) {
      case "campaign_intelligence":
        text =
          "投入谍报资金：" +
          intelligenceRules.price +
          " · 情报进度 " +
          intelligenceOf(state.teams[seat % 2]).progress +
          "%";
        break;
      case "campaign_produce": {
        const order = state.orders.at(-1);
        text = `生产 ${model(ctx, order).name} ×${order.quantity} · ${regionName(order.region)} · 资金 ${order.money} / 物资 ${order.supplies} · ${order.reserved ? "已下单" : "等待资源"}`;
        break;
      }
      case "campaign_cancel_order":
        text =
          "取消生产订单：" +
          (previous.orderName || "") +
          (previous.orderQuantity ? " ×" + previous.orderQuantity : "");
        break;
      case "campaign_move":
        text = command.region
          ? `调动 ${command.ids.length} 台部队 → ${regionName(command.region)}：${references(command.ids)}`
          : `撤销 ${command.ids.length} 台部队的调动：${references(command.ids)}`;
        break;
      case "campaign_research":
        text =
          "开发科技：" +
          ctx.development
            .nodes(state.teams[seat % 2].faction)
            .find((node) => node.id === command.techId)?.name;
        break;
      case "campaign_embark":
        text = `${name} 搭乘 ${unitLabel(ctx, state.units.find((unit) => unit.id === command.carrierId))} · ${command.hangarId}`;
        break;
      case "campaign_dismiss":
        text = `出售／解散：${previous.unitName} · 返还资金 ${previous.refund.money}、物资 ${previous.refund.supplies}`;
        break;
      case "campaign_disembark":
        text = `${name} 离开格纳库`;
        break;
      case "campaign_equip":
        text = "更换装备：" + name;
        break;
      case "campaign_unit_skill":
        text = "使用机体技能：" + name + (previous.skillName ? " · " + previous.skillName : "");
        break;
      case "campaign_transfer":
        text = `申请转交 ${command.ids.length} 台部队 → ${members.find((member) => member.seat === command.to)?.name || "玩家" + (command.to + 1)}：${references(command.ids)}`;
        break;
      case "campaign_accept_transfer":
        text =
          (command.accept ? "接受部队控制权转交：" : "拒绝部队控制权转交：") +
          references(previous.unitIds);
        break;
      default: {
        if (!command.action.startsWith("campaign_pilot_")) return;
        const labels = {
          recruit: "招募驾驶员",
          assign: "配属驾驶员",
          train: "强化驾驶员",
          upgrade: "驾驶员升职",
          reincarnate: "驾驶员转生",
          demote: "驾驶员降职",
          reset: "重置驾驶员",
          skill: "学习驾驶员技能",
        };
        const kind = command.action.slice("campaign_pilot_".length);
        const crew = command.aceId
          ? crews.find(state, seat % 2, "ace-" + command.aceId)
          : crews.find(state, seat % 2, command.pilotId);
        text =
          (labels[kind] || "驾驶员操作") +
          "：" +
          (crew?.profile.name || (kind === "recruit" ? state.pilots.at(-1)?.profile.name : name));
        if (kind === "assign") {
          text =
            command.pilotId === null
              ? `取消配属：${previous.pilotName || "默认驾驶员"} ← ${name}`
              : `配属驾驶员：${crew.profile.name} → ${name}` +
                (previous.pilotName && previous.pilotName !== crew.profile.name
                  ? ` · 原驾驶员：${previous.pilotName}`
                  : "");
        } else if (crew) {
          const attached = crews.assigned(state, crew);
          text += attached ? " · 配属单位：" + unitLabel(ctx, attached) : " · 未配属";
        }
      }
    }
    state.history.push(`战略第${state.turn}回合 · 队伍${(seat % 2) + 1} · ${player}：${text}`);
    state.history = state.history.slice(-100);
  }
  function action(ctx, state, members, seat, command) {
    check(
      Number.isInteger(seat) && members.some((member) => member.seat === seat),
      "观战者不能下达战役命令",
    );
    check(state.phase === "strategy" && state.winner === null, "当前不在战略指令阶段");
    check(command.turn === state.turn, "战略回合已变化，请重新下达命令");
    check(!state.ready.includes(seat) || command.action === "campaign_ready", "已确认结束回合，正在等待其他玩家思考");
    const team = teamOf(seat),
      pool = state.teams[team];
    const getUnit = (id) => {
      const unit = state.units.find((item) => item.id === id && !item.destroyed);
      check(unit && controls(state, members, seat, unit), "无权指挥这支部队");
      return unit;
    };
    if (command.action.startsWith("campaign_pilot_")) {
      const army = state.units.find((unit) => unit.id === command.armyId);
      const previous = {
        pilotName: army ? crews.find(state, army.team, army.pilotId)?.profile.name : null,
      };
      crews.action({ ...ctx, controls }, state, members, seat, command);
      recordOrder(ctx, state, members, seat, command, previous);
      clearReady(state, seat);
      return;
    }
    const previous = {};
    switch (command.action) {
      case "campaign_intelligence": {
        const intel = intelligenceOf(pool);
        check(intel.fundedTurn !== state.turn, "本回合已投入谍报资金");
        check(intel.progress < 100, "情报进度已满");
        check(pool.money >= intelligenceRules.price, "资金不足");
        pool.money -= intelligenceRules.price;
        pool.intelligence = {
          progress: Math.min(100, intel.progress + intelligenceRules.gain),
          fundedTurn: state.turn,
        };
        break;
      }
      case "campaign_dismiss": {
        const unit = getUnit(command.armyId);
        check(canDismiss(ctx, state, members, seat, unit), "当前不能出售／解散：请先完成调动、交战、转交或清空格纳库");
        previous.refund = dismissalQuote(ctx, unit);
        previous.unitName = unitLabel(ctx, unit);
        pool.money += previous.refund.money;
        pool.supplies += previous.refund.supplies;
        state.units = state.units.filter((item) => item !== unit);
        state.marches = (state.marches || []).filter((march) => march.armyId !== unit.id);
        for (const encounter of state.encounters) {
          const game = encounter.battleSave?.game;
          if (game) game.units = game.units.filter((actor) => actor.campaignId !== unit.id && actor.id !== unit.state?.id);
          for (const [id, armyId] of Object.entries(encounter.roster || {}))
            if (armyId === unit.id) delete encounter.roster[id];
          encounter.settled = (encounter.settled || []).filter((id) => id !== unit.id);
        }
        break;
      }
      case "campaign_embark": {
        const unit = getUnit(command.armyId), carrier = getUnit(command.carrierId);
        check(!state.transfers.some((transfer) => transfer.ids.includes(unit.id) || transfer.ids.includes(carrier.id)), "请先完成控制权转交");
        const option = embarkOptions(ctx, state, unit).find((item) => item.carrierId === carrier.id && item.hangarId === command.hangarId);
        check(option, "无法搭载：区域、状态、类型或容量不满足");
        const actor = ensureArmyState(ctx, state, unit), parent = ensureArmyState(ctx, state, carrier);
        const hangar = model(ctx, carrier).hangars.find((item) => item.id === option.hangarId);
        actor.embarked = {carrierId:parent.id, hangarId:hangar.id, boardRound:null, ...(hangar.kind === "sfs" ? {exposed:true} : {})};
        actor.x = parent.x; actor.y = parent.y;
        updateSavedArmy(state, carrier); updateSavedArmy(state, unit);
        break;
      }
      case "campaign_disembark": {
        const unit = getUnit(command.armyId);
        check(unit.state?.embarked && !unit.moveTo && !busy(state, unit), "当前不能离开格纳库");
        const carrier = state.units.find((item) => !item.destroyed && item.state?.id === unit.state.embarked.carrierId);
        check(carrier && !carrier.state?.embarked && controls(state, members, seat, carrier) && !carrier.moveTo, "请先取消运输单位调动或由其控制者操作");
        const positions = [];
        for (const encounter of state.encounters) {
          const game = encounter.battleSave?.game;
          const actor = game?.units.find((item) => item.campaignId === unit.id);
          if (!actor?.embarked) continue;
          const cell = ctx.G.hangars.launchCells(game, actor, true)[0];
          check(cell, "当前战场没有可离舰的位置");
          positions.push({actor, cell});
        }
        delete unit.state.embarked;
        updateSavedArmy(state, unit);
        for (const {actor, cell} of positions) {
          actor.x = cell.x; actor.y = cell.y;
          unit.state.x = cell.x; unit.state.y = cell.y;
        }
        break;
      }
      case "campaign_equip": {
        const unit = getUnit(command.armyId);
        check(
          !busy(state, unit) &&
            !unit.moveTo &&
            !state.transfers.some((item) => item.ids.includes(unit.id)),
          "请先完成调动、交战或转交",
        );
        check(command.kitId !== unit.kitId && !unit.state?.embarked, "当前不能更换该套件");
        const price = equipmentQuote(ctx, unit, command.kitId);
        check(price, "该套件暂不可换装");
        const before = model(ctx, unit),
          after = ctx.G.models[unit.unitId + "__" + command.kitId];
        check(
          !state.units.some(
            (other) =>
              !other.destroyed &&
              unit.state?.id &&
              other.state?.embarked?.carrierId === unit.state.id,
          ),
          "请先让搭载部队离舰再换装",
        );
        if (unit.state) {
          unit.state.model = unit.unitId + "__" + command.kitId;
          // Re-equipping never repairs damage, restores energy or resets limited weapons.
          for (const field of ["hp", "en"])
            unit.state[field] = Math.min(
              after[field],
              Math.floor(
                before[field] > 0 ? (unit.state[field] / before[field]) * after[field] : 0,
              ),
            );
          unit.state.shield = Math.min(unit.state.shield || 0, after.shield.hp);
          delete unit.state.heldWeapon;
          delete unit.state.weaponDisplayIndex;
          delete unit.state.defaultFormModel;
          delete unit.state.plan;
        }
        unit.kitId = command.kitId;
        if (unit.pilotBase) {
          const base = ctx.G.models[unit.pilotBase.unitId + "__" + unit.pilotBase.kitId];
          const form = base?.pilotForms?.find((form) => form.unitId === unit.unitId);
          const baseKit = Object.entries(form?.kitMap || {}).find(
            ([, target]) => target === command.kitId,
          )?.[0];
          if (baseKit) unit.pilotBase.kitId = baseKit;
        }
        updateSavedArmy(state, unit);
        break;
      }
      case "campaign_unit_skill": {
        const unit = getUnit(command.armyId);
        check(
          !busy(state, unit) &&
            !unit.moveTo &&
            !state.transfers.some((item) => item.ids.includes(unit.id)),
          "请先完成调动、交战或转交",
        );
        const original = model(ctx, unit);
        const skill = original.skills?.find((item) => item.id === command.skillId);
        check(
          skill && ["transform", "flight"].includes(skill.type) && !skill.spawn && !skill.passive,
          "此技能需要在局地战中使用",
        );
        previous.skillName = skill.name;
        check(unit.strategicSkillTurn !== state.turn, "本大回合已使用机体技能");
        check(
          !unit.state?.embarked &&
            !state.units.some(
              (other) =>
                !other.destroyed &&
                unit.state?.id &&
                other.state?.embarked?.carrierId === unit.state.id,
            ),
          "搭载状态不能改变机体形态",
        );
        const saved = state.encounters.find((item) =>
          item.battleSave?.game.units.some((actor) => actor.campaignId === unit.id),
        )?.battleSave?.game;
        let game, actor;
        if (saved) {
          game = copy(saved);
          actor = game.units.find((item) => item.campaignId === unit.id);
        } else {
          const map = Object.values(ctx.G.catalog.maps).find(
            (item) =>
              item.environment !== "space" &&
              item.spawns.length > seat &&
              (!item.supportedModes || item.supportedModes.includes("regular")),
          );
          check(map, "没有可用的地面技能验证地图");
          const armies = Array(map.spawns.length).fill(null);
          armies[seat] = [{ unitId: unit.unitId, kitId: unit.kitId }];
          game = ctx.G.create(
            false,
            1,
            armies,
            false,
            ctx.G.campaignRoomSettings({ mapId: map.id }),
          );
          actor = game.units[0];
          const position = { x: actor.x, y: actor.y };
          if (unit.state) Object.assign(actor, copy(unit.state), position);
        }
        actor.team = team;
        actor.ownerSeat = unit.ownerSeat;
        actor.model = original.id || unit.unitId + "__" + unit.kitId;
        actor.acted = false;
        actor.moved = false;
        actor.plan = null;
        game.team = team;
        game.winner = null;
        game.deployment = null;
        check(ctx.G.canUseSkill(game, actor, skill.id), "当前损伤、能源或技能状态不允许使用");
        const target = ctx.G.skillTargets(game, actor, skill.id)[0];
        check(target, "当前没有可用的技能位置");
        ctx.G.useSkill(game, actor, skill.id, target.x, target.y);
        const next = ctx.G.modelOf(actor);
        check(next && game.units.includes(actor), "该技能不能在战略地图使用");
        actor.campaignId = unit.id;
        unit.unitId = next.prefabId;
        unit.kitId = next.kitId;
        unit.state = copy(actor);
        unit.strategicSkillTurn = state.turn;
        updateSavedArmy(state, unit);
        break;
      }

      case "campaign_move": {
        check(
          Array.isArray(command.ids) && command.ids.length > 0 && command.ids.length <= 5000,
          "请选择部队",
        );
        const units = transportGroup(state, [...new Set(command.ids)].map(getUnit));
        check(
          units.every(
            (unit) =>
              controls(state, members, seat, unit) ||
              units.some(
                (carrier) =>
                  controls(state, members, seat, carrier) &&
                  carrier.state?.id === unit.state?.embarked?.carrierId,
              ),
          ),
          "请由运输单位的控制者或总指挥官调动搭载部队",
        );
        for (const unit of units) {
          check(command.region === null || canRedeploy(state, unit), "交战中的部队不能调动");
          check(
            !state.transfers.some((transfer) => transfer.ids.includes(unit.id)),
            "请先完成或取消控制权转交",
          );
          const region = ctx.world.regions.find((item) => item.id === unit.region);
          check(
            command.region === null || region.links.includes(command.region),
            "只能调动到相邻区域",
          );
        }
        for (const unit of units) unit.moveTo = command.region;
        break;
      }
      case "campaign_produce": {
        const region = ctx.world.regions.find((item) => item.id === command.region);
        check(
          region?.factory &&
            state.regions.find((item) => item.id === region.id).owner === team &&
            !disputed(state, region.id),
          "只能在己方未交战的生产据点下单",
        );
        check(
          available(ctx, state, team, command.unitId, command.kitId),
          "该单位或套件尚未开发、没有生产报价或不能在地球生产",
        );
        check(state.orders.length < 500, "生产订单过多");
        const price = quote(ctx, command.unitId, command.kitId);
        const reserved = charge(pool, price);
        state.orders.push({
          id: "order-" + state.nextId++,
          ownerSeat: seat,
          team,
          region: region.id,
          ...price,
          status: reserved ? "queued" : "waiting",
          remaining: price.turns,
          reserved,
        });
        break;
      }
      case "campaign_cancel_order": {
        const order = state.orders.find((item) => item.id === command.orderId);
        check(
          order && order.ownerSeat === seat && order.status !== "working",
          "只能取消自己的未开工订单",
        );
        previous.orderName = model(ctx, order).name;
        previous.orderQuantity = order.quantity;
        if (order.reserved) {
          pool.money += order.money;
          pool.supplies += order.supplies;
        }
        state.orders = state.orders.filter((item) => item !== order);
        break;
      }
      case "campaign_transfer": {
        check(
          Number.isInteger(command.to) &&
            members.some((member) => member.seat === command.to && teamOf(member.seat) === team),
          "接收玩家不属于本阵营",
        );
        check(
          command.to !== seat &&
            Array.isArray(command.ids) &&
            command.ids.length > 0 &&
            command.ids.length <= 5000,
          "转交对象无效",
        );
        const units = transportGroup(state, [...new Set(command.ids)].map(getUnit));
        check(
          units.every((unit) => controls(state, members, seat, unit)),
          "请由总指挥官转交共同搭载的部队",
        );
        check(
          units.every(
            (unit) =>
              !unit.moveTo &&
              !busy(state, unit) &&
              !state.transfers.some((transfer) => transfer.ids.includes(unit.id)),
          ),
          "移动中、交战中或正在转交的单位不能转交",
        );
        state.transfers.push({
          id: "transfer-" + state.nextId++,
          from: seat,
          to: command.to,
          ids: units.map((unit) => unit.id),
        });
        break;
      }
      case "campaign_accept_transfer": {
        const transfer = state.transfers.find(
          (item) => item.id === command.transferId && item.to === seat,
        );
        check(transfer, "转交请求不存在");
        previous.unitIds = [...transfer.ids];
        if (command.accept === true)
          for (const id of transfer.ids) {
            const unit = state.units.find((unit) => unit.id === id);
            unit.ownerSeat = seat;
            const crew = crews.find(state, unit.team, unit.pilotId);
            if (crew) crew.ownerSeat = seat;
          }
        state.transfers = state.transfers.filter((item) => item !== transfer);
        break;
      }
      case "campaign_research": {
        const node = ctx.development.nodes(pool.faction).find((item) => item.id === command.techId);
        check(
          node &&
            !pool.researched.includes(node.id) &&
            !(pool.researchQueue || []).some((order) => order.techId === node.id) &&
            node.requires.every((id) => pool.researched.includes(id)),
          "该科技不能开发",
        );
        check(
          pool.technology >= researchPoints(ctx, node) &&
            pool.money >= (node.money || 0) &&
            pool.supplies >= (node.supplies || 0),
          "研发资源不足",
        );
        startResearch(ctx, state, team, node);
        break;
      }
      case "campaign_ready": {
        if (command.ready === false) state.ready = state.ready.filter((item) => item !== seat);
        else if (!state.ready.includes(seat)) state.ready.push(seat);
        const humans = members.filter((member) => member.seat !== null && !member.bot);
        if (humans.every((member) => state.ready.includes(member.seat)))
          advance(ctx, state, members);
        return;
      }
      default:
        throw Error("未知的战略命令");
    }
    recordOrder(ctx, state, members, seat, command, previous);
    clearReady(state, seat);
  }
  function productionCapacity(ctx, regionId) {
    const settings = ctx.world.settings;
    return settings.headquarters?.some((base) => base.region === regionId)
      ? (settings.headquartersProductionSlots || 1) : (settings.productionSlots || 1);
  }
  function updateVictory(ctx, state) {
    const bases = ctx.world.settings.headquarters;
    if (bases?.length) {
      const captured = bases.find((base) => state.regions.find((region) => region.id === base.region)?.owner !== base.team);
      if (captured) state.winner = state.regions.find((region) => region.id === captured.region).owner;
    } else if (new Set(state.regions.map((region) => region.owner)).size === 1) state.winner = state.regions[0].owner;
    if (state.winner !== null) { state.phase = "strategy"; state.ready = []; }
    return state.winner;
  }
  function startResearch(ctx, state, team, node) {
    const pool = state.teams[team];
    check(
      !pool.researched.includes(node.id) &&
        !(pool.researchQueue || []).some((order) => order.techId === node.id),
      "该科技已开发或正在研发",
    );
    check(
      node.requires.every((id) => pool.researched.includes(id)),
      "前置科技未完成",
    );
    const points = researchPoints(ctx, node);
    check(
      pool.technology >= points &&
        pool.money >= (node.money || 0) &&
        pool.supplies >= (node.supplies || 0),
      "研发资源不足",
    );
    pool.money -= node.money || 0;
    pool.supplies -= node.supplies || 0;
    (pool.researchQueue ||= []).push({
      techId: node.id,
      remaining: 1,
    });
  }
  function researchPoints(ctx, node) {
    return node.points;
  }
  function ensureArmyState(ctx, state, unit) {
    if (unit.state) return unit.state;
    const map = Object.values(ctx.G.catalog.maps).find((map) => map.environment !== "space" && map.spawns.length > unit.ownerSeat);
    const armies = Array(map.spawns.length).fill(null);
    const profile = crews.find(state, unit.team, unit.pilotId)?.profile;
    armies[unit.ownerSeat] = [{unitId:unit.unitId, kitId:unit.kitId, ...(profile ? {customPilot:profile} : {})}];
    const game = ctx.G.create(false, 1, armies, false, ctx.G.campaignRoomSettings({mapId:map.id}));
    const actor = game.units[0];
    actor.id = unit.ownerSeat + "-" + unit.id.split("-")[1];
    actor.campaignId = unit.id;
    actor.campaignDurability = unit.campaignDurability ?? 1;
    actor.hp = Math.ceil(actor.hp * actor.campaignDurability);
    unit.stateRound = game.round;
    return unit.state = copy(actor);
  }
  function embarkOptions(ctx, state, passenger) {
    if (passenger.destroyed || passenger.pendingTransfer || passenger.moveTo || busy(state, passenger) ||
        (passenger.state?.embarked || passenger.aboard) || model(ctx, passenger).deployed) return [];
    const transport = model(ctx, passenger).transport;
    if (!transport) return [];
    return state.units.filter((carrier) => carrier.id !== passenger.id && !carrier.destroyed &&
      !carrier.pendingTransfer && !carrier.moveTo && !carrier.state?.embarked && !carrier.aboard && !busy(state, carrier) &&
      carrier.team === passenger.team && carrier.region === passenger.region).flatMap((carrier) =>
      (model(ctx, carrier).hangars || []).filter((hangar) => {
        const used = state.units.filter((unit) => !unit.destroyed && (unit.carrierArmyId === carrier.id || (carrier.state?.id && unit.state?.embarked?.carrierId === carrier.state.id)) &&
          (unit.state?.embarked?.hangarId || unit.hangarId) === hangar.id).reduce((sum, unit) => sum + (hangar.kind === "sfs" ? 1 : model(ctx, unit).transport?.slotCost || 1), 0);
        return hangar.allowedTags.some((tag) => transport.loadTags.includes(tag)) && used + (hangar.kind === "sfs" ? 1 : transport.slotCost || 1) <= hangar.capacity;
      }).map((hangar) => ({carrierId:carrier.id, hangarId:hangar.id, name:hangar.name || hangar.id})));
  }
  function regionIncome(ctx, state, regionId) {
    const base = ctx.world.regions.find((region) => region.id === regionId),
      holder = state.regions.find((region) => region.id === regionId);
    if (!base || !holder) return { money: 0, supplies: 0, technology: 0 };
    const amount = base.factory ? ctx.world.settings.factoryIncome : ctx.world.settings.ordinaryIncome;
    return { money: rewards.roundReward(amount.money * rewards.rewardMultiplier),
      supplies: rewards.roundReward(amount.supplies * rewards.rewardMultiplier),
      technology: rewards.roundReward(amount.technology * (state.options?.teams[holder.owner]?.research ?? 1) * rewards.rewardMultiplier) };
  }
  function income(ctx, state, team) {
    const total = { money: 0, supplies: 0, technology: 0 };
    for (const region of state.regions.filter((region) => region.owner === team)) {
      const amount = regionIncome(ctx, state, region.id);
      for (const key of Object.keys(total)) total[key] += amount[key];
    }
    return total;
  }
  function recoverReserves(ctx, state) {
    for (const unit of state.units) {
      if (unit.destroyed || unit.pendingTransfer || unit.participatedTurn === state.turn ||
          state.regions.find((region) => region.id === unit.region)?.owner !== unit.team ||
          !unit.state) continue;
      const m = model(ctx, unit);
      unit.state.hp = Math.min(m.hp, unit.state.hp + Math.round(m.hp * 0.3));
      unit.state.en = Math.min(m.en, unit.state.en + Math.ceil(m.en * 0.6));
      updateSavedArmy(state, unit);
    }
  }
  function advance(ctx, state, members) {
    ctx.G.aiTactics.strategic(ctx, state, members, { busy, disputed, available, quote, charge, controller, startResearch, researchPoints });
    for (const pool of state.teams) pool.researchQueue = (pool.researchQueue || []).filter((order) => {
      if (--order.remaining > 0) return true;
      if (!pool.researched.includes(order.techId)) pool.researched.push(order.techId);
      const node = ctx.development.nodes(pool.faction).find((item) => item.id === order.techId);
      state.history.push(`战略第${state.turn}回合 · 队伍${state.teams.indexOf(pool) + 1} · 研发完成：${node?.name || order.techId}`);
      return false;
    });
    // Disputed regions stay locked between local battle segments too. Old saved
    // orders must not allow an army or its cargo to escape during settlement.
    for (const unit of state.units)
      if (!canRedeploy(state, unit)) unit.moveTo = null;
    // Embarked armies follow their carrier, including AI transport orders.
    for (let depth = 0; depth < 4; depth++)
      for (const unit of state.units.filter((unit) => !unit.destroyed && unit.state?.embarked)) {
        const carrier = state.units.find(
          (item) =>
            !item.destroyed &&
            item.region === unit.region &&
            item.state?.id === unit.state.embarked.carrierId,
        );
        if (carrier) unit.moveTo = carrier.moveTo;
      }
    // All movement is simultaneous. Crossing forces meet in the same destination.
    const moving = state.units.filter(
      (unit) => !unit.destroyed && !unit.pendingTransfer && unit.moveTo,
    );
    const destinations = new Map(moving.map((unit) => [unit.id, unit.moveTo]));
    const origins = new Map(moving.map((unit) => [unit.id, unit.region]));
    state.marches = [];
    for (const unit of moving) {
      const opposing = moving.find(
        (other) =>
          other.team !== unit.team &&
          origins.get(other.id) === destinations.get(unit.id) &&
          destinations.get(other.id) === origins.get(unit.id),
      );
      unit.region = opposing
        ? [origins.get(unit.id), destinations.get(unit.id)].sort()[0]
        : destinations.get(unit.id);
      // In a head-on encounter, the army remaining at its origin enters from the opposing region.
      unit.entryFrom = unit.region === origins.get(unit.id)
        ? destinations.get(unit.id)
        : origins.get(unit.id);
      unit.moveTo = null;
      if (unit.region !== origins.get(unit.id)) state.marches.push({ armyId: unit.id,
        team: unit.team, from: origins.get(unit.id), to: unit.region, turn: state.turn });
    }
    for (const region of state.regions) {
      const teams = [
        ...new Set(
          state.units
            .filter((unit) => !unit.destroyed && !unit.pendingTransfer && unit.region === region.id)
            .map((unit) => unit.team),
        ),
      ];
      if (teams.length === 1) region.owner = teams[0];
      if (teams.length > 1 && !state.encounters.some((item) => item.region === region.id))
        state.encounters.push({
          region: region.id,
          battleSave: null,
          roster: {},
          settled: [],
          turn: 0,
        });
      // Income previews and actual settlement use exactly the same ownership and rounding.
      const amount = regionIncome(ctx, state, region.id);
      for (const resource of ["money", "supplies", "technology"])
        state.teams[region.owner][resource] += amount[resource];
    }
    state.orders = state.orders.filter((order) => {
      const holder = state.regions.find((region) => region.id === order.region);
      if (holder.owner === order.team) return true;
      if (order.reserved && order.status !== "working") {
        state.teams[order.team].money += order.money;
        state.teams[order.team].supplies += order.supplies;
      }
      return false;
    });
    // Each base runs its configured parallel slots; applicants rotate through the queue.
    for (const region of ctx.world.regions.filter(
      (region) => region.factory && !disputed(state, region.id),
    )) {
      const holder = state.regions.find((item) => item.id === region.id);
      const candidates = state.orders.filter(
        (order) => order.region === region.id && order.team === holder.owner,
      );
      for (const order of candidates.filter((order) => order.status === "waiting"))
        if (charge(state.teams[order.team], order)) {
          order.reserved = true;
          order.status = "queued";
        }
      const slots = productionCapacity(ctx, region.id);
      const active = candidates.filter((order) => order.status === "working").slice(0, slots);
      const queued = candidates.filter((order) => order.status === "queued");
      while (active.length < slots && queued.length) {
        const index = Math.max(0, queued.findIndex((order) => order.ownerSeat !== holder.lastProducer));
        const order = queued.splice(index, 1)[0];
        order.status = "working";
        active.push(order);
        holder.lastProducer = order.ownerSeat;
      }
      for (const order of active) if (state.units.length + order.quantity <= 5000 && --order.remaining <= 0) {
        const produced = [];
        for (let i = 0; i < order.quantity; i++)
          produced.push(addUnit(ctx, state, order.ownerSeat, region.id, order.unitId, order.kitId));
        state.history.push(
          `战略第${state.turn}回合 · 队伍${order.team + 1} · ${region.name}：生产完成 ${model(ctx, order).name} ×${order.quantity} · ${produced.map((unit) => unitLabel(ctx, unit)).join("、")}`,
        );
        holder.lastProducer = order.ownerSeat;
        state.orders = state.orders.filter((item) => item !== order);
      }
    }
    for (const pool of state.teams) {
      const intel = intelligenceOf(pool);
      pool.intelligence = {
        ...intel,
        progress: Math.max(0, intel.progress - intelligenceRules.decay),
      };
    }
    state.ready = [];
    state.phase = state.encounters.some(
      (encounter) => disputed(state, encounter.region) && encounter.turn < state.turn,
    )
      ? "encounters"
      : "strategy";
    if (state.phase === "strategy") {
      recoverReserves(ctx, state);
      state.turn++;
      arrive(ctx, state);
    }
    state.history.push("战略第" + state.turn + "回合：生产、收入与调动已结算");
    state.history = state.history.slice(-100);
    updateVictory(ctx, state);
  }
  function arrive(ctx, state) {
    for (const unit of state.units.filter(
      (unit) =>
        !unit.destroyed && unit.pendingTransfer && unit.pendingTransfer.arriveTurn <= state.turn,
    )) {
      (state.marches ||= []).push({ armyId: unit.id, team: unit.team,
        from: unit.pendingTransfer.from, to: unit.pendingTransfer.to, turn: state.turn });
      unit.entryFrom = unit.pendingTransfer.from;
      unit.region = unit.pendingTransfer.to;
      delete unit.pendingTransfer;
      if (
        disputed(state, unit.region) &&
        !state.encounters.some((item) => item.region === unit.region)
      )
        state.encounters.push({
          region: unit.region,
          battleSave: null,
          roster: {},
          settled: [],
          turn: Math.max(0, state.turn - 1),
        });
    }
  }
  function view(state, team = null, ctx = { G: typeof Rules !== "undefined" ? Rules : require("./rules.js") }) {
    // Strip private battle data before cloning: large saved battlefields never enter snapshots.
    const { marches = [], battleLogs, ...publicState } = state;
    const result = copy({
      ...publicState,
      encounters: state.encounters.map(({ battleSave, roster, settled, briefedRound, briefedDestroyed, ...encounter }) => ({
        ...encounter,
        hasBattle: !!battleSave,
        mapId: battleSave?.game.mapId || null,
      })),
      units: state.units.map(({ state: actor, ...unit }) => ({
        ...unit,
        hp: actor?.hp ?? null,
        en: actor?.en ?? null,
        aboard: !!actor?.embarked,
        carrierArmyId: actor?.embarked ? state.units.find((parent) => parent.state?.id === actor.embarked.carrierId)?.id || null : null,
        hangarId: actor?.embarked?.hangarId || null,
        pilotName:
          crews.find(state, unit.team, unit.pilotId)?.profile.name ||
          actor?.pilot?.name ||
          (unit.team === 0 ? "联邦默认驾驶员" : "吉翁默认驾驶员"),
      })),
    });
    const progress = team === null ? 100 : intelligenceOf(state.teams[team]).progress;
    result.intel = {
      team,
      progress,
      rules: intelligenceRules,
      fundedTurn: team === null ? 0 : intelligenceOf(state.teams[team]).fundedTurn,
    };
    result.intelRegions = state.regions.map((region) => {
      const armies = state.units.filter(
        (unit) => !unit.destroyed && !unit.pendingTransfer && unit.region === region.id,
      );
      return {
        id: region.id,
        contested: new Set(armies.map((unit) => unit.team)).size > 1,
        costs: [0, 1].map((side) => intelligenceCount(
          armies.filter((unit) => unit.team === side).reduce((sum, unit) => sum + (model(ctx, unit)?.cost || 0), 0),
          team === null || side === team ? 100 : progress,
          `${state.turn}:${team}:${region.id}:${side}:cost`,
        )),
        counts: [0, 1].map((side) =>
          intelligenceCount(
            armies.filter((unit) => unit.team === side).length,
            team === null || side === team ? 100 : progress,
            `${state.turn}:${team}:${region.id}:${side}`,
          ),
        ),
      };
    });
    const moving = new Map();
    const addMovement = (unit, from, to) => {
      const key = `${unit.team}:${from}:${to}`;
      if (!moving.has(key)) moving.set(key, { id: key, team: unit.team, from, to, units: [] });
      if (!moving.get(key).units.includes(unit.id)) moving.get(key).units.push(unit.id);
    };
    // Own plans remain editable previews. Enemy intent is private until movement actually settles.
    for (const unit of state.units.filter((u) => !u.destroyed && (u.moveTo || u.pendingTransfer) &&
        (team === null || u.team === team)))
      addMovement(unit, unit.region, unit.moveTo || unit.pendingTransfer.to);
    // Completed marches are history, not moving armies. Only active orders and
    // pending edge transfers above can produce movement markers.
    result.movements = [...moving.values()]
      .filter((move) => team === null || move.team === team || progress >= 25)
      .map(({ units, ...move }) => ({
        ...move,
        count: intelligenceCount(
          units.length,
          team === null || move.team === team ? 100 : progress,
          `${state.turn}:${team}:${move.id}`,
        ),
        approximate: team !== null && move.team !== team && progress < 75,
        unitIds: team === null || move.team === team || progress >= 75 ? units : [],
      }));
    if (team !== null) {
      result.units = result.units
        .filter((unit) => unit.team === team || (progress >= 75 && !unit.destroyed))
        .map((unit) => {
          if (unit.team === team) return unit;
          if (progress >= 100) {
            const { pendingTransfer, ...known } = unit;
            return { ...known, moveTo: null };
          }
          return {
            id: unit.id,
            unitId: unit.unitId,
            kitId: unit.kitId,
            team: unit.team,
            ownerSeat: unit.ownerSeat,
            region: unit.region,
            moveTo: null,
            destroyed: false,
            intelRedacted: true,
          };
        });
      for (let side = 0; side < result.teams.length; side++)
        if (side !== team) delete result.teams[side].kits;
      result.pilots = result.pilots.filter((entry) => entry.team === team);
      result.orders = result.orders.filter((entry) => entry.team === team);
      result.transfers = result.transfers.filter((entry) =>
        entry.ids.some((id) => result.units.some((unit) => unit.id === id && unit.team === team)),
      );
      result.history = result.history.filter(
        (line) =>
          new RegExp(`^战略第\\d+回合 · 队伍${team + 1} ·`).test(line) ||
          /^战略第\d+回合：生产、收入与调动已结算$/.test(line) ||
          /^\[局地战(?:回合|阶段)简报\]/.test(line),
      );
    }
    return result;
  }
  function validate(ctx, value, members) {
    check(
      value?.format === "ProjectGreed-campaign" &&
        value.version === 1 &&
        integer(value.turn, 1, 100000) &&
        ["strategy", "encounters"].includes(value.phase),
      "战役存档格式无效",
    );
    const campaignOptions = ctx.G.aiTactics.settings(value.options);
    const legacy = ctx.world.legacyRegionIds;
    if (
      legacy &&
      Array.isArray(value.regions) &&
      value.regions.length === legacy.length &&
      new Set(value.regions.map((region) => region.id)).size === legacy.length &&
      value.regions.every((region) => legacy.includes(region.id))
    ) {
      value = copy(value);
      const owners = new Map(value.regions.map((region) => [region.id, region.owner]));
      for (const region of ctx.world.regions)
        if (!owners.has(region.id))
          value.regions.push({
            id: region.id,
            owner: owners.get(region.legacyParent) ?? region.owner,
          });
      value.geographyVersion = ctx.world.geographyVersion;
      // New territories inherit control; importing never grants free armies or resources.
      for (const unit of value.units || []) {
        const region = ctx.world.regions.find((region) => region.id === unit.region);
        if (unit.moveTo && !region?.links.includes(unit.moveTo)) unit.moveTo = null;
      }
      value.history = [
        ...(Array.isArray(value.history) ? value.history : []),
        "战略地图已升级；保留部队与资源，已撤销不再相邻的旧调动指令",
      ].slice(-100);
    }
    check(integer(value.rounds, 1, 10) && integer(value.nextId, 1, 10000000), "战役设置无效");
    check(value.winner === null || [0, 1].includes(value.winner), "战役胜负无效");
    check(
      Array.isArray(value.teams) &&
        value.teams.length === 2 &&
        value.teams.every(
          (team, index) =>
            team.faction === ["EFSF", "ZEON"][index] &&
            [team.money, team.supplies, team.technology].every((n) =>
              integer(n, 0, 1000000000000),
            ) &&
            Array.isArray(team.researched) &&
            team.researched.every((id) =>
              ctx.development.nodes(team.faction).some((node) => node.id === id),
            ),
        ),
      "阵营数据无效",
    );
    check(
      Array.isArray(value.regions) &&
        value.regions.length === ctx.world.regions.length &&
        new Set(value.regions.map((region) => region.id)).size === value.regions.length &&
        value.regions.every(
          (region) =>
            ctx.world.regions.some((item) => item.id === region.id) &&
            [0, 1].includes(region.owner),
        ),
      "领土数据无效",
    );
    check(
      Array.isArray(value.units) &&
        value.units.length <= 5000 &&
        new Set(value.units.map((unit) => unit.id)).size === value.units.length,
      "战役部队数据无效",
    );
    for (const unit of value.units) {
      check(
        typeof unit.id === "string" &&
          /^army-\d+$/.test(unit.id) &&
          integer(unit.ownerSeat, 0, 15) &&
          unit.team === teamOf(unit.ownerSeat) &&
          value.regions.some((region) => region.id === unit.region) &&
          model(ctx, unit) &&
          typeof unit.destroyed === "boolean",
        "战役单位无效",
      );
      if (unit.stateRound !== undefined)
        check(integer(unit.stateRound, 1, 10000000), "部队状态回合无效");
      if (unit.pendingTransfer)
        check(
          unit.pendingTransfer.from === unit.region &&
            ctx.world.regions
              .find((region) => region.id === unit.region)
              .links.includes(unit.pendingTransfer.to) &&
            integer(unit.pendingTransfer.arriveTurn, value.turn, value.turn + 1),
          "跨区转移存档无效",
        );
      if (unit.entryFrom !== undefined)
        check(
          ctx.world.regions.some((region) => region.id === unit.entryFrom),
          "部队来向无效",
        );
      check(
        unit.moveTo === null ||
          ctx.world.regions.find((region) => region.id === unit.region).links.includes(unit.moveTo),
        "战役调动无效",
      );
      if (unit.pilotBase)
        check(
          ctx.G.models[unit.pilotBase.unitId + "__" + unit.pilotBase.kitId]?.pilotForms?.length > 0,
          "驾驶员专用机基础机型无效",
        );
      const factor = campaignOptions.teams[unit.team].durability;
      check((unit.campaignDurability === undefined || unit.campaignDurability === factor) &&
        (unit.state?.campaignDurability === undefined || unit.state.campaignDurability === factor), "战役耐久倍率无效");
      if (unit.state)
        check(
          Number.isFinite(unit.state.hp) &&
            unit.state.hp >= 0 &&
            unit.state.hp <= Math.ceil(ctx.G.models[unit.unitId + "__" + unit.kitId].hp * campaignOptions.teams[unit.team].durability) &&
            Number.isFinite(unit.state.en) &&
            unit.state.en >= 0 &&
            unit.state.en <= model(ctx, unit).en,
          "单位状态无效",
        );
      check(
        unit.ownerSeat < ctx.G.catalog.scenarios.earth_0079_mid.playersPerTeam * 2,
        "请先恢复存档中的玩家或AI席位：" + (unit.ownerSeat + 1),
      );
    }
    for (const unit of value.units.filter((unit) => !unit.destroyed && unit.state?.embarked)) {
      const carrier = value.units.find((item) => !item.destroyed && item.state?.id === unit.state.embarked.carrierId);
      const hangar = carrier && model(ctx, carrier)?.hangars?.find((item) => item.id === unit.state.embarked.hangarId);
      const transport = model(ctx, unit)?.transport;
      check(carrier && carrier !== unit && carrier.team === unit.team && carrier.region === unit.region &&
        hangar && transport &&
        hangar.allowedTags.some((tag) => transport.loadTags.includes(tag)), "格纳库搭载关系无效");
      const used = value.units.filter((item) => !item.destroyed && item.state?.embarked?.carrierId === carrier.state.id &&
        item.state.embarked.hangarId === hangar.id).reduce((sum, item) => sum + (hangar.kind === "sfs" ? 1 : model(ctx, item).transport?.slotCost || 1), 0);
      check(used <= hangar.capacity, "格纳库搭载超出容量");
    }
    for (const unit of value.units.filter((item) => !item.destroyed && item.state?.embarked)) {
      const seen = new Set([unit.id]);
      let parentId = unit.state.embarked.carrierId;
      while (parentId) {
        const parent = value.units.find((item) => !item.destroyed && item.state?.id === parentId);
        check(parent && !seen.has(parent.id), "不能循环搭载");
        seen.add(parent.id);
        parentId = parent.state?.embarked?.carrierId;
      }
    }
    check(
      Array.isArray(value.orders) &&
        value.orders.length <= 500 &&
        Array.isArray(value.transfers) &&
        value.transfers.length <= 500 &&
        Array.isArray(value.encounters) &&
        value.encounters.length <= value.regions.length,
      "队列数据无效",
    );
    check(
      new Set(value.orders.map((order) => order.id)).size === value.orders.length &&
        new Set(value.encounters.map((item) => item.region)).size === value.encounters.length,
      "重复的战役队列编号",
    );
    for (const order of value.orders)
      check(
        typeof order.id === "string" &&
          /^order-\d+$/.test(order.id) &&
          ctx.world.regions.some((region) => region.id === order.region && region.factory) &&
          model(ctx, order) &&
          quote(ctx, order.unitId, order.kitId) &&
          integer(order.quantity, 1, 72) &&
          [order.money, order.supplies].every((n) => integer(n, 0, 1000000000)) &&
          integer(order.remaining, 1, 10000) &&
          integer(order.ownerSeat, 0, 15) &&
          order.ownerSeat < ctx.G.catalog.scenarios.earth_0079_mid.playersPerTeam * 2 &&
          order.team === teamOf(order.ownerSeat) &&
          ["waiting", "queued", "working"].includes(order.status) &&
          order.reserved === (order.status !== "waiting"),
        "生产订单无效",
      );
    for (const encounter of value.encounters) {
      check((encounter.briefedRound === undefined || integer(encounter.briefedRound, 0, 100000000)) &&
        (encounter.briefedDestroyed === undefined || (Array.isArray(encounter.briefedDestroyed) &&
          encounter.briefedDestroyed.length <= 5000 && encounter.briefedDestroyed.every(
            (id) => typeof id === "string" && id.length <= 100))), "局地战简报记录无效");
      check(
        encounter.delegatedSeats === undefined ||
          (Array.isArray(encounter.delegatedSeats) &&
            encounter.delegatedSeats.every(
              (seat) =>
                Number.isInteger(seat) &&
                members.some((member) => member.seat === seat && !member.bot),
            )),
        "委任席位无效",
      );
      check(
        value.regions.some((region) => region.id === encounter.region) &&
          integer(encounter.turn, 0, value.turn) &&
          encounter.roster &&
          Array.isArray(encounter.settled),
        "交战数据无效",
      );
      if (encounter.battleSave) {
        ctx.validateBattle(encounter.battleSave);
        const done = encounter.battleSave.campaignTurnDone;
        check(
          done === undefined ||
            (Array.isArray(done) &&
              done.length === encounter.battleSave.armies.length &&
              done.every((value) => typeof value === "boolean")),
          "局地战行动完成状态无效",
        );
      }
      if (encounter.resumeStartRound !== undefined)
        check(
          encounter.battleSave &&
            integer(encounter.resumeStartRound, 1, encounter.battleSave.game.round),
          "局地战起始回合无效",
        );
      if (encounter.resumeStopRound !== undefined)
        check(
          encounter.battleSave &&
            integer(
              encounter.resumeStopRound,
              encounter.battleSave.game.round,
              encounter.battleSave.game.round + 20,
            ),
          "局地战剩余轮数无效",
        );
    }
    const maxId = Math.max(
      0,
      ...value.units.map((unit) => Number(unit.id.split("-").at(-1))),
      ...value.orders.map((order) => Number(order.id.split("-").at(-1)) || 0),
      ...(value.pilots || [])
        .filter((entry) => !entry.profile?.ace)
        .map((entry) => Number(entry.profile?.id?.split("-").at(-1)) || 0),
    );
    check(value.nextId > maxId, "战役编号计数无效");
    const clean = copy(value);
    check(value.battleLogs === undefined || (value.battleLogs && typeof value.battleLogs === "object" &&
      !Array.isArray(value.battleLogs)), "地区战斗日志无效");
    clean.battleLogs = {};
    for (const [regionId, archive] of Object.entries(value.battleLogs || {})) {
      const lines = value => Array.isArray(value) && value.length <= 100000 &&
        value.every(line => typeof line === "string" && line.length <= 20000);
      check(ctx.world.regions.some(region => region.id === regionId) && archive &&
        lines(archive.log) && lines(archive.logNames) && archive.teamLogs &&
        typeof archive.teamLogs === "object" && !Array.isArray(archive.teamLogs) &&
        Object.entries(archive.teamLogs).every(([team, entries]) => ["0", "1"].includes(team) && lines(entries)),
        "地区战斗日志无效");
      clean.battleLogs[regionId] = copy({log:archive.log, teamLogs:archive.teamLogs, logNames:archive.logNames});
    }
    // Reports are derived per recipient; never restore client report fields as authoritative data.
    delete clean.intel;
    delete clean.intelRegions;
    delete clean.movements;
    for (const pool of clean.teams) {
      const intel = intelligenceOf(pool);
      check(
        integer(intel.progress, 0, 100) && integer(intel.fundedTurn, 0, value.turn),
        "情报数据无效",
      );
      pool.intelligence = { ...intel };
      const pending = pool.researchQueue || [];
      const nodes = ctx.development.nodes(pool.faction);
      check(Array.isArray(pending) && pending.length <= nodes.length && new Set(pending.map((item) => item.techId)).size === pending.length &&
        pending.every((item) => item && integer(item.remaining, 1, 10000) &&
          !pool.researched.includes(item.techId) && nodes.some((node) => node.id === item.techId && node.requires.every((id) => pool.researched.includes(id)))), "研发队列无效");
      pool.researchQueue = copy(pending).map(order => ({...order, remaining: 1}));
      pool.kits = {}; // Discard obsolete independent equipment quantities on load.
    }
    check(value.marches === undefined || (Array.isArray(value.marches) && value.marches.length <= 10000 &&
      value.marches.every((report) => report && [0, 1].includes(report.team) &&
        integer(report.turn, 1, value.turn) && value.units.some((u) => u.id === report.armyId && u.team === report.team) &&
        ctx.world.regions.some((r) => r.id === report.from && r.links.includes(report.to)))), "已结算调动记录无效");
    clean.marches = copy(value.marches || []);
    clean.options = campaignOptions;
    for (const unit of clean.units) {
      unit.campaignDurability = campaignOptions.teams[unit.team].durability;
      if (unit.state) unit.state.campaignDurability = unit.campaignDurability;
    }
    clean.scenarioId = value.scenarioId || "earth_0079_mid";
    check(Object.hasOwn(ctx.G.catalog.scenarios, clean.scenarioId), "战役剧本不存在");
    clean.name = saveName(value.name, ctx.world.name);
    clean.pilots = crews.validate(
      clean,
      Array.from(
        { length: ctx.G.catalog.scenarios.earth_0079_mid.playersPerTeam * 2 },
        (_, seat) => ({ seat }),
      ),
    );
    clean.ready = [];
    clean.transfers = []; // Never restore an unaccepted permission transfer from an external archive.
    clean.history = Array.isArray(clean.history)
      ? clean.history.filter((line) => typeof line === "string").slice(-100)
      : [];
    return clean;
  }
  return {
    intelligenceRules,
    create,
    arrive,
    action,
    advance,
    recoverReserves,
    regionIncome,
    income,
    productionCapacity, updateVictory, startResearch, researchPoints, embarkOptions,
    available,
    quote,
    equipmentQuote,
    dismissalQuote,
    canDismiss,
    model,
    unitLabel,
    addUnit,
    commander,
    controller,
    controls,
    disputed,
    canRedeploy,
    view,
    validate,
  };
})();
if (typeof module !== "undefined") module.exports = CampaignRules;
