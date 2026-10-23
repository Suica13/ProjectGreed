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
const read = (name) => JSON.parse(fs.readFileSync(name, "utf8"));
function loadCatalog({ embedMusic = false } = {}) {
  const catalog = read(path.join(root, "unit-catalog.json"));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.units) || !catalog.units.length)
    throw Error("Invalid unit catalog");
  if (
    !Number.isInteger(catalog.formation.maxUnits) ||
    catalog.formation.maxUnits < 1 ||
    catalog.formation.maxUnits > 9 ||
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
  const result = { ...catalog, prefabs: [], units: [], assets: {}, sounds: {}, models: {} };
  result.presentation = read(file(root, catalog.presentation));
  for (const key of ["deathSound", "moveSound"]) {
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
  for (const ref of catalog.units) {
    const source = file(root, ref),
      base = path.dirname(source),
      prefab = read(source);
    if (prefab.schemaVersion !== 2 || result.prefabs.some((p) => p.id === prefab.id))
      throw Error("Invalid prefab: " + ref);
    if (!/^[A-Za-z0-9_]+$/.test(prefab.id) || !prefab.weaponKits?.length)
      throw Error("Invalid unit ID or kits: " + ref);
    for (const key of ["hp", "en", "move", "cost"])
      if (!Number.isFinite(prefab.stats[key]) || prefab.stats[key] <= 0)
        throw Error("Invalid stat " + key + ": " + ref);
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
      prefab.shield.hp <= 0 ||
      ![prefab.shield.blockChance, prefab.shield.coverage].every(
        (v) => Number.isFinite(v) && v >= 0 && v <= 1,
      )
    )
      throw Error("Invalid shield: " + ref);
    const animations = Object.fromEntries(
      Object.entries(prefab.animations).map(([id, ref]) => [id, read(file(base, ref))]),
    );
    const textureKeys = {};
    for (const [id, ref] of Object.entries(prefab.materials.textures)) {
      const key = prefab.id + "/" + id;
      textureKeys[id] = key;
      result.assets[key] =
        "data:image/png;base64," + fs.readFileSync(file(base, ref)).toString("base64");
    }
    for (const kit of prefab.weaponKits) {
      const id = prefab.id + "__" + kit.id;
      if (
        result.models[id] ||
        !Number.isFinite(kit.cost) ||
        kit.cost < 0 ||
        !Array.isArray(kit.weapons) ||
        !kit.weapons.length ||
        new Set(kit.weapons).size !== kit.weapons.length
      )
        throw Error("Invalid kit: " + id);
      const weapons = kit.weapons.map((key) => {
        const raw = prefab.weapons[key];
        const weapon = raw && WeaponSequence.compile(raw);
        if (!result.effects[weapon?.hitEffect]) throw Error("Missing hit effect: " + key);
        if (!weapon || (weapon.clip !== null && !animations[weapon.clip]))
          throw Error("Missing weapon/animation: " + key);
        if (
          "ammo" in weapon ||
          !Number.isInteger(weapon.en) ||
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
          if (!Number.isFinite(weapon.projectile.speed) || weapon.projectile.speed <= 0)
            throw Error("Invalid projectile speed: " + key);
        }
        if (weapon.type !== "melee" && !weapon.projectile)
          throw Error("Missing projectile: " + key);
        if (weapon.muzzle?.layer && !prefab.layers.some((l) => l.name === weapon.muzzle.layer))
          throw Error("Missing muzzle layer: " + key);
        if (weapon.muzzle?.bone && !prefab.skeleton[weapon.muzzle.bone])
          throw Error("Missing muzzle bone: " + key);
        return { ...weapon, id: key };
      });
      if (!textureKeys[prefab.materials.icon]) throw Error("Missing unit icon: " + prefab.id);
      for (const key of ["idle", "move", "stagger"])
        if (!animations[prefab.presentation[key]])
          throw Error("Missing presentation animation: " + key);
      const layers = prefab.layers.map((layer) => {
        if (!textureKeys[layer.texture] || !prefab.skeleton[layer.bone])
          throw Error("Invalid layer: " + layer.name);
        return { ...layer, asset: textureKeys[layer.texture] };
      });
      result.models[id] = {
        ...prefab.stats,
        name: prefab.name,
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
        icon: textureKeys[prefab.materials.icon],
        bones: prefab.skeleton,
        decals: layers,
        animations,
        presentation: prefab.presentation,
      });
    }
    result.prefabs.push(prefab);
  }
  return result;
}
module.exports = { loadCatalog };
