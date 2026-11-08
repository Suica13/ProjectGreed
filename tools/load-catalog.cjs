const WeaponClasses = require("../shared/weapon-classes.js");
const WeaponStore = require("./weapon-store.cjs");
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
const read = (name) => WeaponStore.parse(fs.readFileSync(name, "utf8").replace(/^\uFEFF/, ""));
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
  embedAssets = true,
  catalogOverride = null,
  unitOverrides = {},
  mapOverrides = {},
  wipOverride = null,
  adjustmentsOverride = null,
  conversionOverride = null,
  weaponDefinitionsOverride = null,
  reuseCatalog = null,
  changedUnits = null,
} = {}) {
  const Adjust = require("../shared/catalog-adjustments.cjs");
  const adjustments = adjustmentsOverride || Adjust.read();
  const conversion = conversionOverride || require("../shared/conversion-rules.cjs").read();
  const localize = require("./display-localization.cjs").createLocalizer();
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
  const result = {
    ...catalog,
    conversionRules: conversion,
    prefabs: [],
    units: [],
    assets: {},
    sounds: {},
    models: {},
  };
  result.sounds["pilot/activation"] =
    "data:audio/ogg;base64," +
    fs.readFileSync(file(root, "sounds/Action_8.ogg")).toString("base64");
  if (embedAssets) result.assets["asset:encounter-pixel-props-v1"] = "data:image/png;base64," + fs.readFileSync(file(root, "maps/tilesets/encounter-pixel-props-v1.png")).toString("base64");
  for (const id of read(file(root, "maps/biomes/catalog.json")).biomes) {
    const biome = read(file(root, "maps/biomes/" + id + "/biome.json"));
    if (embedAssets) result.assets[biome.asset] = "data:image/png;base64," + fs.readFileSync(file(root, "maps/biomes/" + id + "/" + biome.image)).toString("base64");
  }
  result.maps = {};
  result.scenarios = {};
  const mapReferences = [...catalog.maps];
  const scenarioIndex = catalog.scenarioIndex ? file(root, catalog.scenarioIndex) : null;
  const scenarioReferences = scenarioIndex
    ? read(scenarioIndex).scenarios.map((ref) =>
        path
          .relative(root, file(path.dirname(scenarioIndex), ref))
          .split(path.sep)
          .join("/"),
      )
    : catalog.scenarios || [];
  for (const reference of scenarioReferences) {
    const filename = file(root, reference),
      base = path.dirname(filename),
      scenario = read(filename);
    if (
      !/^[a-z0-9_]+$/.test(scenario.id) ||
      result.scenarios[scenario.id] ||
      scenario.playersPerTeam !== 5
    )
      throw Error("Invalid strategic scenario: " + reference);
    const world = read(file(base, scenario.world)),
      regions = {};
    for (const region of world.regions) {
      const entry = scenario.regions[region.id];
      if (!entry || typeof entry.map !== "string")
        throw Error("Missing regional map: " + region.id);
      const target = entry.map.startsWith("@encounter/")
        ? file(root, "maps/encounter/" + entry.map.slice(11) + ".json")
        : file(base, entry.map);
      const ref = path.relative(root, target).split(path.sep).join("/");
      const map = mapOverrides[ref] || read(target);
      if (!mapReferences.includes(ref)) mapReferences.push(ref);
      const layout = entry.layout ? read(file(base, entry.layout)) : map;
      require("../shared/campaign-battlefield.js").validateLayout(
        layout.strategic || layout,
        map,
        region,
      );
      regions[region.id] = { ...entry, mapId: map.id, layout: layout.strategic || layout };
    }
    result.scenarios[scenario.id] = { ...scenario, world, regions };
  }
  if (!Array.isArray(catalog.maps) || !catalog.maps.length) throw Error("Missing preset maps");
  for (const reference of mapReferences) {
    const map = mapOverrides[reference] || read(file(root, reference));
    localize.record(map);
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
      map.playersPerTeam > (map.battlefield ? 6 : 5) ||
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
          row.some(
            (t) =>
              ![
                "plain",
                "forest",
                "rubble",
                "rock",
                "water",
                "highland",
                "snow",
                "desert",
              ].includes(t),
          ),
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
            !["plain", "forest", "rubble", "rock", "water", "highland", "snow", "desert"].includes(
              kind,
            ) ||
            typeof color !== "string" ||
            !/^#[0-9a-f]{6}$/i.test(color),
        ))
    )
      throw Error("Invalid map appearance: " + map.id);
    if (map.maxTeams !== undefined && map.maxTeams !== 2)
      throw Error("Current game supports two teams: " + map.id);
    if (
      map.supportedModes !== undefined &&
      (!Array.isArray(map.supportedModes) ||
        !map.supportedModes.length ||
        map.supportedModes.some((mode) => !["regular", "quick", "battlefield"].includes(mode)))
    )
      throw Error("Invalid map modes: " + map.id);
    if (
      map.cellEnvironments !== undefined &&
      (!Array.isArray(map.cellEnvironments) ||
        map.cellEnvironments.length !== map.height ||
        map.cellEnvironments.some(
          (row) =>
            !Array.isArray(row) ||
            row.length !== map.width ||
            row.some((e) => !["ground", "space"].includes(e)),
        ))
    )
      throw Error("Invalid cell environments: " + map.id);
    if (map.tileMap) {
      const M = require("../shared/map-document.js");
      M.validate(map.tileMap);
      if (
        map.tileMap.id !== map.id ||
        map.tileMap.width !== map.width ||
        map.tileMap.height !== map.height
      )
        throw Error("TileMap dimensions/ID mismatch: " + map.id);
    }
    if (map.battlefield) require("../shared/battlefield-mode.js").validateMap(map);
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
      // Regional maps deploy via their central base and linked entrances.
      if (map.scope === "strategic" && map.strategic) continue;
      let capacity = 0;
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++)
          if (inside(x, y) && !["rock", "water"].includes(map.tiles[y][x])) capacity++;
      if (capacity < catalog.formation.maxUnits)
        throw Error("Spawn area too small for maximum formation: " + map.id);
      if (
        !map.battlefield && map.spawns.slice(0, seat).some((other, index) => {
          if (other.team === spawn.team) return false;
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
  for (const scenario of Object.values(result.scenarios))
    for (const entry of Object.values(scenario.regions))
      if (result.maps[entry.mapId]?.playersPerTeam !== scenario.playersPerTeam)
        throw Error("Regional map must support 5v5: " + entry.mapId);
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
    "buttonSound",
    "productionSound",
    "deploymentSound",
    "researchSound",
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
    if (embedAssets)
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
  const defaultEquipment =
    read(path.resolve(__dirname, "../shared/production-catalog.json")).defaultKits || {};
  const changed = changedUnits && new Set(changedUnits);
  const retained = new Map(), retainedModels = new Map(), retainedArt = new Map();
  if (reuseCatalog && changed && !embedAssets) {
    for (const prefab of reuseCatalog.prefabs) retained.set(prefab.id, prefab);
    for (const [id, model] of Object.entries(reuseCatalog.models)) {
      if (!retainedModels.has(model.prefabId)) retainedModels.set(model.prefabId, {});
      retainedModels.get(model.prefabId)[id] = model;
    }
    for (const art of reuseCatalog.units) {
      const id = reuseCatalog.models[art.id].prefabId;
      if (!retainedArt.has(id)) retainedArt.set(id, []);
      retainedArt.get(id).push(art);
    }
    Object.assign(result.sounds, reuseCatalog.sounds);
  }
  for (const ref of catalog.units) {
    const source = file(root, ref),
      base = path.dirname(source),
      raw =
        unitOverrides[ref] || JSON.parse(fs.readFileSync(source, "utf8").replace(/^\uFEFF/, "")),
      cached = retained.get(raw.id);
    if (cached && !changed.has(raw.id)) {
      result.prefabs.push(cached);
      Object.assign(result.models, retainedModels.get(raw.id));
      result.units.push(...(retainedArt.get(raw.id) || []));
      continue;
    }
    const prefab = WeaponStore.expandPrefab(raw, weaponDefinitionsOverride || undefined);
    if (prefab.enabled === false) continue;
    prefab.skills = (prefab.skills || []).filter(skill => skill.type !== "emp");
    if (prefab.stats.deployed && prefab.stats.movementType === "air") {
      prefab.stats.movementType = "ground";
      prefab.presentation.thrusters = false;
      prefab.presentation.movement = "walk";
    }
    localize.prefab(prefab);
    require("./unit-footprint.cjs").compactShipFootprint(prefab);
    require("./weapon-balance.cjs").applyWeaponBalance(prefab, conversion);
    Adjust.unit(prefab, adjustments, raw.weapons);
    require("../shared/conversion-rules.cjs").roundValues(prefab);
    require("./weapon-level-labels.cjs").applyWeaponLevelLabels(prefab);
    // Skills and weapons share the same 25-point damage quantization policy.
    for (const skill of prefab.skills || [])
      if (skill.damageComponents)
        skill.damageComponents = WeaponSequence.roundComponents(skill.damageComponents);
    prefab.wip = isWip(prefab.id);
    prefab.disabled = prefab.wip;
    validateLocalization(prefab.localization, ref);
    if (
      prefab.availableFactions !== undefined &&
      (!Array.isArray(prefab.availableFactions) ||
        !prefab.availableFactions.length ||
        prefab.availableFactions.some(
          (value) => !["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(value),
        ))
    )
      throw Error("Invalid available factions: " + prefab.id);
    if (
      !Number.isInteger(prefab.stats.actionPoints * 2) ||
      prefab.stats.actionPoints < 1 ||
      prefab.stats.actionPoints > 99
    )
      throw Error("Invalid unit action points: " + prefab.id);
    if (
      !Array.isArray(prefab.tags) ||
      prefab.tags.filter((tag) => ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(tag))
        .length !== 1
    )
      throw Error("Unit must have exactly one primary faction tag: " + ref);
    if (!prefab.tags.some((tag) => /^\d{4}(?:T[12])?$/.test(tag)))
      throw Error("Unit must have an era tag: " + ref);
    prefab.unitTags ??= [];
    if (prefab.unitTags.includes("MA"))
      prefab.unitTags = [
        ...prefab.unitTags.filter((tag) => !["SmallUnit", "MediumUnit", "LargeUnit"].includes(tag)),
        "LargeUnit",
      ];
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
          (h.kind === "sfs" &&
            (h.capacity !== 1 ||
              !h.offset ||
              [h.offset.x, h.offset.y, h.offset.height].some(
                (value) => !Number.isFinite(value) || Math.abs(value) > 500,
              ))) ||
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
    prefab.faction = prefab.tags.find((tag) =>
      ["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].includes(tag),
    );
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
          !(key === "cost" && prefab.id.startsWith("Army_Squad_") && prefab.stats.cost === 0) &&
          !(key === "move" && prefab.stats.deployed === true && prefab.stats.move === 0))
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
    if (
      prefab.stats.pilotExperienceMultiplier !== undefined &&
      (!Number.isFinite(prefab.stats.pilotExperienceMultiplier) ||
        prefab.stats.pilotExperienceMultiplier <= 0)
    )
      throw Error("Invalid pilot experience multiplier: " + prefab.id);
    if (
      prefab.refits !== undefined &&
      (!Array.isArray(prefab.refits) ||
        prefab.refits.some(
          (r) =>
            !r ||
            typeof r.id !== "string" ||
            !/^[A-Za-z0-9_]+$/.test(r.unitId) ||
            ![r.money, r.supplies].every((n) => Number.isSafeInteger(n) && n >= 0) ||
            typeof r.blocked !== "boolean" ||
            !Array.isArray(r.unlockUnits) ||
            r.unlockUnits.some((id) => typeof id !== "string"),
        ))
    )
      throw Error("Invalid native refits: " + prefab.id);
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
      if (["repair", "recon"].includes(skill.type) && skill.enCost > Math.max(prefab.stats.en, prefab.sourceStats?.enBeforeReduction || 0))
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
      if (skill.fireSound) {
        if (
          !Number.isFinite(skill.fireSound.volume) ||
          skill.fireSound.volume < 0 ||
          skill.fireSound.volume > 1
        )
          throw Error("Invalid skill firing sound: " + skill.id);
        const fireAsset = asset + "/fire";
        result.sounds[fireAsset] =
          "data:audio/ogg;base64," +
          fs.readFileSync(file(base, skill.fireSound.file)).toString("base64");
        skill.fireSound.asset = fireAsset;
      }
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
    // speed is unit mobility; legacy mobility is the native reaction coefficient.
    prefab.stats.speed ??= 100;
    if (!Number.isFinite(prefab.stats.speed) || prefab.stats.speed < 0)
      throw Error("Invalid unit speed: " + ref);
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
    if (prefab.stats.iField) {
      const f = prefab.stats.iField;
      if (
        !Number.isFinite(f.capacity) ||
        f.capacity <= 0 ||
        ![f.reduction, f.piercingReduction].every((n) => Number.isFinite(n) && n >= 0 && n <= 1) ||
        !Number.isFinite(f.recoveryPercent) ||
        f.recoveryPercent < 0 ||
        f.recoveryPercent > 100 ||
        f.minimumRatio !== -0.25
      )
        throw Error("Invalid I-field configuration: " + ref);
    }
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
      if (embedAssets)
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
    prefab.defaultKit = defaultEquipment[prefab.id] || prefab.weaponKits[0].id;
    prefab.weaponKits.sort(
      (a, b) => Number(b.id === prefab.defaultKit) - Number(a.id === prefab.defaultKit),
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
          if (
            raw.pilotRequirements !== undefined &&
            (!Array.isArray(raw.pilotRequirements) ||
              !raw.pilotRequirements.length ||
              raw.pilotRequirements.some(
                (r) =>
                  !r ||
                  ![
                    "shooting",
                    "melee",
                    "defense",
                    "speed",
                    "accuracy",
                    "reaction",
                    "leadership",
                    "awakening",
                  ].includes(r.stat) ||
                  ![">", ">=", "<", "<=", "==", "!="].includes(r.operator) ||
                  !Number.isFinite(r.value),
              ))
          )
            throw Error("Invalid pilot weapon requirement: " + prefab.id + "/" + key);
          if (raw.burn !== undefined && (raw.burn.durationTurns !== 3 || raw.burn.hpPercent !== 5))
            throw Error("Invalid burn status: " + prefab.id + "/" + key);
          if (raw.requiresSfsMS !== undefined && typeof raw.requiresSfsMS !== "boolean")
            throw Error("Invalid SFS weapon requirement: " + prefab.id + "/" + key);
          if (raw.requiresShield !== undefined && typeof raw.requiresShield !== "boolean")
            throw Error("Invalid weapon shield requirement: " + prefab.id + "/" + key);
          require("../shared/weapon-classes.js").classify(raw, key);
          if (!Number.isInteger(raw?.actionCost * 2) || raw.actionCost < 0.5 || raw.actionCost > 99)
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
          for (const step of weapon.attack.steps)
            if (step.swingEffects !== undefined &&
                (!Array.isArray(step.swingEffects) || step.swingEffects.length > 16 ||
                 step.swingEffects.some(id => typeof id !== "string" || !result.effects[id])))
              throw Error("Invalid per-strike melee effects: " + key);
          if (!Number.isFinite(weapon.armorPiercingIgnore) || weapon.armorPiercingIgnore < 0 || weapon.armorPiercingIgnore > 1)
            throw Error("Invalid armor piercing resistance ratio: " + key);
          if (!result.effects[weapon?.hitEffect]) throw Error("Missing hit effect: " + key);
          if (weapon.hitEffects !== undefined &&
              (!Array.isArray(weapon.hitEffects) || !weapon.hitEffects.length ||
               weapon.hitEffects.some(id => typeof id !== "string" || !result.effects[id])))
            throw Error("Invalid combined hit effects: " + key);
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
          if (!Number.isInteger(weapon.attackRounds) || weapon.attackRounds < 0 || weapon.attackRounds > 20)
            throw Error("Invalid weapon attack rounds: " + key);
          if (!weapon || (weapon.clip !== null && !animations[weapon.clip]))
            throw Error("Missing weapon/animation: " + key);
          if (
            "ammo" in weapon ||
            !Number.isFinite(weapon.en) ||
            weapon.en < 0 ||
            weapon.en > Math.max(prefab.stats.en, prefab.sourceStats?.enBeforeReduction || 0)
          )
            throw Error("Weapons must use EN: " + key);
          if (
            !["beam", "shell", "melee"].includes(weapon.type) ||
            !Number.isInteger(weapon.min) ||
            !Number.isInteger(weapon.max) ||
            weapon.min < 1 ||
            weapon.max < weapon.min ||
            !Number.isFinite(weapon.damage) ||
            weapon.damage < 0 ||
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
                  "meleeBeamAP",
                  "meleeShellAP",
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
            if (embedAssets)
              result.assets[projectileKey] =
                "data:image/png;base64," +
                fs.readFileSync(file(base, weapon.projectile.texture)).toString("base64");
            weapon.projectile = { ...weapon.projectile, asset: projectileKey };
            if (weapon.projectile.cluster) {
              const cluster = weapon.projectile.cluster;
              if (
                !(cluster.splitFraction > 0 && cluster.splitFraction < 1) ||
                !Number.isInteger(cluster.count) ||
                cluster.count < 1 ||
                cluster.count > 64 ||
                !Number.isFinite(cluster.spreadDegrees) ||
                cluster.spreadDegrees < 0 ||
                cluster.spreadDegrees > 90 ||
                !Number.isFinite(cluster.speed) ||
                cluster.speed <= 0 ||
                !Number.isFinite(cluster.scale) ||
                cluster.scale <= 0
              )
                throw Error("Invalid cluster projectile: " + key);
              const asset = projectileKey + "/fragments";
              const texture = file(base, cluster.texture);
              if (embedAssets)
                result.assets[asset] =
                  "data:image/png;base64," + fs.readFileSync(texture).toString("base64");
              cluster.asset = asset;
            }
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
          if (weapon.remote) {
            const remote = weapon.remote;
            if (
              !["funnel", "wired", "incom"].includes(remote.kind) ||
              !Array.isArray(remote.units) ||
              !remote.units.length ||
              remote.units.length > 16 ||
              remote.shotsPerUnit !== 2 ||
              weapon.attack.shots.length !== remote.units.reduce((sum, unit) => sum + (unit.burstShots ?? 1) * remote.shotsPerUnit, 0) ||
              remote.units.some(unit => !Number.isInteger(unit.burstShots ?? 1) || (unit.burstShots ?? 1) < 1 || (unit.burstShots ?? 1) > 64) ||
              ![
                "moveSeconds",
                "settleSeconds",
                "waitSeconds",
                "staggerSeconds",
                "returnSeconds",
              ].every((name) => Number.isFinite(remote[name]) && remote[name] > 0) ||
              !Number.isFinite(remote.awakeningScale) ||
              remote.awakeningScale < 0 ||
              (remote.kind === "incom" && remote.awakeningScale !== 0)
            )
              throw Error("Invalid remote weapon: " + key);
            weapon.remote = {
              ...remote,
              units: remote.units.map((unit) => {
                if (!textureKeys[unit.texture] || !Number.isFinite(unit.scale) || unit.scale <= 0)
                  throw Error("Missing remote sprite: " + key);
                let trail = unit.trail;
                if (trail) {
                  if (![trail.alpha, trail.lifeSeconds, trail.intervalSeconds, trail.scaleFrom, trail.scaleTo].every(Number.isFinite) ||
                      trail.alpha < 0 || trail.alpha > 1 || trail.lifeSeconds <= 0 || trail.lifeSeconds > 1 || trail.intervalSeconds < .01)
                    throw Error("Invalid remote beam trail: " + key);
                  const asset = prefab.id + "/remote-trail/" + trail.texture;
                  if (embedAssets) result.assets[asset] = "data:image/png;base64," + fs.readFileSync(file(base, trail.texture)).toString("base64");
                  trail = { ...trail, asset };
                }
                return { ...unit, trail, asset: textureKeys[unit.texture] };
              }),
            };
          }
          weapon.en = Math.round(weapon.en);
          return require("./weapon-level-labels.cjs").labelWeapon(
            { ...weapon, id: key },
            prefab.id,
          );
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
      const meleeWeapons = weapons.filter((w) => w.type === "melee");
      const normalMelee = meleeWeapons.filter((w) => WeaponClasses.classify(w) !== "ram");
      for (const w of normalMelee)
        if (WeaponClasses.pilotGateExempt(w)) delete w.pilotRequirements;
      const ungatedMelee = normalMelee.filter((w) => !w.pilotRequirements?.length);
      // Leave a basic melee option usable by ordinary pilots. Utility whips do
      // not take that slot ahead of a conventional sword; native gates stay intact.
      const basicMelee = ungatedMelee.find((w) =>
        w.rangeRole !== "tether_melee" && !w.nativePayload?.StunDamage) || ungatedMelee[0];
      meleeWeapons.forEach((w) => {
        if (normalMelee.length > 1 && normalMelee.includes(w) && w !== basicMelee && !WeaponClasses.pilotGateExempt(w) && !w.pilotRequirements?.length)
          w.pilotRequirements = [{ stat: "melee", operator: ">=", value: 125 }];
        if (w.pilotRequirements?.length) w.maxUsesPerTurn = 1;
        else if (w.maxUsesPerTurn === 1) delete w.maxUsesPerTurn;
      });
      result.models[id] = {
        ...prefab.stats,
        move: prefab.stats.deployed
          ? 0
          : prefab.stats.move + Math.trunc((prefab.stats.speed - 100) / 50),
        actionPoints: prefab.stats.actionPoints ?? 10,
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
        pilotForms: prefab.pilotForms || [],
        requiredPilotId: prefab.requiredPilotId,
        production: prefab.production,
        hiddenWeapons: Object.entries(prefab.weapons)
          .filter(
            ([, w]) =>
              w.availability?.hidden &&
              !w.availability.mergedInto &&
              !w.availability.convertedSkill,
          )
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
