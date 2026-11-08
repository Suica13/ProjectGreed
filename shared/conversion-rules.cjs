/* Data-only conversion settings; loaded before additive editor exceptions. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const file = "shared/conversion-rules.json";
const Classes = require("./weapon-classes.js");
const fields = {
  weapons: {
    shootingDamageOffset: ["射击全局伤害系数增减", -0.99, 10, false, "加到全部武装伤害倍率上，仅射击武器及伤害型射击技能生效；不影响近战与冲撞。"],
    shootingHitOffset: ["射击基础命中增减", -100, 100, false, "分类基础命中直接增减百分点，再应用命中倍率；包含分段射击及照射。"],
    shipMediumAccuracyBonus: ["战舰对中型命中补偿", 0, 1, false, "只减轻已有对中型命中惩罚，最高恢复到1；不影响非战舰。"],
    damage: ["全部武装伤害倍率", 0.01, 10, false, "在武器分类倍率之后叠乘，包含有伤害的机体技能。"],
    accuracy: ["武器命中率倍率", 0.01, 10, false, "同时处理单发及分段命中率。"],
    shipCannonAccuracy: ["舰炮命中倍率", 0.01, 10, false, "战舰的加农炮、光束炮和迫击炮额外乘此系数；不包含机枪、对空炮、导弹和航空炸弹。"],
    armorPiercingIgnore: ["穿甲无视抗性比例", 0, 1, false, "0.5表示只计算目标50%的对应抗性；固定减伤、盾牌和最终减伤仍正常计算。可由单武器特例覆盖。"],
    penetrationDamagePerCount: ["每次原生贯穿附伤", 0, 10, false, "有衰减且次数大于1的远程弹丸：基础光束/实弹伤害×原次数×本值，追加对应穿甲分量。"],
    sniperDamage: ["普通狙击伤害倍率", 0.01, 10, false, "仅普通狙击武器，不与蓄力狙击倍率叠加。"],
    chargedSniperDamage: ["蓄力狙击伤害倍率", 0.01, 10, false, "仅蓄力狙击技能，替代普通狙击倍率。"],
    projectileSpeed: ["原MOD弹速倍率", 0.01, 10, false, "直接乘原生ProjectileSpeed；照射和迫击炮保持原值。"],
    en: ["武器EN消耗倍率", 0.01, 10, false, "消耗向上取整。"],
    rangeBonus: [
      "普通武器额外最大射程",
      0,
      100,
      true,
      "倍率计算后增加的格数；最小射程不变。包含照射、摄像枪等武器技能。",
    ],
    sniperRangeBonus: [
      "狙击／蓄力狙击额外最大射程",
      0,
      100,
      true,
      "代替普通武器额外射程，不重复叠加。",
    ],
    range: ["武器射程倍率", 0.01, 10, false, "最小和最大射程同时换算为整数。"],
  },
  units: {
    hp: ["单位耐久倍率", 0.01, 10, false, "以现有单位基础值换算，向上取整。"],
    en: ["单位EN上限倍率", 0.01, 10, false, "以现有基础值换算，向上取整。"],
    move: ["单位基础移动距离倍率", 0.01, 10, false, "基础距离乘倍率后四舍五入，再加原移植战术加成（普通单位+1、战舰+3）；不修改动画速度。"],
    accuracy: ["单位命中系数倍率", 0.01, 10, false, "独立于上方武器本身的命中率。"],
    reaction: ["单位反应系数倍率", 0.01, 10, false, "对应回避用的反应系数，不是机动。"],
  },
};
const classFields = {
  baseEN: ["基础EN（-1继承）", -1, 999999, false],
  baseHit: ["基础命中率（-1继承）", -1, 1000, false],
  minRange: ["基础最小射程（-1继承）", -1, 100, false],
  maxRange: ["基础最大射程（-1继承）", -1, 100, false],
  damage: ["分类伤害倍率", 0.01, 10, false],
  accuracy: ["分类命中倍率", 0.01, 10, false],
  en: ["分类EN倍率", 0.01, 10, false],
  range: ["分类射程倍率", 0.01, 10, false],
  rangeBonus: ["分类最大射程增减", -100, 100, true],
};
function validate(value) {
  if (value?.weapons) for (const key of ["shootingDamageOffset", "shootingHitOffset", "shipMediumAccuracyBonus"])
    value.weapons[key] ??= 0;
  if (value?.weapons && value.weapons.shipCannonAccuracy === undefined) value.weapons.shipCannonAccuracy = 0.85;
  if (value?.weapons && value.weapons.armorPiercingIgnore === undefined) value.weapons.armorPiercingIgnore = 0.5;
  // Older editor clients may omit this newly introduced setting.
  if (value?.weapons && value.weapons.projectileSpeed === undefined) value.weapons.projectileSpeed = 0.1;
  if (
    !value ||
    value.schemaVersion !== 3 ||
    Object.keys(value).some(
      (k) => !["schemaVersion", "weaponClasses", ...Object.keys(fields)].includes(k),
    )
  )
    throw Error("换算规则版本或字段无效");
  for (const [group, entries] of Object.entries(fields)) {
    if (!value[group] || Object.keys(value[group]).length !== Object.keys(entries).length)
      throw Error("换算规则字段不完整：" + group);
    for (const [key, [label, min, max, integer]] of Object.entries(entries)) {
      const n = value[group][key];
      if (!Number.isFinite(n) || n < min || n > max || (integer && !Number.isInteger(n)))
        throw Error(`${label}必须在${min}～${max}之间${integer ? "且为整数" : ""}`);
    }
  }
  const checkKeys = (object, expected) =>
    object &&
    !Array.isArray(object) &&
    Object.keys(object).length === expected.length &&
    expected.every((key) => Object.hasOwn(object, key));
  if (!checkKeys(value.weaponClasses, Object.keys(Classes.labels)))
    throw Error("武器类型规则不完整");
  for (const [kind, group] of Object.entries(value.weaponClasses)) {
    if (!checkKeys(group, Object.keys(classFields))) throw Error("武器类型字段不完整：" + kind);
    if (group.minRange >= 0 && group.maxRange >= 0 && group.minRange > group.maxRange)
      throw Error("最小射程不能大于最大射程：" + kind);
    for (const [key, [label, min, max, integer]] of Object.entries(classFields)) {
      const n = group[key];
      if (
        !Number.isFinite(n) ||
        n < min ||
        n > max ||
        (integer && !Number.isInteger(n)) ||
        (["baseEN", "baseHit", "minRange", "maxRange"].includes(key) && n < 0 && n !== -1)
      )
        throw Error(label + "无效：" + kind);
    }
  }
  return value;
}
function read(root = path.resolve(__dirname, "..")) {
  return validate(JSON.parse(fs.readFileSync(path.join(root, file), "utf8")));
}
function scaleDamage(weapon, ratio) {
  if (ratio === 1) return;
  for (const payload of [weapon, ...(weapon.attack?.steps || [])]) {
    for (const key of ["damage", "damagePerShot"])
      if (Number.isFinite(payload[key])) payload[key] *= ratio;
    if (payload.damageComponents)
      for (const key of Object.keys(payload.damageComponents))
        payload.damageComponents[key] *= ratio;
  }
}
// Match actual source families, not handheld weapons attached to an arm or ArmBeamSaber.
function globals(prefab, rules) {
  const w = rules.weapons;
  const isWeaponSkill = Classes.isWeaponSkill;
  for (const weapon of [
    ...Object.values(prefab.weapons || {}),
    ...(prefab.skills || []).filter(isWeaponSkill),
  ]) {
    delete weapon.onHitAPLoss;
    weapon.attackRounds ??= Classes.baseRounds(weapon);
    // Native Sniper_Aim spawns a slow marker helper, not the visible damage shot.
    // Retain that native payload for audit; the paid shot uses its real rifle's
    // projectile artwork and speed, with the same global conversion applied once.
    const flightSource = weapon.special?.type === "snipe"
      ? prefab.weapons?.[weapon.special.baseWeapon] : null;
    if (flightSource?.projectile) weapon.projectile = structuredClone(flightSource.projectile);
    if (weapon.projectile && !["mortar", "irradiation"].includes(Classes.classify(weapon))) {
      // Always start from retained MOD data, never divide an already converted speed.
      const payloadSpeed = (flightSource || weapon).nativePayload?.ProjectileSpeed;
      const nativeSpeed = payloadSpeed > 0 ? payloadSpeed : weapon.projectile.nativeSpeed ?? weapon.projectile.speed;
      weapon.projectile.nativeSpeed = nativeSpeed;
      weapon.projectile.speed = (weapon.projectile.presentationSpeed ?? nativeSpeed) * w.projectileSpeed;
      if (weapon.projectile.cluster) {
        const cluster = weapon.projectile.cluster;
        cluster.nativeSpeed ??= cluster.speed;
        cluster.speed = cluster.nativeSpeed * w.projectileSpeed;
      }
    }
    const group = Classes.rule(weapon, rules);
    const shooting = !["melee", "ram"].includes(Classes.classify(weapon));
    const old = weapon.conversionMultipliers;
    const numericFields = [
      "armorPiercingIgnore",
      "hit",
      "baseHit",
      "actionCost",
      "en",
      "enCost",
      "enCostPercent",
      "min",
      "minRange",
      "max",
      "range",
    ];
    const base =
      old ||
      Object.fromEntries(
        numericFields
          .filter((key) => Number.isFinite(weapon[key]))
          .map((key) => [key, weapon[key]]),
      );
    weapon.armorPiercingIgnore = base.armorPiercingIgnore ?? w.armorPiercingIgnore;
    const medium = weapon.antiSize?.medium;
    if (prefab.stats?.ship && Number.isFinite(medium?.accuracy)) {
      base.antiMediumAccuracy ??= medium.accuracy;
      medium.accuracy = base.antiMediumAccuracy < 1
        ? Math.min(1, base.antiMediumAccuracy + (w.shipMediumAccuracyBonus || 0)) : base.antiMediumAccuracy;
    }
    const shipCannon = Classes.shipCannon(weapon, prefab.stats?.ship);
    const accuracy = w.accuracy * group.accuracy * (shipCannon ? (w.shipCannonAccuracy ?? 0.85) : 1),
      en = w.en * group.en,
      range = group.range;
    const sniperScale = weapon.special?.type === "snipe" ? w.chargedSniperDamage : Classes.classify(weapon) === "sniper" ? w.sniperDamage : 1;
    // Remove the previous derived bonus before scaling again (editor previews/reloads).
    for (const payload of [weapon, ...(weapon.attack?.steps || [])]) {
      if (payload.penetrationBonus && payload.damageComponents) {
        for (const [channel, value] of Object.entries(payload.penetrationBonus))
          payload.damageComponents[channel] -= value;
        delete payload.penetrationBonus;
      }
    }
    const damageScale = Math.max(0.01, w.damage + (shooting ? w.shootingDamageOffset || 0 : 0)) * sniperScale;
    const hitOffset = shooting ? w.shootingHitOffset || 0 : 0;
    scaleDamage(weapon, damageScale / (old?.damageScale || 1));
    if (weapon.type !== "melee" && weapon.nativePayload?.ProjectileAttackTimesDamageModifier < 1 &&
        weapon.nativePayload.ProjectileAttackTimes > 1) {
      const count = weapon.nativePayload.ProjectileAttackTimes;
      weapon.penetrationCount = count;
      for (const payload of [weapon, ...(weapon.attack?.steps || [])]) {
        if (!payload.damageComponents) continue;
        const bonus = {};
        for (const [baseChannel, piercingChannel] of [["beam", "beamAP"], ["shell", "shellAP"]]) {
          const extra = (payload.damageComponents[baseChannel] || 0) * (payload.penetrationCount ?? count) * w.penetrationDamagePerCount;
          if (!extra) continue;
          payload.damageComponents[piercingChannel] = (payload.damageComponents[piercingChannel] || 0) + extra;
          bonus[piercingChannel] = extra;
        }
        payload.penetrationBonus = bonus;
        payload.damagePerShot = Object.values(payload.damageComponents).reduce((sum, n) => sum+n, 0);
      }
    }
    for (const key of ["hit", "baseHit"])
      if (base[key] !== undefined)
        weapon[key] = Math.max(0, (group.baseHit >= 0 ? group.baseHit : base[key]) + hitOffset) * accuracy;
    if (prefab.stats?.ship) weapon.shipWeapon = true;
    else delete weapon.shipWeapon;
    if (Classes.wristWeapon(weapon)) weapon.maxUsesPerTurn = 1;
    for (const key of ["en", "enCost"])
      if (base[key] !== undefined) {
        const value = group.baseEN >= 0 ? group.baseEN : base[key];
        weapon[key] = en === 1 ? value : Math.ceil(value * en);
      }
    if (base.enCostPercent !== undefined) {
      weapon.enCostPercent = base.enCostPercent * en;
      if (group.baseEN >= 0) weapon.enCost = en === 1 ? group.baseEN : Math.ceil(group.baseEN * en);
      else if (base.enCost === undefined) delete weapon.enCost;
    }
    for (const key of ["min", "minRange"])
      if (base[key] !== undefined)
        weapon[key] =
          range === 1
            ? group.minRange >= 0
              ? group.minRange
              : base[key]
            : Math.round((group.minRange >= 0 ? group.minRange : base[key]) * range);
    const bonus =
      (Classes.classify(weapon) === "sniper" ? w.sniperRangeBonus : w.rangeBonus) +
      group.rangeBonus;
    for (const key of ["max", "range"])
      if (base[key] !== undefined)
        weapon[key] = Math.max(
          1,
          (range === 1
            ? group.maxRange >= 0
              ? group.maxRange
              : base[key]
            : Math.round((group.maxRange >= 0 ? group.maxRange : base[key]) * range)) + bonus,
        );
    // Global range scaling applies once to the final tactical range, after bonuses.
    // Preserve native/base values for reimports and relative editor adjustments.
    for (const key of ["min", "minRange", "max", "range"])
      if (Number.isFinite(weapon[key])) weapon[key] = Math.max(1, Math.ceil(weapon[key] * w.range));
    // Area irradiation dimensions are explicit tactical cells, not imported
    // ordinary-weapon ranges. Apply editor deltas afterwards as usual.
    if (weapon.type === "irradiation" && weapon.areaWidth > 0) {
      weapon.range = base.range;
      weapon.minRange = base.minRange;
    }
    if (weapon.min !== undefined && weapon.max !== undefined)
      weapon.min = Math.min(weapon.min, weapon.max);
    if (weapon.minRange !== undefined && weapon.range !== undefined)
      weapon.minRange = Math.min(weapon.minRange, weapon.range);
    const steps = weapon.attack?.steps || [];
    base.stepAccuracy ??= steps.map(step => step.accuracy ?? null);
    for (const [index, step] of steps.entries())
      if (step.accuracy !== undefined)
        step.accuracy =
          Math.max(0, (group.baseHit >= 0 ? group.baseHit : base.stepAccuracy[index]) + hitOffset) *
          accuracy;
    weapon.conversionMultipliers = { ...base, damageScale, accuracyScale: accuracy };
  }
  for (const skill of (prefab.skills || []).filter((skill) => !isWeaponSkill(skill)))
    if (skill.damageComponents) {
      const old = skill.conversionMultipliers;
      const shooting = !["melee", "ram"].includes(Classes.classify(skill));
      const damageScale = Math.max(0.01, w.damage + (shooting ? w.shootingDamageOffset || 0 : 0));
      const baseHit = old?.baseHit ?? skill.baseHit;
      scaleDamage(skill, damageScale / (old?.damageScale || 1));
      if (Number.isFinite(baseHit)) skill.baseHit = Math.max(0, baseHit + (shooting ? w.shootingHitOffset || 0 : 0));
      skill.conversionMultipliers = { damageScale, ...(Number.isFinite(baseHit) ? {baseHit} : {}) };
    }
  const fields = {
    hp: "hp",
    en: "en",
    move: "move",
    accuracy: "accuracy",
    reaction: "mobility",
  };
  const old = prefab.conversionBase;
  if (old || Object.values(rules.units).some((n) => n !== 1)) {
    const base =
      old ||
      Object.fromEntries(
        Object.values(fields).map((key) => [
          key,
          prefab.stats[key] ?? (key === "accuracy" ? 100 : 0),
        ]),
      );
    for (const [key, field] of Object.entries(fields)) {
      let n = base[field] * rules.units[key];
      if (["hp", "en"].includes(key)) n = Math.ceil(n);
      if (key === "move") {
        // Source stats offset movement by native mobility; the compiler restores
        // it. Scale the actual tactical base, preserving the imported +1/+3.
        const mobilityOffset = Math.trunc(((prefab.stats.speed ?? 100) - 100) / 50);
        const bonus = Number.isFinite(prefab.sourceStats?.tacticalMoveBeforeBonus)
          ? (prefab.stats.ship ? 3 : 1) : 0;
        n = prefab.stats.deployed ? 0 :
          Math.max(1, Math.round((base.move + mobilityOffset - bonus) * rules.units.move) + bonus) - mobilityOffset;
      }
      if (key === "hp") n = Math.max(1, n);
      prefab.stats[field] = n;
    }
    if (Object.values(rules.units).every((n) => n === 1)) delete prefab.conversionBase;
    else prefab.conversionBase = base;
  }
  return roundValues(prefab);
}
// Quantize gameplay values after global rules and again after administrator offsets.
// Ratios, timing and animation coordinates deliberately retain their precision.
function roundValues(prefab) {
  for (const key of ["hp", "en", "cost", "actionPoints", "move", "speed", "mobility", "accuracy", "partStructuralStrength"])
    if (Number.isFinite(prefab.stats?.[key])) prefab.stats[key] = Math.round(prefab.stats[key]);
  for (const field of ["adaptability", "attackBonuses"])
    for (const key of Object.keys(prefab[field] || {}))
      if (Number.isFinite(prefab[field][key])) prefab[field][key] = Math.round(prefab[field][key]);
  for (const defense of Object.values(prefab.defenses || {}))
    for (const key of ["percent", "flat"])
      if (Number.isFinite(defense[key])) defense[key] = Math.round(defense[key]);
  if (Number.isFinite(prefab.shield?.hp)) prefab.shield.hp = Math.round(prefab.shield.hp);
  for (const weapon of [...Object.values(prefab.weapons || {}), ...(prefab.skills || []).filter(Classes.isWeaponSkill)]) {
    for (const key of ["hit", "baseHit", "min", "max", "minRange", "range", "actionCost", "en", "enCost"])
      if (Number.isFinite(weapon[key])) weapon[key] = Math.round(weapon[key]);
    for (const step of weapon.attack?.steps || [])
      if (Number.isFinite(step.accuracy)) step.accuracy = Math.round(step.accuracy);
  }
  return prefab;
}
module.exports = {
  roundValues,
  file,
  fields,
  classFields,
  validate,
  read,
  globals,
  scaleDamage,
};
