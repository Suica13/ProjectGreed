"""Unified ship policy relative to native MOD hull, accuracy and payloads."""
import copy
import math
import re

HULL_FACTOR = 0.7
DAMAGE_FACTOR = 0.75
ACCURACY_FACTOR = 0.65


def federation_ship(prefab):
    return "EFSF" in prefab.get("tags", [])


def apply_hull(prefab, native_hp):
    if not prefab["stats"].get("ship"):
        return
    native_hp = float(native_hp)
    source = prefab.setdefault("sourceStats", {})
    source.update(hp=native_hp, shipHullBeforeReduction=native_hp,
                  shipBalanceMultiplier=HULL_FACTOR)
    source.pop("v17BaseHp", None)
    faction_factor = 1.1 if federation_ship(prefab) else 1
    source["shipFactionHullMultiplier"] = faction_factor
    prefab["stats"]["hp"] = max(500, math.floor(native_hp * HULL_FACTOR * faction_factor / 500 + .5) * 500)


def apply_damage(prefab):
    """All ship payloads use one reduction from native data, never a reduced value."""
    if not prefab["stats"].get("ship"):
        return
    for weapon in prefab["weapons"].values():
        for payload in [weapon, *weapon.get("attack", {}).get("steps", [])]:
            baseline = payload.setdefault("shipDamageBeforeReduction", {
                key: copy.deepcopy(payload[key])
                for key in ("damagePerShot", "damageComponents") if key in payload
            })
            if "damageComponents" in baseline:
                payload["damageComponents"] = {
                    key: math.floor(value * DAMAGE_FACTOR / 25 + .5) * 25
                    for key, value in baseline["damageComponents"].items()
                }
            if "damagePerShot" in baseline:
                payload["damagePerShot"] = (sum(payload["damageComponents"].values())
                    if "damageComponents" in baseline else
                    math.floor(baseline["damagePerShot"] * DAMAGE_FACTOR / 25 + .5) * 25)
        weapon["shipDamageMultiplier"] = DAMAGE_FACTOR


def apply_anti_air(prefab):
    """Two AP and half the firing events per mount; retain native timing as evidence."""
    if not prefab["stats"].get("ship"):
        return
    for weapon in prefab["weapons"].values():
        if weapon.get("rangeRole") != "ship_anti_air":
            continue
        attack = weapon["attack"]
        baseline = weapon.setdefault("shipAntiAirBeforeReduction", copy.deepcopy(attack["steps"]))
        totals = {}
        for step in baseline:
            mount = step.get("muzzleIndex", 0)
            totals[mount] = totals.get(mount, 0) + step.get("shots", 0) * step.get("repeat", 1)
        remaining = {mount: math.ceil(count / 2) for mount, count in totals.items()}
        steps = []
        for source in baseline:
            for _ in range(source.get("repeat", 1)):
                step = copy.deepcopy(source)
                step.pop("repeat", None)
                mount = step.get("muzzleIndex", 0)
                if step.get("shots", 0):
                    step["shots"] = min(step["shots"], remaining[mount])
                    remaining[mount] -= step["shots"]
                steps.append(step)
        attack["steps"] = steps
        weapon["actionCost"] = 2


def explosive_cannon(weapon):
    payload = weapon.get("nativePayload", {})
    return weapon.get("category") in {"cannon", "mortar"} and any(
        payload.get(field, 0) > 0
        for field in ("ProjectileExplosionRange", "ProjectileBlastRange")
    )


def apply_accuracy(prefab, native_restored=False):
    """Apply native unit and explosive-cannon accuracy factors exactly once."""
    if not prefab["stats"].get("ship"):
        return
    source = prefab["sourceStats"]
    federation = federation_ship(prefab)
    source["shipFactionAccuracyMultiplier"] = 1.1 if federation else 1
    source["shipFactionEvasionMultiplier"] = 1.15 if federation else 1
    prefab["stats"]["accuracy"] = round(source["accuracy"] * ACCURACY_FACTOR * source["shipFactionAccuracyMultiplier"], 6)
    if "reaction" in source:
        prefab["stats"]["mobility"] = round(source["reaction"] * source["shipFactionEvasionMultiplier"], 6)
    prefab["stats"]["accuracyMultiplier"] = ACCURACY_FACTOR
    for ident, weapon in prefab["weapons"].items():
        baseline = weapon.get("sourceHit", weapon.get("shipHitBeforeReduction", weapon["hit"]))
        factor = 0.8 if explosive_cannon(weapon) else 1
        weapon["hit"] = round(baseline * factor, 6)
        if factor != 1:
            weapon["shipExplosiveAccuracyMultiplier"] = factor
        else:
            weapon.pop("shipExplosiveAccuracyMultiplier", None)
        weapon.pop("shipHitBeforeReduction", None)
        weapon.pop("shipAccuracyMultiplier", None)

        anti_air = weapon.get("rangeRole") == "ship_anti_air" or re.search(r"Turret_?AA(?:_|$)", ident)
        anti_ms = re.search(r"(?:^|_)AMS(?:_|$)", ident)
        if not anti_air and not anti_ms:
            medium = weapon.setdefault("antiSize", {}).setdefault("medium", {"damage": 1})
            medium["accuracy"] = 0.75
