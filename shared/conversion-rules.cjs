/* Data-only conversion settings; loaded before additive editor exceptions. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const file = "shared/conversion-rules.json";
const Classes = require("./weapon-classes.js");
const fields = {
  weapons: {
    beamRifleDamage: [
      "光束步枪伤害倍率",
      0.01,
      10,
      false,
      "排除战舰、MA、腕部内置武器与格斗武器。当前150%。",
    ],
    bazookaDamage: [
      "火箭筒伤害倍率",
      0.01,
      10,
      false,
      "实弹和光束火箭筒统一使用，不叠加光束步枪倍率。",
    ],
    mortarAccuracy: ["迫击炮基础命中倍率", 0.01, 10, false, "按原始基础命中相乘，包含分段命中率。"],
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
    meleeDamage: ["格斗伤害倍率", 0.01, 10, false, "冲撞除外。当前110%。"],
    machineGunDamage: ["机枪伤害倍率", 0.01, 10, false, "不重复缩减战舰原生伤害。当前75%。"],
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
function validate(value) {
  if (
    !value ||
    value.schemaVersion !== 1 ||
    Object.keys(value).some((k) => !["schemaVersion", ...Object.keys(fields)].includes(k))
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
  const isWeaponSkill = (skill) =>
    !!skill.sourceWeapon || skill.reconMode === "camera" || skill.type === "beam_diffusion";
  const scaled = (value) =>
    [value.damage, value.accuracy, value.ap, value.en, value.range].some((n) => n !== 1) ||
    value.rangeBonus !== 0 ||
    value.sniperRangeBonus !== 0;
  for (const weapon of [
    ...Object.values(prefab.weapons || {}),
    ...(prefab.skills || []).filter(isWeaponSkill),
  ]) {
    const old = weapon.conversionMultipliers;
    if (!old && !scaled(w) && !isHeadOrWrist(weapon)) continue;
    const numericFields = ["hit", "actionCost", "en", "enCost", "min", "minRange", "max", "range"];
    const base =
      old ||
      Object.fromEntries(
        numericFields
          .filter((key) => Number.isFinite(weapon[key]))
          .map((key) => [key, weapon[key]]),
      );
    if (Classes.machineGun(weapon)) base.actionCost = w.machineGunAP;
    if (Classes.classify(weapon) === "bazooka") base.actionCost = 3;
    scaleDamage(weapon, w.damage / (old?.damageScale || 1));
    if (base.hit !== undefined) weapon.hit = base.hit * w.accuracy;
    if (base.actionCost !== undefined)
      weapon.actionCost = Math.max(0.5, roundAP(base.actionCost * w.ap));
    for (const key of ["en", "enCost"])
      if (base[key] !== undefined)
        weapon[key] = w.en === 1 ? base[key] : Math.ceil(base[key] * w.en);
    for (const key of ["min", "minRange"])
      if (base[key] !== undefined)
        weapon[key] = w.range === 1 ? base[key] : Math.round(base[key] * w.range);
    const bonus = Classes.classify(weapon) === "sniper" ? w.sniperRangeBonus : w.rangeBonus;
    if (base.max !== undefined)
      weapon.max = Math.max(1, (w.range === 1 ? base.max : Math.round(base.max * w.range)) + bonus);
    if (base.range !== undefined)
      weapon.range = Math.max(
        1,
        (w.range === 1 ? base.range : Math.round(base.range * w.range)) + bonus,
      );
    if (isHeadOrWrist(weapon)) {
      weapon.actionCost = Math.max(0.5, roundAP(w.headWristAP));
      if (weapon.sourceWeapon || weapon.minRange !== undefined) {
        weapon.minRange = 1;
        weapon.range = w.headWristRange;
      } else {
        weapon.min = 1;
        weapon.max = w.headWristRange;
      }
    }
    for (const step of weapon.attack?.steps || [])
      if (step.accuracy !== undefined)
        step.accuracy = (step.accuracy / (old?.accuracyScale || 1)) * w.accuracy;
    if (!scaled(w)) delete weapon.conversionMultipliers;
    else
      weapon.conversionMultipliers = { ...base, damageScale: w.damage, accuracyScale: w.accuracy };
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
module.exports = { file, fields, validate, read, globals, isHeadOrWrist, roundAP };
