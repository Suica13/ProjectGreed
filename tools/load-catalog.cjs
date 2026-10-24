/* Build and server share this loader. Paths in unit.json are relative to that prefab. */
const fs = require("node:fs");
const path = require("node:path");
const WeaponSequence = require("../shared/weapon-sequence.js");
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
function loadCatalog({ embedMusic = false, catalogOverride = null } = {}) {
  const catalog = catalogOverride || read(path.join(root, "unit-catalog.json"));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.units) || !catalog.units.length)
    throw Error("Invalid unit catalog");
  if (
    !Number.isInteger(catalog.formation.maxUnits) ||
    catalog.formation.maxUnits < 1 ||
    catalog.formation.maxUnits > 12 ||
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
    catalog.map.width > 26 ||
    catalog.map.height < 9 ||
    catalog.map.height > 26
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
    if (
      !/^[a-z0-9_]+$/.test(map.id) ||
      result.maps[map.id] ||
      !Number.isInteger(map.width) ||
      !Number.isInteger(map.height) ||
      map.width < 12 ||
      map.width > 64 ||
      map.height < 9 ||
      map.height > 64 ||
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
          row.some((t) => !["plain", "forest", "rubble", "rock", "water"].includes(t)),
      )
    )
      throw Error("Invalid map: " + reference);
    if (
      map.appearance !== undefined &&
      (!map.appearance ||
        !["arctic", "urban", "desert", "wetland", "forest"].includes(map.appearance.biome) ||
        !map.appearance.colors ||
        Object.entries(map.appearance.colors).some(
          ([kind, color]) =>
            !["plain", "forest", "rubble", "rock", "water"].includes(kind) ||
            typeof color !== "string" ||
            !/^#[0-9a-f]{6}$/i.test(color),
        ))
    )
      throw Error("Invalid map appearance: " + map.id);
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
      let capacity = 0;
      for (let y = 0; y < map.height; y++)
        for (let x = 0; x < map.width; x++)
          if (
            Math.abs(x - spawn.x) + Math.abs(y - spawn.y) <= map.deploymentRadius &&
            !["rock", "water"].includes(map.tiles[y][x])
          )
            capacity++;
      if (capacity < catalog.formation.maxUnits * 2)
        throw Error("Spawn area too small for 200% AI: " + map.id);
      if (
        map.spawns
          .slice(0, seat)
          .some(
            (other) =>
              Math.abs(other.x - spawn.x) + Math.abs(other.y - spawn.y) <= map.deploymentRadius * 2,
          )
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
    "selectUnitSound",
    "selectWeaponSound",
    "changeEquipmentSound",
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
        ? { source: "data:audio/ogg;base64," + fs.readFileSync(source).toString("base64") }
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
  if (!result.effects[result.presentation.boostStartEffect])
    throw Error("Missing boost start effect");
  if (!result.effects[result.presentation.deathElectricEffect])
    throw Error("Invalid death electric effect");
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
      prefab = read(source);
    if (prefab.enabled === false) continue;
    validateLocalization(prefab.localization, ref);
    if (
      !Array.isArray(prefab.tags) ||
      prefab.tags.filter((tag) => ["EFSF", "ZEON"].includes(tag)).length !== 1
    )
      throw Error("Unit must have exactly one EFSF or ZEON tag: " + ref);
    if (!prefab.tags.some((tag) => /^\d{4}$/.test(tag)))
      throw Error("Unit must have an era tag: " + ref);
    prefab.faction = prefab.tags.find((tag) => ["EFSF", "ZEON"].includes(tag));
    if (prefab.schemaVersion !== 2 || result.prefabs.some((p) => p.id === prefab.id))
      throw Error("Invalid prefab: " + ref);
    if (typeof prefab.code !== "string" || !prefab.code.trim())
      throw Error("Invalid unit code: " + ref);
    if (!/^[A-Za-z0-9_]+$/.test(prefab.id) || !prefab.weaponKits?.length)
      throw Error("Invalid unit ID or kits: " + ref);
    for (const key of ["hp", "en", "move", "cost"])
      if (!Number.isFinite(prefab.stats[key]) || prefab.stats[key] <= 0)
        throw Error("Invalid stat " + key + ": " + ref);
    if (prefab.stats.cost % catalog.formation.costStep !== 0)
      throw Error("Unit COST must follow the catalog step: " + ref);
    if (
      prefab.stats.counterLimit !== undefined &&
      (!Number.isInteger(prefab.stats.counterLimit) || prefab.stats.counterLimit < 0)
    )
      throw Error("Invalid counter limit: " + ref);
    if (!Number.isFinite(prefab.stats.mobility) || prefab.stats.mobility <= 0)
      throw Error("Invalid mobility: " + ref);
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
    for (const kit of prefab.weaponKits) {
      validateLocalization(kit.localization, prefab.id + "/" + kit.id);
      const id = prefab.id + "__" + kit.id;
      if (
        result.models[id] ||
        !Number.isFinite(kit.cost) ||
        kit.cost < 0 ||
        kit.cost % catalog.formation.costStep !== 0 ||
        !Array.isArray(kit.weapons) ||
        !kit.weapons.length ||
        new Set(kit.weapons).size !== kit.weapons.length
      )
        throw Error("Invalid kit: " + id);
      const weapons = kit.weapons.map((key) => {
        const raw = prefab.weapons[key];
        validateLocalization(raw?.localization, prefab.id + "/" + key);
        const weapon = raw && WeaponSequence.compile(raw);
        if (!result.effects[weapon?.hitEffect]) throw Error("Missing hit effect: " + key);
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
          weapon.en <= 0 ||
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
              !["beam", "shell", "melee", "meleeBeam", "meleeShell"].includes(channel) ||
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
        return { ...layer, asset: textureKeys[layer.texture] };
      });
      result.models[id] = {
        ...prefab.stats,
        faction: prefab.faction,
        tags: prefab.tags,
        name: prefab.name,
        localization: prefab.localization,
        kitLocalization: kit.localization,
        code: prefab.code,
        kitName: kit.name,
        prefabId: prefab.id,
        kitId: kit.id,
        cost: prefab.stats.cost + kit.cost,
        weapons,
        presentation: prefab.presentation,
        defenses: prefab.defenses,
        attackBonuses: prefab.attackBonuses,
        shield: prefab.shield,
        description: prefab.description,
        sourceStats: prefab.sourceStats,
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
  if (!result.prefabs.length) throw Error("No enabled units in catalog");
  return result;
}
module.exports = { loadCatalog };
