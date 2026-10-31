/* Source editing vocabulary. Loaded only by the local editor and its service. */
const CatalogEditorSchema = (() => {
  const weaponFields = [
    "name",
    "weaponClass",
    "localization",
    "damagePerShot",
    "damageComponents",
    "min",
    "max",
    "hit",
    "en",
    "actionCost",
    "antiSize",
    "targetModifiers",
    "partBreakModifier",
    "attack",
  ];
  const safeSkillTypes = [
    "repair",
    "recon",
    "minovsky",
    "resupply",
    "smoke",
    "emp",
    "flight",
    "fullboost",
    "overboost",
    "beam_diffusion",
    "irradiation",
  ];
  const mechanismFields = [
    "autoRepair",
    "supplyAura",
    "commandAuras",
    "stealth",
    "iField",
    "pilotExperienceMultiplier",
  ];
  const labels = {
    hp: "HP",
    en: "EN",
    cost: "COST",
    speed: "机动",
    mobility: "反应系数",
    accuracy: "命中系数",
    actionPoints: "基础AP",
    move: "基础移动距离",
    partStructuralStrength: "零件强度",
    counterLimit: "反击上限",
    sight: "视野距离",
    radar: "侦察距离",
    antiDetection: "反隐距离",
    ground: "地面",
    space: "宇宙",
    air: "空中",
    water: "水中",
    atmosphere: "大气层",
    mountain: "山地",
    forest: "树林",
    snow: "雪地",
    desert: "沙漠",
    rubble: "废墟",
    beam: "光束",
    shell: "实弹",
    melee: "格斗",
    meleeBeam: "格斗光束",
    meleeShell: "格斗实弹",
    shooting: "射击",
    dp: "DP",
    sp: "SP",
    percent: "抗性（%）",
    flat: "固定减伤",
    blockChance: "格挡率（0～1）",
    coverage: "盾牌覆盖（0～1）",
    min: "最小射程",
    max: "最大射程",
    hit: "基础命中率（%）",
    actionCost: "AP",
    partBreakModifier: "部位破坏系数",
    small: "小型",
    medium: "中型",
    large: "大型",
    damage: "伤害倍率",
    attackBonuses: "伤害加成（%）",
    autoRepair: "自动维修",
    supplyAura: "补给光环",
    commandAuras: "指挥光环",
    stealth: "隐身",
    iField: "I立场",
    pilotExperienceMultiplier: "学习型电脑／经验倍率",
  };
  function setDamage(weapon, value) {
    const old = Object.values(weapon.damageComponents || {}).reduce((a, b) => a + b, 0);
    const scale = old ? value / old : 0;
    const rescale = (components) =>
      Object.fromEntries(Object.entries(components).map(([key, amount]) => [key, amount * scale]));
    weapon.damageComponents = old
      ? rescale(weapon.damageComponents)
      : { [weapon.type === "melee" ? "melee" : weapon.type === "beam" ? "beam" : "shell"]: value };
    weapon.damagePerShot = value;
    for (const step of weapon.attack?.steps || [])
      if (step.damageComponents)
        step.damageComponents = old
          ? rescale(step.damageComponents)
          : { ...weapon.damageComponents };
  }
  function setHit(weapon, value) {
    weapon.hit = value;
    for (const step of weapon.attack?.steps || [])
      if (step.accuracy !== undefined) step.accuracy = value;
  }
  return { weaponFields, safeSkillTypes, mechanismFields, labels, setDamage, setHit };
})();
if (typeof module !== "undefined") module.exports = CatalogEditorSchema;
