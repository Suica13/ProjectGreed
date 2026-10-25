"""Restore native rod/anchor projectiles without changing their melee damage payload."""
import shutil
import copy
from mod_source import ROOT, ASSETS, section

WEAPONS = {
    "ZN_MS_07B_HeatRod": ("热能鞭", "Heat rod", "ヒートロッド"),
    "EF_RB_79K_Anchor": ("缆绳锚", "Wire anchor", "ワイヤーアンカー"),
}

def correct(prefab, native):
    for key, weapon in prefab["weapons"].items():
        if key not in WEAPONS:
            continue
        decal = section(native, "decal_DrawLineTo_" + key + "_Unit")
        texture = ROOT / "Resource/Image/Bullet/Sp/ZN_HeatRod.png"
        destination = ASSETS / "projectiles" / texture.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(texture, destination)
        name, english, japanese = WEAPONS[key]
        weapon["name"] = name
        weapon.setdefault("localization", {}).update(zh={"name": name}, en={"name": english}, ja={"name": japanese})
        weapon["projectile"] = {
            "texture": "../../projectiles/" + texture.name,
            "scale": 1, "speed": weapon["nativePayload"]["ProjectileSpeed"],
            "forwardOffset": 0, "rotation": 0, "motion": "tether",
            "tether": {
                "mount": {"bone": "RightArm", "offset": {
                    "x": float(decal["xOffsetRelative"]), "y": float(decal["yOffsetRelative"]) }},
                "color": decal["color"], "width": float(decal["lineWidth"]),
                "hold": 0.25, "retract": 0.35,
            },
        }
        if key == "EF_RB_79K_Anchor":
            # Ball K launches from the central body mount. The inherited arm4
            # cable decal belongs to the Gouf and is not its actual anchor socket.
            weapon["projectile"]["tether"]["mount"] = copy.deepcopy(weapon["muzzle"])
        weapon.pop("swingEffects", None)
        # The native trigger uses 60 < distance <= 150: a short thrown melee weapon.
        weapon["min"], weapon["max"] = 1, 2
        weapon["rangeRole"] = "tether_melee"
