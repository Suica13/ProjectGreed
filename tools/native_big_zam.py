"""Big Zam's fourteen body emitters: one tactical volley, one native EN payment."""
import copy
ROOT_WEAPON = "ZN_MA_08_AA_BeamCannon"


def apply(prefab, native):
    if prefab["id"] not in ("MA_08", "MA_08_DZL"):
        return prefab
    from native_combat import native_weapon
    from mod_source import ROOT, load, section
    prefab["stats"]["fixedWeaponFacing"] = True
    keys = [key for key, weapon in prefab["weapons"].items()
            if weapon.get("source", {}).get("file", "").endswith("/" + ROOT_WEAPON + ".gw")]
    for key in keys:
        weapon = prefab["weapons"][key]
        native_weapon(prefab, weapon, native)
        source = load(ROOT / weapon["source"]["file"])
        # Source timing keeps all radial waves; a tactical attack fires each barrel once.
        seen, steps, elapsed, previous = set(), [], 0, 0
        for step in weapon["attack"]["steps"]:
            elapsed += step.get("delay", 0)
            if step.get("shots", 0):
                muzzle = step.get("muzzleIndex", 0)
                if muzzle in seen:
                    continue
                seen.add(muzzle)
                shot = copy.deepcopy(step)
                shot.update(shots=1, delay=round(elapsed - previous, 6))
                turret = section(source, "turret_" + weapon["source"]["barrels"][muzzle]["id"])
                shot["firingArc"] = {"idleDir": float(turret["idleDir"]), "arc": float(turret["canAttackMaxAngle"])}
                shot.pop("repeat", None)
                steps.append(shot)
                previous = elapsed
            elif not seen:
                pose = copy.deepcopy(step)
                pose["delay"] = round(elapsed - previous, 6)
                steps.append(pose)
                previous = elapsed
            if len(seen) == len(weapon["source"]["barrels"]):
                break
        if len(seen) != 14 or weapon["en"] != 180:
            raise ValueError("Unexpected Big Zam native radial volley: " + key)
        weapon["attack"]["steps"] = steps
        weapon["tacticalPattern"] = {"type": "radial_volley", "shotsPerBarrel": 1}
        weapon["name"] = "周身光束炮"
        weapon["localization"] = {
            "zh": {"name": "周身光束炮"},
            "en": {"name": "All-around Beam Cannons"},
            "ja": {"name": "全周囲ビーム砲"},
        }
        weapon.pop("availability", None)
    # The central direct-fire beam cannon shares the hull's fixed forward arc.
    central = prefab["weapons"].get("ZN_MA_08_BeamCannon")
    if central:
        source = load(ROOT / central["source"]["file"])
        for step in central["attack"]["steps"]:
            if not step.get("shots", 0):
                continue
            barrel = central["source"]["barrels"][step.get("muzzleIndex", 0)]["id"]
            turret = section(source, "turret_" + barrel)
            step["firingArc"] = {"idleDir": float(turret.get("idleDir", 0)), "arc": float(turret["canAttackMaxAngle"])}
    if not keys:
        raise ValueError("Missing Big Zam emitters")
    for kit in prefab["weaponKits"]:
        if ROOT_WEAPON not in kit["weapons"]:
            kit["weapons"].append(ROOT_WEAPON)
    prefab["mechanics"] = [item for item in prefab.get("mechanics", [])
                           if not item["id"].startswith("energy_capacity_" + ROOT_WEAPON)]
    # The root already contains the complete fourteen-emitter timeline. Exposing
    # aliases or composing it again would duplicate channels and split one EN bill.
    for key in keys:
        if key != ROOT_WEAPON:
            prefab["weapons"][key]["availability"] = {
                "hidden": True, "reasons": ["paired_weapon"], "mergedInto": ROOT_WEAPON,
            }
    groups = [group for group in prefab.get("pairedWeapons", []) if group["id"] not in keys]
    if groups:
        prefab["pairedWeapons"] = groups
    else:
        prefab.pop("pairedWeapons", None)
    return prefab
