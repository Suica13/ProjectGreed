/* Balance classification is separate from damage channels and firing choreography. */
const WeaponClasses = (() => {
  const labels = {
    beam_rifle: "光束步枪",
    rifle: "实弹步枪",
    beam_gun: "光束枪",
    beam_cannon: "光束炮",
    wrist: "腕部武器",
    head_vulcan: "头部火神炮",
    close_defense: "近防武器",
    small_vulcan: "小口径火神炮",
    machine_gun: "机枪",
    bazooka: "火箭筒",
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
  function classify(weapon, id = "") {
    if (weapon.weaponClass !== undefined) {
      if (!valid(weapon.weaponClass))
        throw Error("Invalid weapon classification: " + weapon.weaponClass);
      return weapon.weaponClass;
    }
    const source = weapon.sourceName || id || weapon.id || "";
    if (weapon.category === "irradiation" || weapon.type === "irradiation") return "irradiation";
    if (/^Common_Push_/.test(source)) return "ram";
    if (/^Common_Arm(?:BR|GL|MG|MS)(?:_|$)/.test(source)) return "wrist";
    if (/^Common_DoubleVulcan_MS(?:__lv\d+)?$/.test(source)) return "head_vulcan";
    if (weapon.category === "machine_gun") {
      if (/Turret_?AA(?:_|$)/i.test(source)) return "close_defense";
      if (/Vulcan/i.test(source)) return "small_vulcan";
    }
    if (weapon.type === "melee" || weapon.category === "melee") return "melee";
    if (weapon.category === "sniper" || weapon.special?.type === "snipe") return "sniper";
    if (/^Common_Grenade(?:_|$)/.test(source)) return "grenade";
    if (weapon.burn && /Flame/i.test(source)) return "flamethrower";
    if (weapon.category === "cannon" && weapon.type === "beam") return "beam_cannon";
    if (weapon.category === "other" && /(?:_GL(?:_|$)|GrenadeLauncher)/i.test(source))
      return "grenade_launcher";
    // Some legacy physical rifles inherited the BR animation category but never received beam scaling.
    if (
      weapon.category === "beam_rifle" &&
      weapon.type !== "beam" &&
      !Object.entries(weapon.damageComponents || {}).some(
        ([key, value]) => /beam/i.test(key) && value > 0,
      )
    )
      return "rifle";
    return valid(weapon.category) ? weapon.category : "other";
  }
  const tags = (weapon) => [
    ...new Set([
      classify(weapon),
      ...(weapon.pairedChannels || []).map((channel) => channel.weaponClass).filter(valid),
    ]),
  ];
  const headOrWrist = (weapon, id) => ["head_vulcan", "wrist"].includes(classify(weapon, id));
  function machineGun(weapon, id) {
    const kind = classify(weapon, id);
    return (
      ["machine_gun", "head_vulcan", "small_vulcan", "close_defense"].includes(kind) ||
      (kind === "wrist" &&
        weapon.category === "machine_gun" &&
        !/^Common_ArmGL/.test(weapon.sourceName || id || ""))
    );
  }
  function rules(weapon, config) {
    const w = config.weapons,
      kind = classify(weapon),
      rows = [];
    const row = (label, value) => rows.push({ label, value: String(value) });
    let damage = 1;
    if (machineGun(weapon)) damage = w.machineGunDamage;
    if (kind === "beam_rifle") damage = w.beamRifleDamage;
    if (kind === "bazooka") damage = w.bazookaDamage;
    if (kind === "melee") damage = w.meleeDamage;
    row("分类伤害倍率", "×" + damage);
    row("通用伤害倍率", "×" + w.damage);
    row(
      "基础命中倍率",
      "×" + Number((w.accuracy * (kind === "mortar" ? w.mortarAccuracy : 1)).toFixed(6)),
    );
    row(
      "AP换算",
      headOrWrist(weapon)
        ? Math.max(0.5, Math.round(w.headWristAP * 2) / 2) + " AP"
        : (machineGun(weapon) ? w.machineGunAP : kind === "bazooka" ? 3 : "源AP") + " × " + w.ap,
    );
    row(
      "射程换算",
      headOrWrist(weapon)
        ? "1–" + w.headWristRange
        : "×" + w.range + " / +" + (kind === "sniper" ? w.sniperRangeBonus : w.rangeBonus),
    );
    row("EN倍率", "×" + w.en);
    return rows;
  }
  return { labels, valid, classify, tags, headOrWrist, machineGun, rules };
})();
if (typeof module !== "undefined") module.exports = WeaponClasses;
