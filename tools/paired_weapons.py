"""Describe physical L/R channels without overwriting original MOD weapon flows."""
import re


def configure(prefab):
    prefab.pop("pairedWeapons", None)
    if prefab["stats"].get("ship"):
        return
    if "Infantry" in prefab.get("unitTags", []):
        kit_ids = list(dict.fromkeys(
            weapon_id for kit in prefab.get("weaponKits", []) for weapon_id in kit.get("weapons", [])
        ))
        roots = [weapon_id for weapon_id in kit_ids if weapon_id in prefab["weapons"]]
        if roots:
            root = max(
                roots,
                key=lambda weapon_id: prefab["weapons"][weapon_id].get("nativeTiming", {}).get("projectiles", 1),
            )
            members = [
                (weapon_id, weapon)
                for weapon_id, weapon in prefab["weapons"].items()
                if weapon_id == root or weapon.get("availability", {}).get("mergedInto") == root
            ]
            keys = []
            for weapon_id, weapon in members:
                keys.extend(weapon.get("mergedPositions", [weapon_id]))
            keys = list(dict.fromkeys(key for key in keys if key in prefab["weapons"]))
            channels = []
            for key in keys:
                weapon = prefab["weapons"][key]
                channels.append(dict(
                    id=key,
                    weaponId=key,
                    muzzleIndex=0,
                    requiredParts=list(weapon.get("requiredParts", [])),
                    limb=None,
                ))
            if len(channels) > 1:
                prefab["pairedWeapons"] = [dict(id=root, name="\u6b65\u5175\u73ed\u9f50\u5c04", channels=channels)]
                for key in roots:
                    if key != root:
                        prefab["weapons"][key]["availability"] = dict(
                            hidden=True, reasons=["paired_weapon"], mergedInto=root
                        )
                for kit in prefab["weaponKits"]:
                    if any(key in kit["weapons"] for key in roots):
                        kit["weapons"] = [root]
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
        arm_pair = bool(re.search(r"ArmMG|ArmBR|ArmGL|HandGun|HandMG|75mmMG_Double|BigGun", family)) or family in ["EF_RX_75_MS", "ZN_MS_06M_SMS"]
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
        if {c["limb"] for c in channels} == {"leftArm", "rightArm"}:
            # Pixy's 75mm machine guns are an explicit simultaneous-fire exception.
            simultaneous = prefab["id"] == "RX_78XX" and family == "EF_75mmMG_Double"
            group["fireMode"] = "simultaneous" if simultaneous else "independent"
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
