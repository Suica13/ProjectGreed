/* Data-only conversion settings; loaded before additive editor exceptions. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const file = "shared/conversion-rules.json";
const Classes = require("./weapon-classes.js");
const fields = {
  weapons: {
    headWristAP: [
      "头部火神炮／腕部武器最终AP",
      0.5,
      99,
      false,
      "最终费用，优先于机枪及通用AP倍率，按0.5点取整。",
    ],
    headWristRange: [
      "头部火神炮／腕部武器最大射程",
      1,
      99,
      true,
      "最小射程固定1，不叠加普通额外射程。",
    ],
    machineGunAP: ["机枪基础AP消耗", 1, 99, true, "固定基础值，再乘下方武器AP倍率。"],
    damage: ["全部武装伤害倍率", 0.01, 10, false, "在武器分类倍率之后叠乘，包含有伤害的机体技能。"],
    accuracy: ["武器命中率倍率", 0.01, 10, false, "同时处理单发及分段命中率。"],
    ap: ["武器AP消耗倍率", 0.01, 10, false, "按0.5点四舍五入；不改变每次攻击的发数。"],
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
    ap: [
      "单位每回合基础AP倍率",
      0.01,
      10,
      false,
      "按0.5点四舍五入，最低1点；随后计算机体和驾驶员机动倍率。",
    ],
    move: ["单位基础移动距离倍率", 0.01, 10, false, "四舍五入，最低1格；不修改动画播放速度。"],
    accuracy: ["单位命中系数倍率", 0.01, 10, false, "独立于上方武器本身的命中率。"],
    reaction: ["单位反应系数倍率", 0.01, 10, false, "对应回避用的反应系数，不是机动。"],
  },
};
const classFields = {
  baseAP: ["基础AP（-1继承）", -1, 99, false],
  baseEN: ["基础EN（-1继承）", -1, 999999, false],
  baseHit: ["基础命中率（-1继承）", -1, 1000, false],
  minRange: ["基础最小射程（-1继承）", -1, 100, false],
  maxRange: ["基础最大射程（-1继承）", -1, 100, false],
  damage: ["分类伤害倍率", 0.01, 10, false],
  accuracy: ["分类命中倍率", 0.01, 10, false],
  ap: ["分类AP倍率", 0.01, 10, false],
  en: ["分类EN倍率", 0.01, 10, false],
  range: ["分类射程倍率", 0.01, 10, false],
  rangeBonus: ["分类最大射程增减", -100, 100, true],
};
function validate(value) {
  if (
    !value ||
    value.schemaVersion !== 2 ||
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
  if (!checkKeys(value.weaponClasses, Object.keys(Classes.mainLabels)))
    throw Error("武器主分类规则不完整");
  for (const main of Object.keys(Classes.mainLabels)) {
    const entries = value.weaponClasses[main];
    if (!checkKeys(entries, Object.keys(Classes.labels)))
      throw Error("武器子分类规则不完整：" + main);
    for (const [sub, group] of Object.entries(entries)) {
      if (!checkKeys(group, Object.keys(classFields)))
        throw Error("分类规则字段不完整：" + main + "/" + sub);
      if (group.minRange >= 0 && group.maxRange >= 0 && group.minRange > group.maxRange)
        throw Error("分类基础最小射程不能大于最大射程：" + main + "/" + sub);
      for (const [key, [label, min, max, integer]] of Object.entries(classFields)) {
        const n = group[key];
        if (
          !Number.isFinite(n) ||
          n < min ||
          n > max ||
          (integer && !Number.isInteger(n)) ||
          (["baseAP", "baseEN", "baseHit", "minRange", "maxRange"].includes(key) &&
            n < 0 &&
            n !== -1)
        )
          throw Error(label + "无效：" + main + "/" + sub);
      }
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
const isHeadOrWrist = Classes.headOrWrist;
const roundAP = (value) => Math.round(value * 2) / 2;
function globals(prefab, rules) {
  const w = rules.weapons;
  const isWeaponSkill = Classes.isWeaponSkill;
  for (const weapon of [
    ...Object.values(prefab.weapons || {}),
    ...(prefab.skills || []).filter(isWeaponSkill),
  ]) {
    const group = Classes.rule(weapon, rules);
    const old = weapon.conversionMultipliers;
    const numericFields = [
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
    const accuracy = w.accuracy * group.accuracy,
      en = w.en * group.en,
      range = w.range * group.range;
    scaleDamage(weapon, w.damage / (old?.damageScale || 1));
    for (const key of ["hit", "baseHit"])
      if (base[key] !== undefined)
        weapon[key] = (group.baseHit >= 0 ? group.baseHit : base[key]) * accuracy;
    const tacticalAP =
      group.baseAP >= 0
        ? group.baseAP
        : Classes.machineGun(weapon)
          ? w.machineGunAP
          : Classes.classify(weapon) === "bazooka"
            ? 3
            : base.actionCost;
    if (tacticalAP !== undefined)
      weapon.actionCost = Math.max(0.5, roundAP(tacticalAP * w.ap * group.ap));
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
    if (isHeadOrWrist(weapon)) {
      if (group.baseAP < 0) weapon.actionCost = Math.max(0.5, roundAP(w.headWristAP * group.ap));
      const min = Math.max(1, Math.round((group.minRange >= 0 ? group.minRange : 1) * group.range)),
        max = Math.max(
          min,
          Math.round((group.maxRange >= 0 ? group.maxRange : w.headWristRange) * group.range) +
            group.rangeBonus,
        );
      if (weapon.sourceWeapon || base.minRange !== undefined) {
        weapon.minRange = min;
        weapon.range = max;
      } else {
        weapon.min = min;
        weapon.max = max;
      }
    }
    for (const step of weapon.attack?.steps || [])
      if (step.accuracy !== undefined)
        step.accuracy =
          (group.baseHit >= 0 ? group.baseHit : step.accuracy / (old?.accuracyScale || 1)) *
          accuracy;
    weapon.conversionMultipliers = { ...base, damageScale: w.damage, accuracyScale: accuracy };
  }
  for (const skill of (prefab.skills || []).filter((skill) => !isWeaponSkill(skill)))
    if (skill.damageComponents) {
      const old = skill.conversionMultipliers;
      scaleDamage(skill, w.damage / (old?.damageScale || 1));
      if (w.damage !== 1) skill.conversionMultipliers = { damageScale: w.damage };
      else delete skill.conversionMultipliers;
    }
  const fields = {
    hp: "hp",
    en: "en",
    ap: "actionPoints",
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
      if (key === "ap") n = roundAP(n);
      if (key === "move") n = Math.round(n);
      if (["hp", "ap", "move"].includes(key)) n = Math.max(1, n);
      prefab.stats[field] = n;
    }
    if (Object.values(rules.units).every((n) => n === 1)) delete prefab.conversionBase;
    else prefab.conversionBase = base;
  }
  return prefab;
}
module.exports = {
  file,
  fields,
  classFields,
  validate,
  read,
  globals,
  isHeadOrWrist,
  roundAP,
  scaleDamage,
};
