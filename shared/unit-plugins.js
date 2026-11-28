/* Installed chassis plugins are IDs, never client-provided combat statistics. */
"use strict";
const UnitPlugins = (() => {
  const catalog =
    typeof UNIT_PLUGIN_DATA !== "undefined" ? UNIT_PLUGIN_DATA : require("./unit-plugins.json");
  const byId = new Map(catalog.map((part) => [part.id, part])),
    cache = new WeakMap(),
    originals = new WeakMap();
  const ms = (model) => !model.ship && model.unitTags?.includes("MS");
  const allowed = (part, model) =>
    !!part && (!part.msOnly || ms(model)) && (!part.nonShip || !model.ship) &&
    (!part.shipOnly || !!model.ship) && (!part.factionOnly || model.faction === part.factionOnly || model.tags?.includes(part.factionOnly));
  function normalize(value, model) {
    if (value === undefined) return [null, null, null, null];
    if (!Array.isArray(value) || value.length > 4) throw Error("零件槽位无效");
    const seen = new Set();
    const slots = Array.from({ length: 4 }, (_, index) => value[index] ?? null);
    for (const id of slots) {
      if (id === null) continue;
      if (typeof id !== "string" || !allowed(byId.get(id), model) || seen.has(id))
        throw Error("零件重复或不适用于该单位");
      seen.add(id);
    }
    return slots;
  }
  function apply(base, value) {
    if (!base) return base;
    if (value === undefined) return base;
    if (base.installedPlugins && JSON.stringify(base.installedPlugins) === JSON.stringify(value))
      return base;
    const slots = normalize(value, base),
      key = slots.join("|");
    if (!slots.some(Boolean)) return base;
    let variants = cache.get(base);
    if (!variants) cache.set(base, (variants = new Map()));
    if (variants.has(key)) return variants.get(key);
    const parts = slots.filter(Boolean).map((id) => byId.get(id)),
      effects = {};
    for (const part of parts)
      for (const [name, amount] of Object.entries(part.effects))
        effects[name] = (effects[name] || 0) + amount;
    const add = (name) => effects[name] || 0;
    const chassisCost = base.chassisCost ?? base.cost;
    const cost = parts.reduce(
      (sum, part) => sum + (part.cost || 0) + chassisCost * (part.costPercent || 0),
      0,
    );
    const model = {
      ...base,
      get name() {
        return base.name;
      },
      get description() {
        return base.description;
      },
      get kitName() {
        return base.kitName;
      },
      hp: Math.max(1, Math.round(base.hp * (1 + add("hpPercent")) + add("hp"))),
      en: Math.max(0, Math.round(base.en * (1 + add("enPercent")) + add("en"))),
      speed: Math.max(0, Math.round(((base.speed ?? 100) + add("speed")) * (1 + add("speedPercent")))),
      pilotExperienceMultiplier: (base.pilotExperienceMultiplier ?? 1) * (1 + add("experience")),
      pluginAwakening: add("awakening"),
      counterReaction: add("counterReaction"),
      attackReaction: add("attackReaction"),
      incomingDamageMultiplier: 1 + add("incomingDamage"),
      primaryRoundsBonus: add("primaryRounds"),
      shipRepair: add("shipRepair"),
      mobility: Math.max(0, Math.round(base.mobility + add("reaction"))),
      accuracy: Math.max(
        0,
        Math.round(base.accuracy * (1 + add("accuracyPercent")) + add("accuracy")),
      ),
      partStructuralStrength: Math.round(
        (base.partStructuralStrength ?? 100) * (1 + add("partPercent")) + add("partStrength"),
      ),
      move: base.deployed ? 0 : base.move + add("move"),
      cost: base.cost + Math.round(cost / 25) * 25,
      commandRangeBonus: (base.commandRangeBonus || 0) + add("commandRange"),
      groundMoveBonus: (base.groundMoveBonus || 0) + add("groundMove"),
      shield: {
        ...base.shield,
        hp:
          base.shield.hp > 0
            ? Math.round(base.shield.hp * (1 + add("shieldPercent")) + add("shieldHP"))
            : 0,
        blockChance: Math.min(0.75, base.shield.blockChance + add("blockChance")),
      },
      sensors: {
        ...base.sensors,
        sight: (base.sensors?.sight || 0) + add("sight"),
        radar: (base.sensors?.radar || 0) + add("radar"),
        ...(add("stealth") ? { stealth: true } : {}),
        ...(add("antiDetect") ? { antiDetect: true } : {}),
        ...(add("ignoreStealth") ? { ignoreStealth: true } : {}),
      },
      attackBonuses: {
        ...base.attackBonuses,
        shell: (base.attackBonuses?.shell || 0) + add("shellPercent") * 100,
        shooting: (base.attackBonuses?.shooting || 0) + add("shooting"),
        melee: (base.attackBonuses?.melee || 0) + add("melee"),
      },
      defenses: {
        ...base.defenses,
        shell: {
          ...base.defenses.shell,
          percent: Math.min(100, base.defenses.shell.percent + add("shellResistance")),
          flat: base.defenses.shell.flat + add("shellFlat"),
        },
      },
      adaptability: Object.fromEntries(
        Object.entries(base.adaptability || {}).map(([terrain, amount]) => [
          terrain,
          Math.max(0, Math.min(100, amount + add("adaptability") + add(terrain))),
        ]),
      ),
      ...(add("reactiveArmor")
        ? { shellFinalResistance: Math.max(base.shellFinalResistance || 0, 25) }
        : {}),
      installedPlugins: slots,
    };
    function weapon(source) {
      const classes =
          typeof WeaponClasses !== "undefined" ? WeaponClasses : require("./weapon-classes.js"),
        policy =
          typeof WeaponSequence !== "undefined" ? WeaponSequence : require("./weapon-sequence.js"),
        kind = classes.classify(source),
        components = source.damageComponents || {},
        melee = source.type === "melee",
        beamMelee =
          melee && Object.entries(components).some(([key, n]) => /^meleeBeam/.test(key) && n > 0),
        shellMelee =
          melee &&
          !beamMelee &&
          Object.entries(components).some(([key, n]) => /^melee(?:Shell|AP|$)/.test(key) && n > 0),
        machine = kind === "machine_gun",
        shell = !melee && (components.shell || 0) + (components.shellAP || 0) > 0,
        focused = !melee && (kind === "beam_cannon" || components.beamAP > 0),
        damageBonus =
          add("allDamage") +
          (kind === "bazooka" ? add("bazookaDamage") : 0) +
          (kind === "beam_rifle" ? add("beamRifleDamage") : 0) +
          (shell ? add("shellDamage") : 0) +
          (beamMelee ? add("beamMeleeDamage") : 0) +
          (shellMelee ? add("shellMeleeDamage") : 0) +
          (focused ? add("focusedBeamDamage") : 0) +
          (melee ? add("meleeDamage") : 0) +
          (kind === "grenade" ? add("grenadeDamage") : 0);
      const damagePercent = add("allDamagePercent") +
        (kind === "bazooka" ? add("bazookaDamagePercent") : 0) +
        (kind === "beam_rifle" ? add("beamRifleDamagePercent") : 0) +
        (beamMelee ? add("beamMeleeDamagePercent") : 0) +
        (shellMelee ? add("shellMeleeDamagePercent") : 0) +
        (focused ? add("focusedBeamDamagePercent") : 0) +
        (melee ? add("meleeDamagePercent") : 0);
      const beam =
        source.type !== "melee" &&
        (source.type === "beam" ||
          source.type === "irradiation" ||
          source.damageComponents?.beam > 0 ||
          source.damageComponents?.beamAP > 0);
      const rangeBonus = add("allRange") + (beam ? add("beamRange") : 0) + (machine ? add("machineRange") : 0),
        hitBonus = add("allHit") + (beam ? add("beamHit") : 0) + (machine ? add("machineHit") : 0) +
          (machine && shell ? add("shellMachineHit") : 0) +
          (["beam_cannon", "cannon"].includes(kind) ? add("cannonHit") : 0) +
          (kind === "missile" ? add("missileHit") : 0),
        piercing = classes.headVulcan(source) ? add("vulcanPiercing") : 0;
      if (!rangeBonus && !hitBonus && !damageBonus && !damagePercent && !piercing) return source;
      const result = { ...source };
      const increase = (values) => {
        const total = Object.values(values || {}).reduce((sum, n) => sum + n, 0);
        let result = total > 0 && (damageBonus || damagePercent)
          ? policy.roundComponents(values, (total * (1 + damagePercent) + damageBonus) / total)
          : values;
        if (!result) return result;
        result = { ...result };
        if (piercing && result.shell) {
          result.shellAP = (result.shellAP || 0) + result.shell * piercing;
          result.shell *= 1 - piercing;
        }
        return policy.roundComponents(result, 1);
      };
      for (const field of ["max", "range"])
        if (Number.isFinite(source[field]))
          result[field] = Math.max(source.min ?? source.minRange ?? 1, source[field] + rangeBonus);
      for (const field of ["hit", "baseHit"])
        if (Number.isFinite(source[field]))
          result[field] = Math.max(0, Math.min(100, source[field] + hitBonus));
      if (source.damageComponents) {
        result.damageComponents = increase(source.damageComponents);
        result.damagePerShot = Object.values(result.damageComponents).reduce(
          (sum, n) => sum + n,
          0,
        );
      }
      if (source.attack) {
        result.attack = { ...source.attack };
        for (const field of ["steps", "strikes"])
          if (source.attack[field])
            result.attack[field] = source.attack[field].map((step) => ({
              ...step,
              ...(Number.isFinite(step.accuracy)
                ? { accuracy: Math.max(0, Math.min(100, step.accuracy + hitBonus)) }
                : {}),
              ...(step.damageComponents
                ? { damageComponents: increase(step.damageComponents) }
                : {}),
            }));
        if (result.attack.strikes)
          result.damage =
            result.attack.strikes.reduce(
              (sum, step) =>
                sum +
                Object.values(step.damageComponents || result.damageComponents || {}).reduce(
                  (n, v) => n + v,
                  0,
                ) *
                  (step.damageMultiplier ?? 1),
              0,
            ) * (source.hitsPerShot ?? 1);
      }
      originals.set(result, source);
      return result;
    }
    model.weapons = (base.weapons || []).map(weapon);
    model.skills = (base.skills || []).map(weapon);
    if (add("coating")) model.abc = base.abc
      ? { ...base.abc, capacity: base.abc.capacity + Math.round(model.hp * .1) }
      : { capacity: Math.round(model.hp * .25), reductions: { beam: .75, beamAP: .1875, meleeBeam: .375, meleeBeamAP: .1875 } };
    if (add("spares")) model.skills.push({ id: "plugin_ms_spares", name: "MS备用部件", type: "repair",
      selfOnly: true, repairRandomPart: true, range: 0, enCost: 0, maxUses: 1, consumeAction: false,
      hpRecoveryPercent: 25, enRecoveryPercent: 0, shieldRecoveryPercent: 0 });
    const mechanics = [];
    if (
      add("minovsky") &&
      !model.skills.some((skill) => skill.type === "minovsky" && skill.radius >= 7)
    ) {
      model.skills.push({
        id: "Common_MinovskyParticle_S",
        type: "minovsky",
        name: "米诺夫斯基粒子散布[S]",
        radius: 7,
        enCost: 300,
        actionCost: 2,
        durationRounds: 4,
        cooldownTurns: 3,
        maxUses: 99,
        consumeAction: false,
        effect: "Light_75_NotAttached",
        sound: {
          file: "../../sounds/Detect_3.ogg",
          volume: 0.5,
          asset: "Dash/skill/Common_MinovskyParticle_S",
        },
        localization: {
          zh: { name: "米诺夫斯基粒子散布[S]" },
          en: { name: "Minovsky Particle Dispersal [S]" },
          ja: { name: "ミノフスキー粒子散布[S]" },
        },
      });
      mechanics.push({
        id: "plugin_minovsky",
        name: "米诺夫斯基粒子散布[S]",
        status: "implemented",
      });
    }
    for (const [key, name] of [
      ["stealth", "隐蔽"],
      ["antiDetect", "反侦测"],
      ["ignoreStealth", "无视隐蔽"],
    ])
      if (add(key)) mechanics.push({ id: "plugin_" + key, name, status: "implemented" });
    if (mechanics.length) model.mechanics = [...(base.mechanics || []), ...mechanics];
    if (
      add("reactiveArmor") &&
      !base.mechanics?.some((mechanic) => mechanic.id === "ExplosiveReactiveArmor_Shell")
    )
      model.mechanics = [
        ...(base.mechanics || []),
        {
          id: "ExplosiveReactiveArmor_Shell",
          name: "爆炸反应装甲：最终实弹伤害降低25%",
          status: "implemented",
        },
      ];
    originals.set(model, base);
    variants.set(key, model);
    return model;
  }
  const baseOf = (value) => (value && originals.get(value)) || value;
  return { catalog, byId, allowed, normalize, apply, baseOf };
})();
if (typeof module !== "undefined") module.exports = UnitPlugins;
