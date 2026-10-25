"""Describe physical L/R channels without overwriting original MOD weapon flows."""
import re


def configure(prefab):
    prefab.pop("pairedWeapons", None)
    if prefab["stats"].get("ship"):
        return
    families = {}
    for key, weapon in prefab["weapons"].items():
        if weapon["type"] == "melee" or weapon.get("moduleIds"):
            continue
        reasons = weapon.get("availability", {}).get("reasons", [])
        if any(reason not in ["merged_position", "paired_weapon"] for reason in reasons):
            continue
        source_name = weapon.get("sourceName", key)
        family = re.sub(r"_[LR]$", "", source_name)
        families.setdefault(family, []).append(key)
    groups = []
    processed = set()
    for family, keys in families.items():
        keys = [key for key in keys if key not in processed]
        if len({prefab["weapons"][key].get("sourceName", key) for key in keys}) < 2:
            continue
        root = next((key for key in keys if prefab["weapons"][key].get("sourceName", key) == family), keys[0])
        main = prefab["weapons"][root]
        physical = {}
        for key in keys:
            weapon = prefab["weapons"][key]
            mounts = weapon["muzzle"].get("mounts", [weapon["muzzle"]])
            for i, barrel in enumerate(weapon["source"].get("barrels", [])):
                active = {step.get("muzzleIndex", 0) for step in weapon.get("attack", {}).get("steps", []) if step.get("shots", 0) > 0}
                if i >= len(mounts) or i not in active:
                    continue
                ident = barrel["id"]
                if ident not in physical or weapon.get("sourceName", key) == ident:
                    physical[ident] = (key, i, barrel)
        if len(physical) < 2:
            continue
        # Multi-barrel aliases (e.g. R2/L2) may point into this same native flow.
        keys = list(dict.fromkeys(keys + [key for key, weapon in prefab["weapons"].items()
            if weapon.get("sourceName", key) in physical and
            all(r in ["merged_position", "paired_weapon"] for r in weapon.get("availability", {}).get("reasons", []))]))
        processed.update(keys)
        channels = []
        arm_pair = bool(re.search(r"ArmMG|ArmBR|ArmGL|HandGun|HandMG|75mmMG_Double|BigGun", family))
        leg_pair = "LegMS" in family
        for ident, (key, index, barrel) in physical.items():
            weapon = prefab["weapons"][key]
            required = list(main.get("requiredParts", []))
            limb = None
            if prefab["stats"].get("partsBreakable", True) and (arm_pair or leg_pair):
                side = "left" if barrel["x"] < 0 else "right"
                limb = side + ("Arm" if arm_pair else "Leg")
                required = [p for p in required if p not in ["leftArm", "rightArm", "leftLeg", "rightLeg"]] + [limb]
            channels.append(dict(id=ident, weaponId=key, muzzleIndex=index, requiredParts=required, limb=limb))
        group = dict(id=root, channels=channels)
        if "ArmMG" in family:group["name"] = "腕部机枪"
        elif "ArmBR" in family:group["name"] = "腕部光束枪"
        groups.append(group)
        for key in keys:
            if key != root:
                prefab["weapons"][key]["availability"] = dict(hidden=True, reasons=["paired_weapon"], mergedInto=root)
        for kit in prefab["weaponKits"]:
            mapped = [root if key in keys else key for key in kit["weapons"]]
            kit["weapons"] = list(dict.fromkeys(mapped))
    if groups:
        prefab["pairedWeapons"] = groups
