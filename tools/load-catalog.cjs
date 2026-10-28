/* Build and server share this loader. Paths in unit.json are relative to that prefab. */
const fs = require("node:fs");
const path = require("node:path");
const WeaponSequence = require("../shared/weapon-sequence.js");
const PairedWeapons = require("./paired-weapons.cjs");
const UnitParts = require("../shared/unit-parts.js");
const UnitSkills = require("../shared/unit-skills.js");
function validateParts(parts, label) {
  if (parts === undefined) return;
  if (
    !Array.isArray(parts) ||
    new Set(parts).size !== parts.length ||
    parts.some((part) => !Object.hasOwn(UnitParts.names, part))
  )
    throw Error("Invalid part dependencies: " + label);
}
const root = path.resolve(__dirname, "../assets");
function file(base, reference) {
  if (typeof reference !== "string") throw Error("Invalid asset reference");
  const resolved = path.resolve(base, reference);
  if (!resolved.startsWith(root + path.sep)) throw Error("Asset outside assets/: " + reference);
  return resolved;
}
const read = (name) => JSON.parse(fs.readFileSync(name, "utf8").replace(/^\uFEFF/, ""));
function validateLocalization(localization, id) {
  if (localization === undefined) return;
  if (!localization || typeof localization !== "object" || Array.isArray(localization))
    throw Error("Invalid localization: " + id);
  for (const [language, fields] of Object.entries(localization)) {
    if (
      !["zh", "ja", "en"].includes(language) ||
      !fields ||
      typeof fields !== "object" ||
      Array.isArray(fields)
    )
      throw Error("Invalid localization language: " + id + "/" + language);
    for (const [field, value] of Object.entries(fields))
      if (!["name", "description"].includes(field) || typeof value !== "string" || !value.trim())
        throw Error("Invalid localized text: " + id + "/" + language + "/" + field);
  }
}
function loadCatalog({
  embedMusic = false,
  catalogOverride = null,
  unitOverrides = {},
  wipOverride = null,
} = {}) {
  const catalog = catalogOverride || read(path.join(root, "unit-catalog.json"));
  const wipPolicy = wipOverride || read(path.join(root, "unit-wip.json"));
  if (
    wipPolicy.schemaVersion !== 1 ||
    !Array.isArray(wipPolicy.units) ||
    new Set(wipPolicy.units).size !== wipPolicy.units.length ||
    wipPolicy.units.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]+\*?$/.test(id))
  )
    throw Error("Invalid WIP unit list");
  const isWip = (id) =>
    wipPolicy.units.some((pattern) =>
      pattern.endsWith("*") ? id.startsWith(pattern.slice(0, -1)) : id === pattern,
    );

  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.units) || !catalog.units.length)
    throw Error("Invalid unit catalog");
  if (
    !Number.isInteger(catalog.formation.maxUnits) ||
    catalog.formation.maxUnits < 1 ||
    catalog.formation.maxUnits > 72 ||
    !Number.isFinite(catalog.formation.maxCost) ||
    catalog.formation.maxCost <= 0
  )
    throw Error("Invalid formation limits");
  if (
    !Number.isInteger(catalog.formation.aiUnits) ||
    catalog.formation.aiUnits < 1 ||
    catalog.formation.aiUnits > catalog.formation.maxUnits ||
    !Number.isInteger(catalog.map?.width) ||
    !Number.isInteger(catalog.map?.height) ||
    catalog.map.width < 12 ||
    catalog.map.width > 128 ||
    catalog.map.height < 9 ||
    catalog.map.height > 128
  )
    throw Error("Invalid map / AI formation size");
  if (!Number.isInteger(catalog.formation.costStep) || catalog.formation.costStep <= 0)
    throw Error("Invalid COST step");
  if (
    !Number.isInteger(catalog.formation.defaultUnits) ||
    catalog.formation.defaultUnits < 3 ||
    catalog.formation.defaultUnits > catalog.formation.maxUnits
  )
    throw Error("Invalid default unit limit");
  const result = { ...catalog, prefabs: [], units: [], assets: {}, sounds: {}, models: {} };
  result.maps = {};
  if (!Array.isArray(catalog.maps) || !catalog.maps.length) throw Error("Missing preset maps");
  for (const reference of catalog.maps) {
    const map = read(file(root, reference));
    validateLocalization(map.localization, map.id);
    map.environment ??= "ground";
    if (!["ground", "space"].includes(map.environment))
      throw Error("Invalid map environment: " + map.id);
    if (
      !/^[a-z0-9_]+$/.test(map.id) ||
      result.maps[map.id] ||
      !Number.isInteger(map.width) ||
      !Number.isInteger(map.height) ||
      map.width < 12 ||
      map.width > 128 ||
      map.height < 9 ||
      map.height > 128 ||
      !Number.isInteger(map.playersPerTeam) ||
      map.playersPerTeam < 1 ||
      map.playersPerTeam > 5 ||
      !Number.isInteger(map.deploymentRadius) ||
      map.deploymentRadius < 1 ||
      !Array.isArray(map.spawns) ||
      map.spawns.length !== map.playersPerTeam * 2 ||
      !Array.isArray(map.tiles) ||
      map.tiles.length !== map.height ||
      map.tiles.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== map.width ||
          row.some((t) => !["plain", "forest", "rubble", "rock", "water", "highland"].includes(t)),
      )
    )
      throw Error("Invalid map: " + reference);
    if (
      map.appearance !== undefined &&
      (!map.appearance ||
        !["arctic", "urban", "desert", "wetland", "forest", "space"].includes(
          map.appearance.biome,
        ) ||
        !map.appearance.colors ||
        Object.entries(map.appearance.colors).some(
          ([kind, color]) =>
            !["plain", "forest", "rubble", "rock", "water", "highland"].includes(kind) ||
            typeof color !== "string" ||
            !/^#[0-9a-f]{6}$/i.test(color),
        ))
    )
      throw Error("Invalid map appearance: " + map.id);
    const areas = map.deploymentAreas;
    const expansion = map.deploymentExpansion;
    if (
      expansion !== undefined &&
      (!expansion ||
        !areas ||
        ![expansion.baseWidth, expansion.addedLeft, expansion.addedRight].every(Number.isInteger) ||
        expansion.baseWidth < 12 ||
        expansion.addedLeft < 1 ||
        expansion.addedRight < 1 ||
        expansion.baseWidth + expansion.addedLeft + expansion.addedRight !== map.width)
    )
      throw Error("Invalid deployment expansion: " + map.id);
    if (
      areas !== undefined &&
      (!Array.isArray(areas) ||
        areas.length !== map.spawns.length ||
        areas.some(
          (area) =>
            !area ||
            ![area.x, area.y, area.width, area.height].every(Number.isInteger) ||
            area.x < 0 ||
            area.y < 0 ||
            area.width < 1 ||
            area.height < 1 ||
            area.x + area.width > map.width ||
            area.y + area.height > map.height,
        ))
    )
      throw Error("Invalid deployment areas: " + map.id);
    for (const [seat, spawn] of map.spawns.entries()) {
      if (
        spawn.team !== seat % 2 ||
        spawn.position !== Math.floor(seat / 2) + 1 ||
        !Number.isInteger(spawn.x) ||
        !Number.isInteger(spawn.y) ||
        spawn.x < 0 ||
        spawn.x >= map.width ||
        spawn.y < 0 ||
        spawn.y >= map.height
      )
        throw Error("Invalid spawn: " + map.id);
      const area = areas?.[seat];
      const inside = (x, y) =>
        area
          ? x >= area.x && y >= area.y && x < area.x + area.width && y < area.y + area.height
          : Math.abs(x - spawn.x) + Math.abs(y - spawn.y) <= map.deploymentRadius;
      if (!inside(spawn.x, spawn.y)) throw Error("Spawn outside deployment area: " + map.id);
      let capacity = 0;
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++)
          if (inside(x, y) && !["rock", "water"].includes(map.tiles[y][x])) capacity++;
      if (capacity < catalog.formation.maxUnits)
        throw Error("Spawn area too small for maximum formation: " + map.id);
      if (
        map.spawns.slice(0, seat).some((other, index) => {
          if (!area)
            return (
              Math.abs(other.x - spawn.x) + Math.abs(other.y - spawn.y) <= map.deploymentRadius * 2
            );
          const otherArea = areas[index];
          return (
            area.x < otherArea.x + otherArea.width &&
            otherArea.x < area.x + area.width &&
            area.y < otherArea.y + otherArea.height &&
            otherArea.y < area.y + area.height
          );
        })
      )
        throw Error("Overlapping deployment areas: " + map.id);
    }
    result.maps[map.id] = map;
  }
  result.maps = Object.fromEntries(
    Object.entries(result.maps).sort(([, a], [, b]) => a.spawns.length - b.spawns.length),
  );
  if (!result.maps[catalog.defaultMap]) throw Error("Invalid default map");
  result.presentation = read(file(root, catalog.presentation));
  for (const key of [
    "deathSound",
    "moveSound",
    "gameStartSound",
    "turnSound",
    "underAttackSound",
    "lockonSound",
    "infoSound",
    "killInfoSound",
    "selectUnitSound",
    "selectWeaponSound",
    "changeEquipmentSound",
    "detectedSound",
    "selectEfsfMsSound",
    "selectZeonMsSound",
    "tankMoveSound",
  ]) {
    const sound = result.presentation[key];
    if (
      !sound ||
      !Number.isFinite(sound.volume) ||
      sound.volume < 0 ||
      sound.volume > 1 ||
      !Number.isFinite(sound.duration) ||
      sound.duration <= 0
    )
      throw Error("Invalid presentation sound: " + key);
    sound.asset = "presentation/" + key;
    result.sounds[sound.asset] =
      "data:audio/ogg;base64," + fs.readFileSync(file(root, sound.file)).toString("base64");
  }
  if (
    !Number.isFinite(result.presentation.sfxVolume) ||
    result.presentation.sfxVolume < 0 ||
    result.presentation.sfxVolume > 1
  )
    throw Error("Invalid SFX volume");
  const battleVolume = result.presentation.battleSfxVolume ?? 0.5;
  if (!Number.isFinite(battleVolume) || battleVolume < 0 || battleVolume > 1)
    throw Error("Invalid battle SFX volume");
  result.presentation.battleSfxVolume = battleVolume;

  const playlistFile = file(root, catalog.music);
  result.music = read(playlistFile);
  if (
    !result.music.tracks.length ||
    !Number.isFinite(result.music.volume) ||
    result.music.volume < 0 ||
    result.music.volume > 1
  )
    throw Error("Invalid music playlist");
  result.music.tracks = result.music.tracks.map((track) => {
    const source = file(path.dirname(playlistFile), track.file);
    if (!fs.existsSync(source)) throw Error("Missing music: " + track.file);
    return {
      ...track,
      ...(embedMusic
        ? {
            source:
              "data:" +
              (path.extname(source).toLowerCase() === ".mp3" ? "audio/mpeg" : "audio/ogg") +
              ";base64," +
              fs.readFileSync(source).toString("base64"),
          }
        : {}),
    };
  });
  for (const key of [
    "animationSpeed",
    "meleeAnimationSpeed",
    "battleFadeIn",
    "battleHold",
    "battleFadeOut",
    "deathDelay",
    "projectileSpeed",
    "dodgeDistance",
    "dodgeOut",
    "mapCellScale",
  ])
    if (!Number.isFinite(result.presentation[key]) || result.presentation[key] <= 0)
      throw Error("Invalid presentation setting: " + key);
  const effectFile = file(root, catalog.effects),
    effectBase = path.dirname(effectFile);
  result.effects = read(effectFile);
  for (const [id, effect] of Object.entries(result.effects)) {
    if (
      !Number.isInteger(effect.frames) ||
      effect.frames < 1 ||
      !Number.isInteger(effect.startFrame) ||
      !Number.isInteger(effect.endFrame) ||
      effect.startFrame < 0 ||
      effect.endFrame >= effect.frames ||
      effect.endFrame < effect.startFrame ||
      !Number.isFinite(effect.fps) ||
      effect.fps <= 0
    )
      throw Error("Invalid effect frames: " + id);
    effect.asset = "effect/" + id;
    result.assets[effect.asset] =
      "data:image/png;base64," +
      fs.readFileSync(file(effectBase, effect.texture)).toString("base64");
    effect.duration = (effect.endFrame - effect.startFrame + 1) / effect.fps;
    effect.sounds = effect.sounds.map((sound, index) => {
      if (!Number.isFinite(sound.volume) || sound.volume < 0 || sound.volume > 1)
        throw Error("Invalid effect sound volume: " + id);
      const asset = "effect/" + id + "/" + index;
      result.sounds[asset] =
        "data:audio/ogg;base64," + fs.readFileSync(file(effectBase, sound.file)).toString("base64");
      return { ...sound, asset };
    });
  }
  if (!result.effects[result.presentation.deathElectricEffect])
    throw Error("Invalid death electric effect");
  const moduleDamage = result.presentation.moduleDamage;
  if (
    !moduleDamage ||
    !result.effects[moduleDamage.effect] ||
    !Number.isFinite(moduleDamage.scale) ||
    moduleDamage.scale <= 0 ||
    moduleDamage.scale > 1
  )
    throw Error("Invalid module damage presentation setting");
  const lowHp = result.presentation.lowHp;
  if (
    !lowHp ||
    !result.effects[lowHp.effect] ||
    !Number.isFinite(lowHp.threshold) ||
    lowHp.threshold <= 0 ||
    lowHp.threshold > 1
  )
    throw Error("Invalid low HP presentation setting");
  for (const ref of catalog.units) {
    const source = file(root, ref),
      base = path.dirname(source),
      prefab = unitOverrides[ref] ? structuredClone(unitOverrides[ref]) : read(source);
    if (prefab.enabled === false) continue;
    prefab.wip = isWip(prefab.id);
    prefab.disabled = prefab.wip;
    validateLocalization(prefab.localization, ref);
    if (prefab.availableFactions !== undefined &&
        (!Array.isArray(prefab.availableFactions) || !prefab.availableFactions.length ||
         prefab.availableFactions.some((value) => !["EFSF", "ZEON"].includes(value))))
      throw Error("Invalid available factions: " + prefab.id);
    if (
      !Number.isInteger(prefab.stats.actionPoints) ||
      prefab.stats.actionPoints < 1 ||
      prefab.stats.actionPoints > 99
    )
      throw Error("Invalid unit action points: " + prefab.id);
    if (
      !Array.isArray(prefab.tags) ||
      prefab.tags.filter((tag) => ["EFSF", "ZEON"].includes(tag)).length !== 1
    )
      throw Error("Unit must have exactly one EFSF or ZEON tag: " + ref);
    if (!prefab.tags.some((tag) => /^\d{4}(?:[EL])?$/.test(tag)))
      throw Error("Unit must have an era tag: " + ref);
    prefab.unitTags ??= [];
    prefab.transport ??= { slotCost: 1, loadTags: [] };
    prefab.hangars ??= [];
    const stringTags = (tags) =>
      Array.isArray(tags) &&
      tags.every((tag) => typeof tag === "string" && tag.trim()) &&
      new Set(tags).size === tags.length;
    if (
      !stringTags(prefab.unitTags) ||
      !Number.isInteger(prefab.transport.slotCost) ||
      prefab.transport.slotCost < 1 ||
      !stringTags(prefab.transport.loadTags) ||
      !Array.isArray(prefab.hangars) ||
      prefab.hangars.some(
        (h) =>
          !h ||
          typeof h.id !== "string" ||
          !h.id.trim() ||
          (h.kind !== undefined && h.kind !== "sfs") ||
          (h.kind === "sfs" && (h.capacity !== 1 || !h.offset ||
            [h.offset.x,h.offset.y,h.offset.height].some(value => !Number.isFinite(value) || Math.abs(value) > 500))) ||
          !Number.isInteger(h.capacity) ||
          h.capacity < 1 ||
          !stringTags(h.allowedTags) ||
          !h.allowedTags.length ||
          [h.launchRange ?? 1, h.emergencyRange ?? 3].some(
            (range) => !Number.isInteger(range) || range < 1 || range > 8,
          ),
      ) ||
      new Set(prefab.hangars.map((h) => h.id)).size !== prefab.hangars.length
    )
      throw Error("Invalid unit transport / hangar configuration: " + ref);
    const sizeTags = ["SmallUnit", "MediumUnit", "LargeUnit"].filter((tag) =>
      prefab.unitTags.includes(tag),
    );
    if (sizeTags.length > 1) throw Error("Conflicting unit size tags: " + ref);
    if (!sizeTags.length) prefab.unitTags.push(prefab.stats.ship ? "LargeUnit" : "MediumUnit");
    prefab.faction = prefab.tags.find((tag) => ["EFSF", "ZEON"].includes(tag));
    if (prefab.schemaVersion !== 2 || result.prefabs.some((p) => p.id === prefab.id))
      throw Error("Invalid prefab: " + ref);
    if (typeof prefab.code !== "string" || !prefab.code.trim())
      throw Error("Invalid unit code: " + ref);
    if (!/^[A-Za-z0-9_]+$/.test(prefab.id) || !prefab.weaponKits?.length)
      throw Error("Invalid unit ID or kits: " + ref);
    for (const key of ["hp", "en", "move", "cost"])
      if (
        !Number.isFinite(prefab.stats[key]) ||
        (prefab.stats[key] <= 0 &&
          !(key === "cost" && prefab.id.startsWith("Army_Squad_") && prefab.stats.cost === 0))
      )
        throw Error("Invalid stat " + key + ": " + ref);
    if (
      prefab.stats.movementType !== undefined &&
      !["ground", "air", "amphibious", "hover", "naval"].includes(prefab.stats.movementType)
    )
      throw Error("Invalid movement type: " + prefab.id);
    if (
      prefab.stats.autoRepair &&
      (![prefab.stats.autoRepair.hpPercent, prefab.stats.autoRepair.enCost].every(
        (v) => Number.isFinite(v) && v > 0,
      ) ||
        prefab.stats.autoRepair.hpPercent > 100 ||
        prefab.stats.autoRepair.enCost > prefab.stats.en)
    )
      throw Error("Invalid auto-repair: " + prefab.id);
    if (prefab.stats.stealth && typeof prefab.stats.stealth.waterOnly !== "boolean")
      throw Error("Invalid concealment: " + prefab.id);
    if (
      prefab.mechanics &&
      (!Array.isArray(prefab.mechanics) ||
        prefab.mechanics.some(
          (m) =>
            !m.id ||
            !m.name ||
            !["implemented", "adapted", "review", "not_applicable"].includes(m.status),
        ))
    )
      throw Error("Invalid mechanics audit: " + prefab.id);
    UnitSkills.validate(prefab.skills, prefab.id);
    for (const skill of prefab.skills || [])
      if (["repair", "recon"].includes(skill.type) && skill.enCost > prefab.stats.en)
        throw Error("Repair exceeds maximum EN: " + prefab.id);
    for (const skill of prefab.skills || []) {
      validateLocalization(skill.localization, prefab.id + "/" + skill.id);
      if (!result.effects[skill.effect]) throw Error("Missing skill effect: " + skill.id);
      if (
        !skill.sound ||
        !Number.isFinite(skill.sound.volume) ||
        skill.sound.volume < 0 ||
        skill.sound.volume > 1
      )
        throw Error("Invalid skill sound: " + skill.id);
      const asset = prefab.id + "/skill/" + skill.id;
      result.sounds[asset] =
        "data:audio/ogg;base64," + fs.readFileSync(file(base, skill.sound.file)).toString("base64");
      skill.sound.asset = asset;
    }
    prefab.stats.adaptability ??= { ground: 100, space: 100 };
    for (const extra of ["water", "air", "atmosphere", "mountain"])
      prefab.stats.adaptability[extra] ??= 0;
    for (const extra of ["forest", "snow", "desert", "rubble"])
      prefab.stats.adaptability[extra] ??= 75;
    for (const environment of [
      "ground",
      "space",
      "water",
      "air",
      "atmosphere",
      "mountain",
      "forest",
      "snow",
      "desert",
      "rubble",
    ])
      if (
        !Number.isFinite(prefab.stats.adaptability[environment]) ||
        prefab.stats.adaptability[environment] < 0 ||
        prefab.stats.adaptability[environment] >
          (["ground", "space"].includes(environment) ? 100 : 1000)
      )
        throw Error("Invalid unit adaptability: " + prefab.id + "/" + environment);
    prefab.stats.partStructuralStrength ??= 100;
    if (
      !Number.isFinite(prefab.stats.partStructuralStrength) ||
      prefab.stats.partStructuralStrength <= 0
    )
      throw Error("Invalid structural strength: " + ref);
    validateParts(prefab.shield?.requiredParts, prefab.id + "/shield");
    if (prefab.stats.cost % catalog.formation.costStep !== 0)
      throw Error("Unit COST must follow the catalog step: " + ref);
    if (
      prefab.stats.counterLimit !== undefined &&
      (!Number.isInteger(prefab.stats.counterLimit) || prefab.stats.counterLimit < 0)
    )
      throw Error("Invalid counter limit: " + ref);
    if (!Number.isFinite(prefab.stats.mobility) || prefab.stats.mobility <= 0)
      throw Error("Invalid mobility: " + ref);
    if (prefab.stats.ship || prefab.stats.modules) {
      const footprint = prefab.stats.footprint,
        modules = prefab.stats.modules;
      if (
        (prefab.stats.ship &&
          (!footprint ||
            !Number.isInteger(footprint.width) ||
            footprint.width < 1 ||
            footprint.width > 15 ||
            !Number.isInteger(footprint.height) ||
            footprint.height < 1 ||
            footprint.height > 24)) ||
        !Array.isArray(modules) ||
        new Set(modules.map((m) => m.id)).size !== modules.length ||
        modules.some(
          (m) => !m.id || !Number.isFinite(m.hp) || m.hp <= 0 || !prefab.skeleton[m.bone],
        )
      )
        throw Error("Invalid ship footprint or modules: " + ref);
      for (const module of modules) {
        if (!module.visual) continue;
        const layers = prefab.layers.filter((l) => l.moduleId === module.id);
        if (
          typeof module.visual.separateSprite !== "boolean" ||
          layers.length !== module.visual.decals?.length ||
          module.visual.separateSprite !== layers.length > 0
        )
          throw Error("Invalid ship module artwork: " + prefab.id + "/" + module.id);
      }
      for (const weapon of Object.values(prefab.weapons)) {
        if (
          (weapon.moduleIds || []).some((id) => !modules.some((m) => m.id === id)) ||
          (weapon.attack.steps || []).some(
            (step) => step.moduleId && !modules.some((m) => m.id === step.moduleId),
          )
        )
          throw Error("Unknown ship weapon module: " + ref);
      }
    }
    prefab.stats.sensors ??= {
      sight: 8,
      radar: 10,
      antiDetection: 0,
      revealOnDetection: !!prefab.stats.ship,
    };
    for (const field of ["sight", "radar", "antiDetection"])
      if (
        !Number.isFinite(prefab.stats.sensors[field]) ||
        (field !== "antiDetection" && prefab.stats.sensors[field] < 0)
      )
        throw Error("Invalid sensor status: " + prefab.id + "/" + field);
    prefab.stats.accuracy ??= 100;
    if (
      !Number.isFinite(prefab.stats.accuracy) ||
      prefab.stats.accuracy < 0 ||
      prefab.stats.accuracy > 1000
    )
      throw Error("Invalid accuracy: " + ref);
    for (const key of ["melee", "shooting", "beam", "shell"])
      if (
        !Number.isFinite(prefab.attackBonuses?.[key]) ||
        prefab.attackBonuses[key] < -100 ||
        prefab.attackBonuses[key] > 1000
      )
        throw Error("Invalid attack bonus: " + ref + "/" + key);
    for (const defenses of [prefab.defenses, prefab.shield?.defenses]) {
      for (const key of [
        "beam",
        "shell",
        "melee",
        "dp",
        ...(defenses === prefab.defenses ? ["sp"] : []),
      ]) {
        const value = defenses?.[key];
        if (
          !value ||
          !Number.isFinite(value.percent) ||
          value.percent < 0 ||
          value.percent > 100 ||
          !Number.isFinite(value.flat) ||
          value.flat < 0
        )
          throw Error("Invalid defense: " + ref + "/" + key);
      }
    }
    if (
      !Number.isFinite(prefab.shield.hp) ||
      prefab.shield.hp < 0 ||
      ![prefab.shield.blockChance, prefab.shield.coverage].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 1,
      )
    )
      throw Error("Invalid shield: " + ref);
    const animations = Object.fromEntries(
      Object.entries(prefab.animations).map(([id, ref]) => [id, read(file(base, ref))]),
    );
    for (const [name, clip] of Object.entries(animations))
      for (const bone of Object.keys(clip.curves || {}))
        if (!prefab.skeleton[bone])
          throw Error("Animation bone not found: " + prefab.id + "/" + name + "/" + bone);
    const textureKeys = {};
    for (const [id, ref] of Object.entries(prefab.materials.textures)) {
      const key = prefab.id + "/" + id;
      textureKeys[id] = key;
      result.assets[key] =
        "data:image/png;base64," + fs.readFileSync(file(base, ref)).toString("base64");
    }
    for (const [alias, target] of Object.entries(prefab.kitAliases || {})) {
      if (
        !prefab.weaponKits.some((kit) => kit.id === target) ||
        prefab.weaponKits.some((kit) => kit.id === alias)
      )
        throw Error("Invalid kit alias: " + prefab.id + "/" + alias);
    }
    const paired = new Map(
      (prefab.pairedWeapons || []).map((group) => [
        group.id,
        PairedWeapons.variants(prefab, group, animations),
      ]),
    );
    for (const kit of prefab.weaponKits) {
      validateLocalization(kit.localization, prefab.id + "/" + kit.id);
      const id = prefab.id + "__" + kit.id;
      if (
        result.models[id] ||
        !Number.isFinite(kit.cost) ||
        kit.cost < 0 ||
        kit.cost % catalog.formation.costStep !== 0 ||
        !Array.isArray(kit.weapons) ||
        new Set(kit.weapons).size !== kit.weapons.length
      )
        throw Error("Invalid kit: " + id);
      const weapons = kit.weapons
        .flatMap(
          (key) =>
            paired.get(key)?.map((raw) => ({ ...raw, id: raw.id || key })) || [
              { ...prefab.weapons[key], id: key },
            ],
        )
        .map((raw) => {
          const key = raw?.id;
          if (raw?.availability?.hidden)
            throw Error("Hidden native weapon cannot enter a kit: " + prefab.id + "/" + key);
          validateLocalization(raw?.localization, prefab.id + "/" + key);
          if (!Number.isInteger(raw?.actionCost) || raw.actionCost < 1 || raw.actionCost > 99)
            throw Error("Invalid weapon action cost: " + prefab.id + "/" + key);
          validateParts(raw?.requiredParts, prefab.id + "/" + key);
          validateParts(raw?.anyParts, prefab.id + "/" + key);
          for (const step of raw?.attack?.steps || [])
            validateParts(step.requiredParts, prefab.id + "/" + key + "/Step");
          const weapon =
            raw &&
            (() => {
              try {
                return WeaponSequence.compile(raw);
              } catch (error) {
                throw Error(prefab.id + "/" + key + ": " + error.message);
              }
            })();
          if (!result.effects[weapon?.hitEffect]) throw Error("Missing hit effect: " + key);
          if (
            weapon.muzzleEffects !== undefined &&
            (!Array.isArray(weapon.muzzleEffects) ||
              !weapon.muzzleEffects.length ||
              weapon.muzzleEffects.some((id) => !result.effects[id]) ||
              weapon.attack.muzzleIndices.some((index) => index >= weapon.muzzleEffects.length))
          )
            throw Error("Invalid muzzle effects: " + key);

          if (
            weapon.swingEffects !== undefined &&
            (!Array.isArray(weapon.swingEffects) ||
              !weapon.swingEffects.length ||
              weapon.swingEffects.some((id) => !result.effects[id]))
          )
            throw Error("Missing melee swing effect: " + key);
          if (!weapon || (weapon.clip !== null && !animations[weapon.clip]))
            throw Error("Missing weapon/animation: " + key);
          if (
            "ammo" in weapon ||
            !Number.isFinite(weapon.en) ||
            weapon.en < 0 ||
            weapon.en > prefab.stats.en
          )
            throw Error("Weapons must use EN: " + key);
          if (
            !["beam", "shell", "melee"].includes(weapon.type) ||
            !Number.isInteger(weapon.min) ||
            !Number.isInteger(weapon.max) ||
            weapon.min < 1 ||
            weapon.max < weapon.min ||
            !Number.isFinite(weapon.damage) ||
            weapon.damage <= 0 ||
            !Number.isFinite(weapon.hit)
          )
            throw Error("Invalid weapon: " + key);
          if (
            !weapon.damageComponents ||
            Object.entries(weapon.damageComponents).some(
              ([channel, value]) =>
                ![
                  "beam",
                  "shell",
                  "melee",
                  "meleeBeam",
                  "meleeShell",
                  "beamAP",
                  "shellAP",
                  "meleeAP",
                ].includes(channel) ||
                !Number.isFinite(value) ||
                value < 0,
            ) ||
            Math.abs(
              Object.values(weapon.damageComponents).reduce((a, b) => a + b, 0) -
                weapon.damagePerShot,
            ) > 0.001
          )
            throw Error("Invalid damage components: " + key);
          for (const animation of weapon.attack.animations)
            if (animation.clip !== null && !animations[animation.clip])
              throw Error("Missing Step animation: " + animation.clip);
          if (weapon.sound) {
            if (
              !Number.isFinite(weapon.sound.volume) ||
              weapon.sound.volume < 0 ||
              weapon.sound.volume > 1
            )
              throw Error("Invalid sound volume: " + key);
            const asset = prefab.id + "/" + key;
            result.sounds[asset] =
              "data:audio/ogg;base64," +
              fs.readFileSync(file(base, weapon.sound.file)).toString("base64");
            weapon.sound = { ...weapon.sound, asset };
          }
          if (
            weapon.targetModifiers &&
            (Object.keys(weapon.targetModifiers).some(
              (k) => !["ground", "space", "water", "air"].includes(k),
            ) ||
              Object.values(weapon.targetModifiers).some(
                (v) => !Number.isFinite(v) || v < 0 || v > 10,
              ))
          )
            throw Error("Invalid weapon target modifiers: " + key);
          if (weapon.projectile) {
            const projectileKey = prefab.id + "/projectile/" + key;
            result.assets[projectileKey] =
              "data:image/png;base64," +
              fs.readFileSync(file(base, weapon.projectile.texture)).toString("base64");
            weapon.projectile = { ...weapon.projectile, asset: projectileKey };
            if (
              weapon.projectile.spreadDegrees !== undefined &&
              (!Number.isFinite(weapon.projectile.spreadDegrees) ||
                weapon.projectile.spreadDegrees < 0 ||
                weapon.projectile.spreadDegrees > 90)
            )
              throw Error("Invalid projectile spread: " + key);
            if (weapon.projectile.motion === "tether") {
              const tether = weapon.projectile.tether;
              if (
                !tether ||
                !prefab.skeleton[tether.mount?.bone] ||
                ![
                  tether.mount?.offset?.x,
                  tether.mount?.offset?.y,
                  tether.width,
                  tether.hold,
                  tether.retract,
                ].every(Number.isFinite) ||
                tether.width <= 0 ||
                tether.hold < 0 ||
                tether.retract <= 0 ||
                !/^#[0-9a-f]{6}$/i.test(tether.color)
              )
                throw Error("Invalid tether projectile: " + key);
            }
            if (!Number.isFinite(weapon.projectile.speed) || weapon.projectile.speed <= 0)
              throw Error("Invalid projectile speed: " + key);
          }
          if (weapon.type !== "melee" && !weapon.projectile)
            throw Error("Missing projectile: " + key);
          const mounts = weapon.muzzle?.mounts || (weapon.muzzle ? [weapon.muzzle] : []);
          if (
            weapon.type !== "melee" &&
            (!mounts.length ||
              mounts.length > 32 ||
              weapon.attack.muzzleIndices.some((index) => index >= mounts.length))
          )
            throw Error("Missing or invalid muzzle selection: " + key);
          for (const mount of mounts) {
            if (mount.layer) {
              if (
                !prefab.layers.some((layer) => layer.name === mount.layer) ||
                ![mount.point?.x, mount.point?.y].every(Number.isFinite)
              )
                throw Error("Invalid muzzle layer/point: " + key);
            } else if (
              !prefab.skeleton[mount.bone] ||
              ![mount.offset?.x, mount.offset?.y].every(Number.isFinite)
            )
              throw Error("Invalid muzzle bone/offset: " + key);
          }
          return { ...weapon, id: key };
        });
      if (!textureKeys[prefab.materials.icon]) throw Error("Missing unit icon: " + prefab.id);
      for (const key of ["idle", "move", "stagger"])
        if (!animations[prefab.presentation[key]])
          throw Error("Missing presentation animation: " + key);
      if (
        !["boost", "walk"].includes(prefab.presentation.movement) ||
        !animations[prefab.presentation.walk]
      )
        throw Error("Invalid movement presentation: " + prefab.id);
      const layers = prefab.layers.map((layer) => {
        validateParts(layer.requiredParts, prefab.id + "/layer/" + layer.name);
        if (
          layer.rotationSpeed !== undefined &&
          (!Number.isFinite(layer.rotationSpeed) || Math.abs(layer.rotationSpeed) > 3600)
        )
          throw Error("Invalid rotor speed: " + prefab.id);
        if (!textureKeys[layer.texture] || !prefab.skeleton[layer.bone])
          throw Error("Invalid layer: " + layer.name);
        if (
          layer.frameFps !== undefined &&
          (!Number.isFinite(layer.frameFps) ||
            layer.frameFps <= 0 ||
            !Number.isInteger(layer.frames) ||
            layer.frames < 1)
        )
          throw Error("Invalid animated layer: " + layer.name);
        // A paired weapon has one held ID, while each physical layer keeps its own part gate.
        const aliases = new Map(
          (prefab.pairedWeapons || [])
            .filter((g) => g.fireMode !== "independent")
            .flatMap((g) => g.channels.map((c) => [c.id, g.id])),
        );
        const remap = (value) =>
          typeof value === "string"
            ? aliases.get(value) || value
            : Array.isArray(value)
              ? [...new Set(value.map(remap))]
              : value && typeof value === "object"
                ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remap(v)]))
                : value;
        return {
          ...layer,
          ...(layer.visibleWhen
            ? {
                visibleWhen: {
                  ...layer.visibleWhen,
                  ...(layer.visibleWhen.heldWeapon !== undefined
                    ? { heldWeapon: remap(layer.visibleWhen.heldWeapon) }
                    : {}),
                },
              }
            : {}),
          asset: textureKeys[layer.texture],
        };
      });
      result.models[id] = {
        ...prefab.stats,
        wip: prefab.wip,
        disabled: prefab.disabled,
        formOnly: prefab.formOnly === true,
        faction: prefab.faction,
        availableFactions: prefab.availableFactions,
        tags: prefab.tags,
        unitTags: prefab.unitTags || [],
        transport: prefab.transport || { slotCost: 1, loadTags: [] },
        hangars: prefab.hangars || [],
        name: prefab.name,
        localization: prefab.localization,
        kitLocalization: kit.localization,
        code: prefab.code,
        kitName: kit.name,
        prefabId: prefab.id,
        kitId: kit.id,
        cost: prefab.stats.cost + kit.cost,
        weapons,
        skills: prefab.skills || [],
        presentation: prefab.presentation,
        defenses: prefab.defenses,
        attackBonuses: prefab.attackBonuses,
        shield: prefab.shield,
        description: prefab.description,
        sourceStats: prefab.sourceStats,
        mechanics: prefab.mechanics || [],
        hiddenWeapons: Object.entries(prefab.weapons)
          .filter(([, w]) => w.availability?.hidden && !w.availability.mergedInto)
          .map(([id, w]) => ({ id, name: w.name, ...w.availability }))
          .concat(prefab.deferredWeapons || []),
      };
      result.units.push({
        id,
        kit: kit.id,
        name: prefab.name,
        localization: prefab.localization,
        kitLocalization: kit.localization,
        icon: textureKeys[prefab.materials.icon],
        bones: prefab.skeleton,
        decals: layers,
        animations,
        presentation: prefab.presentation,
      });
    }
    result.prefabs.push(prefab);
  }
  for (const prefab of result.prefabs)
    for (const skill of prefab.skills || [])
      for (const target of [
        !["escape", "transform", "armor_purge"].includes(skill.type) ||
        skill.source.mode === "remove"
          ? null
          : skill.source,
        skill.spawn,
      ].filter(Boolean)) {
        for (const kit of [target.kitId, ...Object.values(target.kitMap || {})])
          if (!result.models[target.unitId + "__" + kit])
            throw Error("Unknown skill result: " + prefab.id + "/" + skill.id);
      }
  for (const prefab of result.prefabs)
    for (const skill of prefab.skills || [])
      if (skill.type === "overdrive") {
        for (const [baseKit, formKit] of Object.entries(skill.formKits))
          if (
            !result.models[prefab.id + "__" + baseKit] ||
            !result.models[skill.formUnitId + "__" + formKit]?.formOnly
          )
            throw Error("Invalid overdrive form: " + prefab.id);
      }
  if (result.presentation.deathEffects) {
    const death = result.presentation.deathEffects;
    for (const group of ["standard", "large", "largeBurst"])
      for (const env of ["ground", "space", "water"])
        if (!result.effects[death[group]?.[env]])
          throw Error("Invalid death effect: " + group + "/" + env);
    const sequence = death.largeSequence;
    if (
      !Number.isInteger(sequence.count) ||
      sequence.count < 1 ||
      sequence.count > 50 ||
      !Number.isFinite(sequence.interval) ||
      sequence.interval <= 0 ||
      !Number.isFinite(sequence.finalDelay) ||
      sequence.finalDelay < (sequence.count - 1) * sequence.interval ||
      ![sequence.spreadX, sequence.spreadY].every((v) => Number.isFinite(v) && v >= 0)
    )
      throw Error("Invalid large death sequence");
  }
  for (const pattern of wipPolicy.units)
    if (
      !result.prefabs.some((prefab) =>
        pattern.endsWith("*") ? prefab.id.startsWith(pattern.slice(0, -1)) : prefab.id === pattern,
      )
    )
      throw Error("Unknown WIP unit or series: " + pattern);
  if (!result.prefabs.length) throw Error("No enabled units in catalog");
  return result;
}
module.exports = { loadCatalog };
