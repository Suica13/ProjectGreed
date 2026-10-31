/* Persistent Earth campaign. Clients submit orders; this module owns resources and armies. */
"use strict";
const CampaignRules = (() => {
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const check = (condition, message) => {
    if (!condition) throw Error(message);
  };
  const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
  const teamOf = (seat) => seat % 2;
  function commander(members, team) {
    return (
      members
        .filter((member) => Number.isInteger(member.seat) && teamOf(member.seat) === team)
        .sort((a, b) => a.seat - b.seat)[0]?.seat ?? null
    );
  }
  function controls(state, members, seat, unit) {
    return (
      Number.isInteger(seat) &&
      unit.team === teamOf(seat) &&
      (unit.ownerSeat === seat || commander(members, unit.team) === seat)
    );
  }
  function model(ctx, unit) {
    return ctx.G.models[unit.unitId + "__" + unit.kitId];
  }
  function quote(ctx, unitId, kitId = ctx.production.defaultKits[unitId]) {
    const prefab = ctx.G.catalog.prefabs.find((item) => item.id === unitId);
    if (!prefab?.weaponKits.some((kit) => kit.id === kitId) || !ctx.G.models[unitId + "__" + kitId])
      return null;
    const offer = ctx.production.offers[unitId + "__" + kitId];
    const native = ctx.production.nativePricing[unitId]?.kits[kitId];
    if (!offer || native?.available === false) return null;
    return {
      unitId,
      kitId,
      money: Math.ceil(native?.batchMoney ?? offer.money),
      supplies: Math.ceil(native?.batchSupplies ?? offer.supplies),
      quantity: native?.quantity ?? offer.quantity,
      turns: Math.max(
        1,
        Math.ceil(
          (native?.source?.buildSeconds ?? offer.source?.buildSeconds ?? 30) /
            (ctx.world?.settings?.productionSecondsPerTurn || 30),
        ),
      ),
    };
  }
  function updateSavedArmy(state, unit) {
    if (!unit.state) return;
    for (const encounter of state.encounters) {
      const game = encounter.battleSave?.game;
      const actor = game?.units.find((item) => item.campaignId === unit.id);
      if (!actor) continue;
      const position = { id: actor.id, x: actor.x, y: actor.y, angle: actor.angle };
      Object.assign(actor, copy(unit.state), position);
    }
  }
  function equipmentQuote(ctx, unit, kitId) {
    const prefab = ctx.G.catalog.prefabs.find((item) => item.id === unit.unitId);
    if (
      !prefab?.weaponKits.some((kit) => kit.id === kitId) ||
      !ctx.G.models[unit.unitId + "__" + kitId]
    )
      return null;
    const fee = ctx.production.nativeEquipmentCosts?.[unit.unitId + "__" + kitId];
    if (!fee || ![fee.money, fee.supplies].every((value) => Number.isFinite(value) && value >= 0))
      return null;
    // A new purchase of the target equipment, not a trade-in or factory price difference.
    return { money: Math.ceil(fee.money), supplies: Math.ceil(fee.supplies) };
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
      prefab.faction === faction &&
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
  function create(ctx, members, options = {}) {
    const rounds = Number(options.rounds ?? 10);
    check(integer(rounds, 1, 10), "局地战轮数应为1至10");
    const state = {
      format: "ProjectGreed-campaign",
      version: 1,
      geographyVersion: ctx.world.geographyVersion || 1,
      turn: 1,
      phase: "strategy",
      rounds,
      nextId: 1,
      winner: null,
      ready: [],
      units: [],
      orders: [],
      transfers: [],
      encounters: [],
      history: [],
      regions: ctx.world.regions.map((region) => ({ id: region.id, owner: region.owner })),
      teams: ["EFSF", "ZEON"].map((faction) => ({
        faction,
        money: ctx.world.settings.startingMoney,
        supplies: ctx.world.settings.startingSupplies,
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
      const ids = region.owner === 0 ? ["Type61", "FF_B2"] : ["MS_06F", "MS_06J"];
      for (let i = 0; i < (region.initialUnits ?? (region.factory ? 4 : 2)); i++)
        addUnit(ctx, state, owner.seat, region.id, ids[i % ids.length]);
    }
    return state;
  }
  function disputed(state, id) {
    return (
      new Set(
        state.units
          .filter((unit) => !unit.destroyed && unit.region === id)
          .map((unit) => unit.team),
      ).size > 1
    );
  }
  function busy(state, unit) {
    return state.encounters.some(
      (encounter) => encounter.region === unit.region && encounter.turn === state.turn,
    );
  }
  function charge(team, price) {
    if (team.money < price.money || team.supplies < price.supplies) return false;
    team.money -= price.money;
    team.supplies -= price.supplies;
    return true;
  }
  function clearReady(state) {
    state.ready = [];
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
  function action(ctx, state, members, seat, command) {
    check(
      Number.isInteger(seat) && members.some((member) => member.seat === seat),
      "观战者不能下达战役命令",
    );
    check(state.phase === "strategy" && state.winner === null, "当前不在战略指令阶段");
    check(command.turn === state.turn, "战略回合已变化，请重新下达命令");
    const team = teamOf(seat),
      pool = state.teams[team];
    const getUnit = (id) => {
      const unit = state.units.find((item) => item.id === id && !item.destroyed);
      check(unit && controls(state, members, seat, unit), "无权指挥这支部队");
      return unit;
    };
    switch (command.action) {
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
        check(pool.money >= price.money && pool.supplies >= price.supplies, "阵营资源不足");
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
          delete unit.state.defaultFormModel;
          delete unit.state.plan;
        }
        unit.kitId = command.kitId;
        pool.money -= price.money;
        pool.supplies -= price.supplies;
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
        actor.actionPoints = original.actionPoints;
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
          check(!busy(state, unit), "交战中的部队本轮不能重新调动");
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
        if (command.accept === true)
          for (const id of transfer.ids)
            state.units.find((unit) => unit.id === id).ownerSeat = seat;
        state.transfers = state.transfers.filter((item) => item !== transfer);
        break;
      }
      case "campaign_research": {
        const node = ctx.development.nodes(pool.faction).find((item) => item.id === command.techId);
        check(
          node &&
            !pool.researched.includes(node.id) &&
            node.requires.every((id) => pool.researched.includes(id)),
          "该科技不能开发",
        );
        check(
          pool.technology >= node.points &&
            pool.money >= (node.money || 0) &&
            pool.supplies >= (node.supplies || 0),
          "研发资源不足",
        );
        pool.technology -= node.points;
        pool.money -= node.money || 0;
        pool.supplies -= node.supplies || 0;
        pool.researched.push(node.id);
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
    clearReady(state);
  }
  function advance(ctx, state, members) {
    // AI uses campaign funds, technology and the same legal neighboring regions.
    for (const player of members.filter((member) => member.bot && member.seat !== null)) {
      const team = teamOf(player.seat),
        pool = state.teams[team];
      const research = ctx.development
        .nodes(pool.faction)
        .find(
          (node) =>
            !pool.researched.includes(node.id) &&
            node.requires.every((id) => pool.researched.includes(id)) &&
            node.points <= pool.technology &&
            (node.money || 0) <= pool.money &&
            (node.supplies || 0) <= pool.supplies,
        );
      if (research) {
        pool.researched.push(research.id);
        pool.technology -= research.points;
        pool.money -= research.money || 0;
        pool.supplies -= research.supplies || 0;
      }
      for (const unit of state.units.filter(
        (unit) => !unit.destroyed && unit.ownerSeat === player.seat && !busy(state, unit),
      )) {
        if (state.transfers.some((transfer) => transfer.ids.includes(unit.id))) continue;
        const region = ctx.world.regions.find((item) => item.id === unit.region);
        const queue = [{ id: region.id, first: null }],
          visited = new Set([region.id]);
        while (queue.length) {
          const next = queue.shift();
          if (
            next.id !== region.id &&
            state.regions.find((item) => item.id === next.id).owner !== team
          ) {
            unit.moveTo = next.first;
            break;
          }
          for (const id of ctx.world.regions.find((item) => item.id === next.id).links)
            if (!visited.has(id)) {
              visited.add(id);
              queue.push({ id, first: next.first || id });
            }
        }
      }
      const factory = ctx.world.regions.find(
        (region) =>
          region.factory &&
          state.regions.find((item) => item.id === region.id).owner === team &&
          !disputed(state, region.id),
      );
      const choices = ctx.G.catalog.prefabs.filter(
        (prefab) =>
          available(ctx, state, team, prefab.id) &&
          !prefab.unitTags?.includes("Ship") &&
          !prefab.unitTags?.includes("Support"),
      );
      if (
        factory &&
        choices.length &&
        state.orders.filter((order) => order.ownerSeat === player.seat).length < 3
      ) {
        const price = quote(ctx, choices[state.turn % choices.length].id);
        if (charge(pool, price))
          state.orders.push({
            id: "order-" + state.nextId++,
            ownerSeat: player.seat,
            team,
            region: factory.id,
            ...price,
            status: "queued",
            remaining: price.turns,
            reserved: true,
          });
      }
    }
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
    const moving = state.units.filter((unit) => !unit.destroyed && unit.moveTo);
    const destinations = new Map(moving.map((unit) => [unit.id, unit.moveTo]));
    const origins = new Map(moving.map((unit) => [unit.id, unit.region]));
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
      unit.moveTo = null;
    }
    for (const region of state.regions) {
      const teams = [
        ...new Set(
          state.units
            .filter((unit) => !unit.destroyed && unit.region === region.id)
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
      const base = ctx.world.regions.find((item) => item.id === region.id);
      if (teams.length <= 1) {
        const income = base.factory
          ? ctx.world.settings.factoryIncome
          : ctx.world.settings.ordinaryIncome;
        for (const resource of ["money", "supplies", "technology"])
          state.teams[region.owner][resource] += income[resource];
      }
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
    // One slot per important base; round-robin among applicants.
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
      let order = candidates.find((order) => order.status === "working");
      if (!order) {
        const queued = candidates.filter((order) => order.status === "queued");
        order = queued.find((order) => order.ownerSeat !== holder.lastProducer) || queued[0];
        if (order) order.status = "working";
      }
      if (order && state.units.length + order.quantity <= 5000 && --order.remaining <= 0) {
        for (let i = 0; i < order.quantity; i++)
          addUnit(ctx, state, order.ownerSeat, region.id, order.unitId, order.kitId);
        holder.lastProducer = order.ownerSeat;
        state.orders = state.orders.filter((item) => item !== order);
      }
    }
    state.ready = [];
    state.phase = state.encounters.some(
      (encounter) => disputed(state, encounter.region) && encounter.turn < state.turn,
    )
      ? "encounters"
      : "strategy";
    if (state.phase === "strategy") state.turn++;
    state.history.push("战略第" + state.turn + "回合：生产、收入与调动已结算");
    state.history = state.history.slice(-100);
    const owners = new Set(state.regions.map((region) => region.owner));
    if (owners.size === 1) state.winner = state.regions[0].owner;
  }
  function view(state) {
    // Strip private battle data before cloning: large saved battlefields never enter snapshots.
    return copy({
      ...state,
      encounters: state.encounters.map(({ battleSave, roster, settled, ...encounter }) => ({
        ...encounter,
        hasBattle: !!battleSave,
        mapId: battleSave?.game.mapId || null,
      })),
      units: state.units.map(({ state: actor, ...unit }) => ({
        ...unit,
        hp: actor?.hp ?? null,
        en: actor?.en ?? null,
        aboard: !!actor?.embarked,
        pilotName: actor?.pilot?.name || (unit.team === 0 ? "联邦默认驾驶员" : "吉翁默认驾驶员"),
      })),
    });
  }
  function validate(ctx, value, members) {
    check(
      value?.format === "ProjectGreed-campaign" &&
        value.version === 1 &&
        integer(value.turn, 1, 100000) &&
        ["strategy", "encounters"].includes(value.phase),
      "战役存档格式无效",
    );
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
      check(
        unit.moveTo === null ||
          ctx.world.regions.find((region) => region.id === unit.region).links.includes(unit.moveTo),
        "战役调动无效",
      );
      if (unit.state)
        check(
          Number.isFinite(unit.state.hp) &&
            unit.state.hp >= 0 &&
            unit.state.hp <= model(ctx, unit).hp &&
            Number.isFinite(unit.state.en) &&
            unit.state.en >= 0 &&
            unit.state.en <= model(ctx, unit).en,
          "单位状态无效",
        );
      check(
        members.some((member) => member.seat === unit.ownerSeat),
        "请先恢复存档中的玩家或AI席位：" + (unit.ownerSeat + 1),
      );
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
          members.some((member) => member.seat === order.ownerSeat) &&
          order.team === teamOf(order.ownerSeat) &&
          ["waiting", "queued", "working"].includes(order.status) &&
          order.reserved === (order.status !== "waiting"),
        "生产订单无效",
      );
    for (const encounter of value.encounters) {
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
    );
    check(value.nextId > maxId, "战役编号计数无效");
    const clean = copy(value);
    clean.ready = [];
    clean.transfers = []; // Never restore an unaccepted permission transfer from an external archive.
    clean.history = Array.isArray(clean.history)
      ? clean.history.filter((line) => typeof line === "string").slice(-100)
      : [];
    return clean;
  }
  return {
    create,
    action,
    advance,
    available,
    quote,
    equipmentQuote,
    model,
    addUnit,
    commander,
    controls,
    disputed,
    view,
    validate,
  };
})();
if (typeof module !== "undefined") module.exports = CampaignRules;
