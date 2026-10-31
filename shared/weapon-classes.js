/* Balance classification is separate from damage channels and firing choreography. */
const WeaponClasses = (() => {
  const labels = {
    rifle: "实弹步枪",
    beam: "光束武器",
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
  const aliases = {
    beam_rifle: "beam",
    beam_gun: "beam",
    beam_cannon: "beam",
    head_vulcan: "small_vulcan",
  };
  const valid = (id) => Object.hasOwn(labels, id);
  const mainLabels = {
    hand: "主手武器",
    body: "身体武器",
    wrist: "腕部武器",
    head: "头部武器",
    internal: "内藏武器",
    leg: "腿部武器",
  };
  const validMain = (id) => Object.hasOwn(mainLabels, id);
  function mainClass(weapon, id = "") {
    if (weapon.weaponMainClass !== undefined) {
      if (!validMain(weapon.weaponMainClass))
        throw Error("Invalid weapon main classification: " + weapon.weaponMainClass);
      return weapon.weaponMainClass;
    }
    // Read older saved editor choices; the current editor writes the two new fields.
    if (weapon.weaponClass === "wrist") return "wrist";
    if (weapon.weaponClass === "head_vulcan") return "head";
    const source = weapon.sourceName || weapon.sourceWeapon || id || weapon.id || "";
    if (/^Common_Arm(?:BR|GL|MG|MS)(?:_|$)|Wrist/i.test(source)) return "wrist";
    if (
      /Leg(?:MS|[RL](?:[A-Z_]|$))/i.test(source) ||
      (weapon.requiredParts || []).some((part) =>
        ["leftLeg", "rightLeg", "LegL", "LegR"].includes(part),
      )
    )
      return "leg";
    if (
      /^Common_DoubleVulcan_MS(?:__lv\d+)?$|(?:^|_)Head(?:_|$)/.test(source) ||
      ((weapon.requiredParts || []).includes("head") && /Vulcan|Head/i.test(source))
    )
      return "head";
    if (weapon.type === "melee" || weapon.category === "melee") return "hand";
    if (
      /Chest|Internal|Inbuilt|Belly|Abdomen|Torso|Hand(?:MG|MS|BR|Funnel)/i.test(source) ||
      /^ZN_MSM_|_MSM_/.test(source) ||
      /^Common_SingleVulcan_RX_79_G/.test(source)
    )
      return "internal";
    if (
      weapon.shipDamageMultiplier !== undefined ||
      /Turret|Mortar|Bombing|Backpack/i.test(source) ||
      ["irradiation", "beam_diffusion"].includes(weapon.type) ||
      weapon.category === "irradiation"
    )
      return "body";
    if (weapon.changeHeldWeapon === true) return "hand";
    if (
      ["cannon", "mortar", "bomb", "nuke", "remote"].includes(weapon.category) ||
      /Vulcan|Cannon/.test(source)
    )
      return "body";
    return "hand";
  }
  function classify(weapon, id = "") {
    const main = mainClass(weapon, id);
    if (weapon.weaponSubClass === undefined && weapon.weaponClass === "head_vulcan")
      return "small_vulcan";
    const supplied =
      weapon.weaponSubClass ??
      (!["wrist", "head_vulcan"].includes(weapon.weaponClass) ? weapon.weaponClass : undefined);
    if (supplied !== undefined) {
      const explicit = aliases[supplied] || supplied;
      if (!valid(explicit)) throw Error("Invalid weapon classification: " + supplied);
      return explicit;
    }
    const source = weapon.sourceName || weapon.sourceWeapon || id || weapon.id || "";
    if (weapon.category === "irradiation" || weapon.type === "irradiation") return "irradiation";
    if (/^Common_Push_/.test(source)) return "ram";
    if (main === "wrist" && weapon.type === "beam") return "beam";
    if (/^Common_ArmGL(?:_|$)/.test(source)) return "grenade_launcher";
    if (/^Common_ArmMS(?:_|$)|HandMS/.test(source)) return "missile";
    if (weapon.category === "machine_gun") {
      if (/Turret_?AA(?:_|$)/i.test(source)) return "close_defense";
      if (/Vulcan/i.test(source)) return "small_vulcan";
    }
    if (weapon.type === "melee" || weapon.category === "melee") return "melee";
    if (weapon.category === "sniper" || weapon.special?.type === "snipe") return "sniper";
    if (
      weapon.type === "beam" &&
      ["beam_rifle", "beam_gun", "beam_cannon", "cannon", "other", "missile"].includes(
        weapon.category,
      )
    )
      return "beam";
    if (/^Common_Grenade(?:_|$)/.test(source)) return "grenade";
    if (weapon.burn && /Flame/i.test(source)) return "flamethrower";
    if (weapon.category === "cannon" && weapon.type === "beam") return "beam";
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
    if (["beam_rifle", "beam_gun", "beam_cannon"].includes(weapon.category)) return "beam";
    return valid(weapon.category) ? weapon.category : "other";
  }
  const paths = (weapon) => {
    const pairs = [
      { main: mainClass(weapon), sub: classify(weapon) },
      ...(weapon.pairedChannels || [])
        .map((channel) => ({
          main: channel.weaponMainClass || mainClass(weapon),
          sub: channel.weaponSubClass || channel.weaponClass,
        }))
        .filter((pair) => validMain(pair.main) && valid(pair.sub)),
    ];
    return [...new Map(pairs.map((pair) => [pair.main + ":" + pair.sub, pair])).values()];
  };
  const tags = (weapon) => [...new Set(paths(weapon).map((pair) => pair.sub))];
  const mainTags = (weapon) => [...new Set(paths(weapon).map((pair) => pair.main))];
  const machineGun = (weapon, id) =>
    ["machine_gun", "small_vulcan", "close_defense"].includes(classify(weapon, id));
  const headOrWrist = (weapon, id) =>
    mainClass(weapon, id) === "wrist" ||
    (mainClass(weapon, id) === "head" && machineGun(weapon, id));
  const wristBeam = (weapon, id) =>
    mainClass(weapon, id) === "wrist" && classify(weapon, id) === "beam";
  function defaultRules() {
    return Object.fromEntries(
      Object.keys(mainLabels).map((main) => [
        main,
        Object.fromEntries(
          Object.keys(labels).map((sub) => [
            sub,
            {
              damage:
                sub === "beam"
                  ? main === "hand"
                    ? 1.5
                    : main === "wrist"
                      ? 0.75
                      : 1
                  : ["machine_gun", "small_vulcan", "close_defense"].includes(sub)
                    ? 0.75
                    : sub === "bazooka"
                      ? 1.25
                      : sub === "melee"
                        ? 1.1
                        : 1,
              accuracy: sub === "mortar" ? 1.1 : 1,
              ap: 1,
              en: 1,
              range: 1,
              rangeBonus: 0,
              baseAP: -1,
              baseEN: -1,
              baseHit: -1,
              minRange: -1,
              maxRange: -1,
            },
          ]),
        ),
      ]),
    );
  }
  const isWeaponSkill = (skill) =>
    !!skill.sourceWeapon || skill.reconMode === "camera" || skill.type === "beam_diffusion";
  const rule = (weapon, config, id) =>
    config.weaponClasses[mainClass(weapon, id)][classify(weapon, id)];
  function rules(weapon, config) {
    const w = config.weapons,
      kind = classify(weapon),
      group = rule(weapon, config),
      rows = [];
    const row = (label, value) => rows.push({ label, value: String(value) });
    row("主分类", mainLabels[mainClass(weapon)]);
    row("子分类", labels[kind]);
    row("基础AP", group.baseAP < 0 ? "继承源值" : group.baseAP);
    row("基础EN", group.baseEN < 0 ? "继承源值" : group.baseEN);
    row("基础命中率", group.baseHit < 0 ? "继承源值" : group.baseHit + "%");
    row(
      "基础射程",
      (group.minRange < 0 ? "继承源值" : group.minRange) +
        "–" +
        (group.maxRange < 0 ? "继承源值" : group.maxRange),
    );
    row("分类伤害倍率", "×" + group.damage);
    row("通用伤害倍率", "×" + w.damage);
    row("基础命中倍率", "×" + Number((w.accuracy * group.accuracy).toFixed(6)));
    row(
      "AP换算",
      headOrWrist(weapon) && group.baseAP < 0
        ? Math.max(0.5, Math.round(w.headWristAP * group.ap * 2) / 2) + " AP"
        : (group.baseAP >= 0
            ? group.baseAP
            : machineGun(weapon)
              ? w.machineGunAP
              : kind === "bazooka"
                ? 3
                : "源AP") +
            " × " +
            w.ap +
            " × " +
            group.ap,
    );
    row(
      "射程换算",
      headOrWrist(weapon)
        ? (group.minRange >= 0 ? group.minRange : 1) +
            "–" +
            (group.maxRange >= 0 ? group.maxRange : w.headWristRange) +
            " × " +
            group.range +
            " / +" +
            group.rangeBonus
        : "×" +
            Number((w.range * group.range).toFixed(6)) +
            " / +" +
            ((kind === "sniper" ? w.sniperRangeBonus : w.rangeBonus) + group.rangeBonus),
    );
    row("EN倍率", "×" + Number((w.en * group.en).toFixed(6)));
    return rows;
  }
  return {
    labels,
    mainLabels,
    valid,
    validMain,
    classify,
    mainClass,
    paths,
    tags,
    mainTags,
    headOrWrist,
    machineGun,
    wristBeam,
    rule,
    isWeaponSkill,
    defaultRules,
    rules,
  };
})();
if (typeof module !== "undefined") module.exports = WeaponClasses;
