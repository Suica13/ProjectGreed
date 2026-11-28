/* Weapon types drive display, conversion and automatic attack cadence. Mounts remain in part/muzzle data. */
const WeaponClasses = (() => {
  const labels = {
    rifle: "实弹步枪",
    beam_rifle: "光束步枪",
    beam_spray: "光束喷枪",
    beam_gun: "光束枪",
    beam_cannon: "光束炮",
    beam_smart_gun: "精灵光束炮",
    shell_shotgun: "实弹霰弹枪",
    beam_shotgun: "光束霰弹枪",
    beam_bazooka: "光束火箭筒",
    beam: "其他光束武器",
    close_defense: "近防武器",
    small_vulcan: "火神炮",
    machine_gun: "机枪",
    bazooka: "火箭筒",
    panzerfaust: "铁拳",
    cannon: "加农炮",
    irradiation: "光束照射",
    melee: "近战",
    missile: "导弹",
    grenade: "手雷",
    grenade_launcher: "榴弹发射器",
    sniper: "狙击",
    mortar: "迫击炮",
    remote: "浮游炮／有线炮",
    flamethrower: "火焰喷射器",
    bomb: "航空炸弹",
    nuke: "核弹",
    ram: "冲撞",
    other: "其他",
  };
  const valid = (id) => Object.hasOwn(labels, id);
  const baseHits = {
    rifle: 95, beam_rifle: 90, beam_spray: 80, beam_gun: 85,
    beam_cannon: 70, beam_bazooka: 70, close_defense: 95,
    small_vulcan: 100, machine_gun: 100, bazooka: 75, panzerfaust: 65,
    cannon: 65, melee: 100, missile: 80, grenade: 65,
    grenade_launcher: 75, sniper: 100, mortar: 65, remote: 95,
    flamethrower: 85, bomb: 75, nuke: 65, ram: 90,
  };
  // Fixed shoulder/backpack cannon families; abdomen, waist and handheld cannons are excluded.
  const shoulderBeamSources = new Set([
    "EF_RX_77_4_BeamCannon", "EF_RGC_83_DoubleBeamCannon", "EF_FA_78_2_BeamCannon",
    "ZN_MS_14C_BeamCannon", "EF_RX_78_6_WIP_DoubleBeamCannon", "EF_RX_77D_4_BeamCannon",
    "AEUG_MSA_003_Cannon_DoubleBeamCannon", "AEUG_MSF_007_DoubleBeamCannon",
    "AEUG_MSA_004K_BeamCannon", "AEUG_RMS_099B_Red_DoubleBeamCannon",
    "AEUG_FA_00100S_DoubleBeamCannon", "AEUG_MSA_005K_DoubleBeamCannon",
    "AEUG_MSA_0011_BeamCannon", "TITANS_RX_121_3C_DoubleBeamCannon", "NZN_AMX_101K_BeamCannon",
  ]);
  const shoulderBeamCannon = (weapon, prefab) => shoulderBeamSources.has((weapon.sourceName || weapon.id || "").replace(/_L$/, "")) ||
    (prefab?.id === "FA_78_1_TB_WeaponModeB" && weapon.sourceName === "Common_Cannon");
  const shipCannon = (weapon, ship) => !!ship &&
    ["cannon", "beam_cannon", "mortar"].includes(classify(weapon)) &&
    weapon.rangeRole !== "ship_anti_air";
  const handheldCannon = weapon => classify(weapon) === "cannon" &&
    /^(?:EF_(?:180|170)mmCannon(?:_|$)|ZN_MagellaCannon(?:_|$))/i.test(weapon.sourceName || weapon.sourceWeapon || weapon.id || "");
  function classify(weapon, id = "") {
    const native = weapon.sourceName || weapon.sourceWeapon || id || weapon.id || "";
    if (!/Sniper|_Aim(?:_|$)/i.test(native) && weapon.special?.type !== "snipe") {
      if (/BeamSmartGun/i.test(native)) return "beam_smart_gun";
      if (/ShotGun|Shotgun/i.test(native) && !/Bazooka|(?:^|_)BZ(?:_|$)/i.test(native))
        return weapon.type === "beam" || /BeamShot/i.test(native) ? "beam_shotgun" : "shell_shotgun";
    }
    if (weapon.weaponClass !== undefined) {
      if (!valid(weapon.weaponClass))
        throw Error("Invalid weapon classification: " + weapon.weaponClass);
      return weapon.weaponClass;
    }
    const source = weapon.sourceName || weapon.sourceWeapon || id || weapon.id || "",
      category = weapon.category;
    if (category === "irradiation" || weapon.type === "irradiation") return "irradiation";
    if (/^Common_Push_|(?:^|_)Ram(?:_|$)/i.test(source)) return "ram";
    if (weapon.type === "melee" || category === "melee") return "melee";
    if (category === "sniper" || weapon.special?.type === "snipe") return "sniper";
    if (/BeamSpray|SprayGun/i.test(source) || category === "beam_spray") return "beam_spray";
    if (category === "machine_gun") {
      if (/Turret_?AA(?:_|$)/i.test(source)) return "close_defense";
      if (/Vulcan/i.test(source)) return "small_vulcan";
    }
    if (/Panzerfaust/i.test(source)) return "panzerfaust";
    if (/^Common_Grenade(?:_|$)/.test(source)) return "grenade";
    if (weapon.burn && /Flame/i.test(source)) return "flamethrower";
    if (/(?:_GL(?:_|$)|GrenadeLauncher)/i.test(source)) return "grenade_launcher";
    if (weapon.type === "beam") {
      if (category === "bazooka" || /Bazooka|(?:^|_)BZ(?:_|$)/i.test(source)) return "beam_bazooka";
      if (["cannon", "beam_cannon"].includes(category) || /Turret_?BG|BeamCannon/i.test(source))
        return "beam_cannon";
      if (category === "beam_gun" || /ArmBR|Wrist|HandBR|BeamGun/i.test(source)) return "beam_gun";
      if (category === "beam_rifle" || /BeamRifle|DoubleBR|(?:^|_)BR(?:_|$)/i.test(source))
        return "beam_rifle";
      if (["other", "missile"].includes(category)) return "beam";
    }
    if (category === "beam_rifle") return "rifle";
    return valid(category) ? category : "other";
  }
  const tags = (weapon) => [
    ...new Set([
      classify(weapon),
      ...(weapon.pairedChannels || []).map((c) => c.weaponClass).filter(valid),
    ]),
  ];
  const machineGun = (weapon, id) =>
    ["machine_gun", "small_vulcan", "close_defense"].includes(classify(weapon, id));
  // This detects firing cadence only; it never selects a balance/mount class.
  const headVulcan = (weapon) =>
    classify(weapon) === "small_vulcan" &&
    (/^Common_DoubleVulcan_MS(?:__lv\d+)?$|(?:^|_)Head(?:_|$)/i.test(
      weapon.sourceName || weapon.id || "",
    ) ||
      (weapon.requiredParts || []).some((p) => /^(?:Head|head)$/.test(p)));
  const wristWeapon = (weapon) =>
    /(?:^|_)(?:Arm(?:BR|BSG|BMG|MG|GL|MS|BeamSaber|Saber)|Wrist)(?:_|$|__lv)/i.test(
      weapon.sourceName || weapon.sourceWeapon || weapon.id || "",
    );
  // These utility melee families are usable without any pilot-stat threshold.
  const pilotGateExempt = (weapon) => weapon.type === "melee" &&
    /(?:^|_)(?:HeatRod|SeaSerpent|SeaSnake|SHM|HyperHammer|SuperHammer)(?:_|$)/i.test(
      weapon.sourceName || weapon.sourceWeapon || weapon.id || "");
  const headBeam = (weapon) =>
    weapon.type === "beam" &&
    (/(?:^|_)Head(?:_|Beam|BR|BSG|BMG)/i.test(
      weapon.sourceName || weapon.sourceWeapon || weapon.id || "",
    ) ||
      (weapon.requiredParts || []).some((part) => /^head$/i.test(part)));
  const roundTable = {
    beam_rifle: 2,
    beam_gun: 3,
    beam_spray: 3,
    rifle: 2,
    machine_gun: 2,
    small_vulcan: 2,
    close_defense: 2,
    bazooka: 2,
    beam_bazooka: 2,
    cannon: 2,
    shell_shotgun: 2,
    beam_shotgun: 2,
  };
  function baseRounds(weapon) {
    if (
      weapon.type === "melee" ||
      (wristWeapon(weapon) && !["shell_shotgun", "beam_shotgun"].includes(classify(weapon))) ||
      headVulcan(weapon) ||
      weapon.pilotRequirements?.length ||
      weapon.special?.type === "snipe"
    )
      return 1;
    return roundTable[classify(weapon)] || 1;
  }
  const ordinaryMelee = weapon => weapon.type === "melee" && classify(weapon) === "melee" &&
    weapon.slot !== "skill" && !weapon.pilotRequirements?.length && !weapon.special;
  function rounds(weapon) {
    const base = weapon.attackRounds ?? baseRounds(weapon);
    const configured = base > 0 && ordinaryMelee(weapon) ? base + 1 : base;
    const limit =
      weapon.pilotRequirements?.length || weapon.special?.type === "snipe" ? 1 : Infinity;
    return Math.min(configured, limit, weapon.maxUsesPerTurn ?? Infinity);
  }
  function defaultRules() {
    return Object.fromEntries(
      Object.keys(labels).map((kind) => [
        kind,
        {
          damage:
            kind === "beam_rifle"
              ? 1.5
              : ["small_vulcan", "close_defense"].includes(kind)
                ? 0.75
                : ["bazooka", "beam_bazooka", "panzerfaust"].includes(kind)
                  ? 1.15
                  : kind === "melee"
                    ? 1.1
                    : kind === "ram" ? 0.75 : 1,
          accuracy: 1,
          en: 1,
          range: 1,
          rangeBonus: 0,
          baseEN: -1,
          baseHit: baseHits[kind] ?? -1,
          minRange: -1,
          maxRange: -1,
        },
      ]),
    );
  }
  const isWeaponSkill = (skill) =>
    !!skill.sourceWeapon || skill.reconMode === "camera" || skill.type === "beam_diffusion";
  const rule = (weapon, config, id) => config.weaponClasses[classify(weapon, id)];
  function rules(weapon, config) {
    const group = rule(weapon, config),
      global = config.weapons,
      kind = classify(weapon);
    const inherited = (n) => (n < 0 ? "继承源值" : n);
    return [
      { label: "武器类型", value: labels[kind] },
      ...[
        ["baseEN", "基础EN"],
        ["baseHit", "基础命中率"],
        ["minRange", "基础最小射程"],
        ["maxRange", "基础最大射程"],
      ].map(([key, label]) => ({
        label,
        value: String(inherited(group[key])),
      })),
      { label: "分类伤害倍率", value: "×" + group.damage },
      { label: "通用伤害倍率", value: "×" + Math.max(0.01, global.damage + (!["melee", "ram"].includes(kind) ? global.shootingDamageOffset || 0 : 0)) },
      ...(!["melee", "ram"].includes(kind) ? [{ label: "射击基础命中增减", value: String(global.shootingHitOffset || 0) }] : []),
      ...(handheldCannon(weapon) ? [{ label: "手持加农炮命中增减", value: String(global.handheldCannonHitOffset || 0) }] : []),
      { label: "基础命中倍率", value: "×" + global.accuracy * group.accuracy },
      ...(shipCannon(weapon, weapon.shipWeapon) ? [{ label: "舰炮命中倍率", value: "×" + (global.shipCannonAccuracy ?? 0.85) }] : []),
      {
        label: "射程换算",
        value:
          "(×" +
          group.range +
          " / +" +
          ((kind === "sniper" ? global.sniperRangeBonus : global.rangeBonus) + group.rangeBonus) +
          ") ×" +
          global.range +
          " → ceil, ≥1",
      },
      { label: "EN倍率", value: "×" + global.en * group.en },
    ];
  }
  return {
    rounds,
    ordinaryMelee,
    baseRounds,
    roundTable,
    labels,
    valid,
    baseHits,
    shipCannon,
    shoulderBeamCannon,
    handheldCannon,
    classify,
    tags,
    machineGun,
    headVulcan,
    wristWeapon,
    pilotGateExempt,
    headBeam,
    defaultRules,
    isWeaponSkill,
    rule,
    rules,
  };
})();
if (typeof module !== "undefined") module.exports = WeaponClasses;
