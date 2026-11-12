/* Campaign-owned crews. No personal profile data or client-authored attributes enter here. */
"use strict";
const CampaignPilots = (() => {
  const P = typeof PilotSystem !== "undefined" ? PilotSystem : require("./pilots.js");
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const check = (value, message) => {
    if (!value) throw Error(message);
  };
  const find = (state, team, id) =>
    (state.pilots || []).find((item) => item.team === team && item.profile.id === id);
  const assigned = (state, entry) =>
    state.units.find(
      (unit) => !unit.destroyed && unit.team === entry.team && unit.pilotId === entry.profile.id,
    );
  const permits = (members, seat, entry) =>
    entry.team === seat % 2 &&
    (entry.ownerSeat === seat ||
      members
        .filter((item) => Number.isInteger(item.seat) && item.seat % 2 === entry.team)
        .sort((a, b) => a.seat - b.seat)[0]?.seat === seat);
  function available(ctx, state, team, aceId) {
    const profile = P.aceProfile(aceId),
      pool = state.teams[team];
    return (
      !!profile?.price &&
      P.canAssign({ aceId }, pool.faction) &&
      ctx.development
        .nodes(pool.faction)
        .some((node) => pool.researched.includes(node.id) && node.unlocks.includes(aceId))
    );
  }
  function editable(state, unit) {
    check(
      !unit.moveTo &&
        !state.transfers.some((item) => item.ids.includes(unit.id)) &&
        !state.encounters.some((item) => item.region === unit.region && item.turn === state.turn),
      "请先完成调动、交战或转交",
    );
  }
  function sync(ctx, state, unit, profile) {
    const base = unit.pilotBase || { unitId: unit.unitId, kitId: unit.kitId };
    const factor = unit.campaignDurability ?? unit.state?.campaignDurability ?? 1;
    const original = ctx.G.modelOf({ model: unit.unitId + "__" + unit.kitId, campaignDurability: factor });
    const baseModel = ctx.G.models[base.unitId + "__" + base.kitId];
    if (baseModel?.pilotForms?.length) {
      const target = ctx.G.formationModel({
        ...base,
        ...(profile ? { customPilot: profile } : {}),
      });
      const targetKey = target.prefabId + "__" + target.kitId;
      const maximums = { ...target, hp: Math.ceil(target.hp * factor) };
      if (targetKey !== unit.unitId + "__" + unit.kitId) {
        unit.unitId = target.prefabId;
        unit.kitId = target.kitId;
        if (unit.state) {
          unit.state.model = targetKey;
          for (const field of ["hp", "en"])
            unit.state[field] = Math.min(
              maximums[field],
              Math.floor((unit.state[field] / Math.max(1, original[field])) * maximums[field]),
            );
          unit.state.shield = Math.min(unit.state.shield || 0, target.shield.hp);
          delete unit.state.defaultFormModel;
          delete unit.state.heldWeapon;
          delete unit.state.weaponDisplayIndex;
          delete unit.state.plan;
        }
      }
      if (targetKey === base.unitId + "__" + base.kitId) delete unit.pilotBase;
      else unit.pilotBase = { ...base };
    }
    if (unit.state) unit.state.pilot = profile ? clone(profile) : null;
    for (const encounter of state.encounters) {
      const actor = encounter.battleSave?.game.units.find((item) => item.campaignId === unit.id);
      if (actor) {
        const position = { id: actor.id, x: actor.x, y: actor.y, angle: actor.angle };
        if (unit.state) Object.assign(actor, clone(unit.state), position);
        actor.pilot = profile ? clone(profile) : null;
      }
    }
  }
  function action(ctx, state, members, seat, msg) {
    const team = seat % 2,
      pool = state.teams[team];
    const entries = state.pilots || [];
    if (msg.action === "campaign_pilot_recruit") {
      check(entries.length < 500, "战役驾驶员数量已达上限");
      let profile, previous, price;
      if (msg.aceId) {
        check(available(ctx, state, team, msg.aceId), "该ACE尚未开发或暂不可招募");
        previous = find(state, team, "ace-" + msg.aceId);
        check(
          !previous || (previous.profile.needsRecruitment && permits(members, seat, previous)),
          "该ACE已招募或无权招募",
        );
        profile = P.recruitAce(msg.aceId, previous?.profile);
        price = P.recruitmentPrice(msg.aceId, previous?.profile);
      } else {
        profile = P.createCustom(
          "custom-campaign-" + state.nextId,
          msg.name,
          msg.portraitId,
          pool.faction,
        );
        price = { money: P.customRecruitmentCost, supplies: 0 };
      }
      check(pool.money >= price.money && pool.supplies >= price.supplies, "阵营资源不足");
      pool.money -= price.money;
      pool.supplies -= price.supplies;
      if (previous) previous.profile = profile;
      else {
        state.pilots = [...entries, { ownerSeat: seat, team, profile }];
        state.nextId++;
      }
      return;
    }
    if (msg.action === "campaign_pilot_assign") {
      const unit = state.units.find((item) => item.id === msg.armyId && !item.destroyed);
      check(unit && ctx.controls(state, members, seat, unit), "无权指挥这支部队");
      editable(state, unit);
      const entry = msg.pilotId === null ? null : find(state, team, msg.pilotId);
      check(
        msg.pilotId === null ||
          (entry &&
            permits(members, seat, entry) &&
            !entry.profile.needsRecruitment &&
            P.canAssign(entry.profile, pool.faction)),
        "驾驶员不可配属",
      );
      check(
        !entry || !assigned(state, entry) || assigned(state, entry).id === unit.id,
        "驾驶员已配属其他单位",
      );
      unit.pilotId = entry?.profile.id || null;
      sync(ctx, state, unit, entry?.profile);
      return;
    }
    const entry = find(state, team, msg.pilotId);
    check(entry && permits(members, seat, entry), "无权管理该驾驶员");
    const unit = assigned(state, entry);
    if (unit) editable(state, unit);
    const p = entry.profile;
    check(!p.needsRecruitment, "该ACE需要重新招募");
    let next,
      money = 0;
    switch (msg.action) {
      case "campaign_pilot_train": {
        check(
          !p.ace && Object.hasOwn(P.labels, msg.stat) && [1, 5].includes(msg.amount),
          "属性强化无效",
        );
        check(
          p.points >= msg.amount && p.stats[msg.stat] + msg.amount <= P.statCap(p.level),
          "强化点不足或达到属性上限",
        );
        next = P.custom({
          ...p,
          stats: { ...p.stats, [msg.stat]: p.stats[msg.stat] + msg.amount },
        });
        break;
      }
      case "campaign_pilot_upgrade":
        money = P.upgradeCost(p);
        next = P.upgrade(p);
        break;
      case "campaign_pilot_demote":
        money = P.demotionCost(p);
        next = P.demote(p);
        break;
      case "campaign_pilot_reincarnate":
        money = P.reincarnationCost(p);
        next = P.reincarnate(p);
        break;
      case "campaign_pilot_reset":
        money = 1000 * p.level;
        next = P.refundTraining(p);
        break;
      case "campaign_pilot_skill":
        next = P.learnSkill(p, msg.skillId);
        break;
      default:
        throw Error("未知驾驶员操作");
    }
    check(Number.isFinite(money) && pool.money >= money, "阵营资金不足");
    pool.money -= money;
    entry.profile = next;
    if (unit) sync(ctx, state, unit, next);
  }
  function capture(state, game) {
    for (const entry of state.pilots || []) {
      // Escaping machines may leave a dead shell and a live successor with the same crew.
      const actors = game.units.filter(
        (actor) => actor.team === entry.team && actor.pilot?.id === entry.profile.id,
      );
      const actor = actors.find((actor) => actor.hp > 0) || actors.at(-1);
      if (!actor) continue;
      entry.profile = P.custom(actor.pilot);
      for (const unit of state.units.filter(
        (unit) => unit.team === entry.team && unit.pilotId === entry.profile.id,
      ))
        unit.pilotId = null;
      const unit = state.units.find((unit) => unit.id === actor.campaignId && !unit.destroyed);
      if (unit) unit.pilotId = entry.profile.id;
    }
  }
  function validate(state, members) {
    const entries = state.pilots ?? [];
    check(Array.isArray(entries) && entries.length <= 500, "战役驾驶员数据无效");
    const ids = new Set();
    const clean = entries.map((entry) => {
      check(
        Number.isInteger(entry.ownerSeat) &&
          members.some((item) => item.seat === entry.ownerSeat) &&
          entry.team === entry.ownerSeat % 2,
        "驾驶员控制权无效",
      );
      const profile = P.custom(entry.profile),
        id = entry.team + ":" + profile.id;
      check(
        !ids.has(id) && P.canAssign(profile, state.teams[entry.team].faction),
        "驾驶员重复或阵营无效",
      );
      ids.add(id);
      return { ownerSeat: entry.ownerSeat, team: entry.team, profile };
    });
    const occupied = new Set();
    for (const unit of state.units)
      if (unit.pilotId) {
        const entry = clean.find(
            (item) => item.team === unit.team && item.profile.id === unit.pilotId,
          ),
          key = unit.team + ":" + unit.pilotId;
        check(
          !unit.destroyed && entry && !entry.profile.needsRecruitment && !occupied.has(key),
          "驾驶员配属无效或重复",
        );
        occupied.add(key);
        if (unit.state?.pilot)
          check(
            JSON.stringify(P.custom(unit.state.pilot)) === JSON.stringify(entry.profile),
            "驾驶员战场状态不一致",
          );
      }
    return clean;
  }
  return { find, assigned, permits, available, action, capture, validate };
})();
if (typeof module !== "undefined") module.exports = CampaignPilots;
