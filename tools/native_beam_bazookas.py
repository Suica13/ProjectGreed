"""Restore beam-bazooka visuals from the actual native spawned projectile."""
import re
from mod_source import MOD, MAIN, ASSETS, load, section, resolve, source_root
from native_combat import source_for

def apply(prefab, native=None):
    for weapon in prefab.get("weapons", {}).values():
        if weapon.get("type") != "beam" or "BeamBazooka" not in weapon.get("sourceName", ""):
            continue
        data = load(source_for(weapon, prefab))
        barrel = weapon["source"]["barrels"][0]["id"]
        turret = section(data, "turret_" + barrel)
        spawn = section(data, "projectile_" + turret["projectile"])["spawnUnit"]
        bullet_id = re.match(r"\s*(\w+)", spawn)[1]
        root = MOD / prefab["source"].split("/")[0]
        files = [file for base in [root, MAIN] for file in
                 (base / "Units/BattleUnits/Weapon").rglob(bullet_id + ".ini")]
        if not files:
            raise ValueError("Missing native beam bazooka projectile: " + bullet_id)
        bullet = load(files[0])
        decal = section(bullet, "decal_Projectile_Image")
        image = resolve(decal["image"], root=source_root(files[0]))
        target = ASSETS / "projectiles" / image.name
        if not target.exists() or target.read_bytes() != image.read_bytes():
            target.write_bytes(image.read_bytes())
        weapon["projectile"].update(
            texture="../../projectiles/" + image.name,
            scale=float(decal.get("imageScale", 1)),
            forwardOffset=float(decal.get("yOffsetRelative", 0)),
            rotation=float(decal.get("dirOffset", 0)),
        )
        effects = [name.strip() for name in
                   section(bullet, "hiddenAction_SpawnHitEffect")["spawnEffects"].split(",")]
        weapon["hitEffect"] = effects[0]
        weapon["hitEffects"] = effects
    return prefab
