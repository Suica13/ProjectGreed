/* 原MOD的MS部位判定：结构强度抵抗破坏，单次失血和当前损伤决定概率。 */
const UnitParts = (() => {
  const names = Object.freeze({
    head: "头部",
    backpack: "背包",
    leftArm: "左臂",
    rightArm: "右臂",
    leftLeg: "左腿",
    rightLeg: "右腿",
  });
  // 原 int(rnd(0,71))：末尾70号为空，不对已坏部位重抽。
  const slots = [
    ["head", 15],
    ["backpack", 30],
    ["leftArm", 40],
    ["rightArm", 50],
    ["leftLeg", 60],
    ["rightLeg", 70],
  ];
  function penalties(unit) {
    const broken = unit.brokenParts || {};
    const limbs = ["leftArm", "rightArm", "leftLeg", "rightLeg"].filter(
      (part) => broken[part],
    ).length;
    return {
      attackMultiplier: broken.head ? 0.75 : 1,
      moveMultiplier: broken.backpack ? 0.75 : 1,
      resistancePenalty: limbs * 2.5,
    };
  }
  function unavailable(unit, weapon) {
    const broken = unit.brokenParts || {};
    const missing = (weapon.requiredParts || []).filter((part) => broken[part]);
    if (weapon.anyParts?.length && weapon.anyParts.every((part) => broken[part]))
      missing.push(...weapon.anyParts);
    return [...new Set(missing)];
  }
  function shieldUsable(unit, shield) {
    return !(shield.requiredParts || []).some((part) => unit.brokenParts?.[part]);
  }
  function chance(unit, model, damage, modifier = 1) {
    if (unit.hp <= 0 || damage <= 0 || modifier <= 0) return 0;
    const factor = (damage / model.hp) * 2 * Math.max(0, 1 - unit.hp / model.hp) * modifier;
    return factor > 0
      ? Math.max(0, 1 - (5 * (model.partStructuralStrength ?? 100)) / 100 / (101 * factor))
      : 0;
  }
  function random(game) {
    game.partSeed =
      (Math.imul(1664525, game.partSeed ?? (game.seed || 0) ^ 0x85ebca6b) + 1013904223) >>> 0;
    return game.partSeed / 4294967296;
  }
  function applyHit(game, unit, model, damage, modifier = 1) {
    const probability = chance(unit, model, damage, modifier);
    if (probability <= 0 || random(game) <= 1 - probability) return null;
    const slot = Math.floor(random(game) * 71),
      part = slots.find(([, end]) => slot < end)?.[0];
    if (!part || unit.brokenParts?.[part]) return null;
    unit.brokenParts = { ...unit.brokenParts, [part]: true };
    if (!shieldUsable(unit, model.shield)) unit.shield = 0;
    return part;
  }
  return { names, penalties, unavailable, shieldUsable, chance, applyHit };
})();
if (typeof module !== "undefined") module.exports = UnitParts;
