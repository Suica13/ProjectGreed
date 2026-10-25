"""Read native structural strength, weapon dependencies and part-break coefficients."""
import re
from mod_source import ROOT, load, stat, section
from unit_skills import apply_body_tackle, import_tackle_assets

PARTS = {"head": "head", "backpack": "backpack", "armL": "leftArm",
         "armR": "rightArm", "legL": "leftLeg", "legR": "rightLeg"}

def apply_parts(prefab, data=None):
    import_tackle_assets()
    apply_body_tackle(prefab)
    folder = "MS_09" if prefab["id"] == "MS_09R" else prefab["id"]
    data = data or load(ROOT / f'Units/BattleUnits/{folder}/{prefab["id"]}.ini')
    # Native reaction is mobility; native accuracy is a percentage multiplier, not weapon hit.
    prefab["stats"]["mobility"] = stat(data, "baseReactionLevel", 100)
    prefab["stats"]["accuracy"] = stat(data, "baseAccuracyLevel", 100)
    prefab.setdefault("sourceStats", {}).update(
        reaction=prefab["stats"]["mobility"], accuracy=prefab["stats"]["accuracy"])
    prefab["stats"].setdefault("adaptability", {"ground": 100,
        "space": 50 if stat(data, "spaceAdaptability", 100) < 100 else 100})
    prefab["stats"]["partStructuralStrength"] = stat(data, "partStructuralStrength", 100)
    prefab.setdefault("sourceStats", {})["partStructuralStrength"] = prefab["stats"]["partStructuralStrength"]
    prefab["shield"]["requiredParts"] = ["leftArm"] if prefab["shield"]["hp"] > 0 else []
    for key, weapon in prefab["weapons"].items():
        native_key = key.replace("380mm", "360mm")
        trigger = data.get("hiddenAction_" + native_key + "_Trigger", {}).get("requireConditional", "")
        if key == "Common_Cannon":
            trigger = data.get("hiddenAction_Common_Cannon_Trigger", {}).get("requireConditional", "")
        weapon["requiredParts"] = [PARTS[p] for p in re.findall(r"memory\.(head|backpack|armL|armR|legL|legR)Breaked\s*==\s*false", trigger)]
        weapon.pop("anyParts", None)
        if key == "Common_DoubleVulcan_MS":
            weapon["requiredParts"] = ["head"]
        elif key == "ZN_MS_06J_LegMS":
            weapon["anyParts"] = ["leftLeg", "rightLeg"]
        elif key == "ZN_MS_06K_BigGun":
            weapon["anyParts"] = ["leftArm", "rightArm"]
        elif key in ("Common_SingleVulcan_RX_79_G", "Common_Push_A"):
            weapon["requiredParts"] = []  # Native chest gun, not head-mounted.
        elif not weapon["requiredParts"]:
            weapon["requiredParts"] = ["backpack"] if "Cannon" in key and key.startswith("Common_") else ["rightArm"]
        reference = weapon.get("source", {}).get("file")
        if not reference:
            reference = "Units/BattleUnits/Weapon/Shell/Common_DoubleVulcan_MS.gw"
        source = load(ROOT / reference)
        text = " ".join(str(v) for values in source.values() for v in values.values())
        coefficients = list(dict.fromkeys(float(v) for v in re.findall(r"PartBreakModifier\s*=\s*([\d.]+)", text)))
        if not coefficients:
            raise ValueError("No native PartBreakModifier for " + prefab["id"] + "/" + key)
        weapon["partBreakModifier"] = coefficients[0]
        barrels = weapon.get("source", {}).get("barrels", [])
        for step in weapon["attack"]["steps"]:
            if not step.get("shots") or step.get("muzzleIndex", 0) >= len(barrels):
                continue
            turret = barrels[step.get("muzzleIndex", 0)]["id"]
            conditions = " ".join(v.get("requireConditional", "") for v in source.values()
                                  if v.get("fireTurretXAtGround") == turret)
            needed = [PARTS[p] for p in re.findall(r"memory\.(head|backpack|armL|armR|legL|legR)Breaked\s*==\s*false", conditions)]
            if needed:
                step["requiredParts"] = list(dict.fromkeys(needed))
        if len(coefficients) > 1:
            firing = [s for s in weapon["attack"]["steps"] if s.get("shots")]
            for index, step in enumerate(firing):
                step["partBreakModifier"] = coefficients[min(index, len(coefficients) - 1)]
    # Visual dependencies are plain part names, never native memory expressions.
    bones = {"Head": "head", "Eye": "head", "LeftArm": "leftArm", "LeftShoulder": "leftArm",
             "LeftWeapon": "leftArm", "RightArm": "rightArm", "RightShoulder": "rightArm",
             "RightWeapon": "rightArm", "LeftFoot": "leftLeg", "LeftLeg": "leftLeg",
             "RightFoot": "rightLeg", "RightLeg": "rightLeg"}
    for layer in prefab["layers"]:
        name = "decal_" + layer["name"].replace("380mm", "360mm")
        source = section(data, name).get("isVisible", "") if name in data else ""
        needed = [PARTS[p] for p in re.findall(r"memory\.(head|backpack|armL|armR|legL|legR)Breaked\s*==\s*false", source)]
        if not needed and layer["bone"] in bones:
            needed = [bones[layer["bone"]]]
        if needed:
            layer["requiredParts"] = list(dict.fromkeys(needed))
    from native_mobility import correct as correct_mobility
    return correct_mobility(prefab, data)
