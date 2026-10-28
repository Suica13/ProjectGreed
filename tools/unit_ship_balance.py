"""User balance policy for Musai/Falmer; original MOD payloads remain untouched."""
import copy
import math

SHIPS = {"MusaiClass", "FalmerClass"}
FACTOR = 0.85

def apply_hull(prefab, native_hp):
    if prefab["id"] not in SHIPS:
        return
    native_hp = float(native_hp)
    prefab.setdefault("sourceStats", {})["shipHullBeforeReduction"] = native_hp
    prefab["sourceStats"]["shipBalanceMultiplier"] = FACTOR
    prefab["stats"]["hp"] = math.ceil(native_hp * FACTOR / 500) * 500

def apply_beams(prefab, native_restored=False):
    if prefab["id"] not in SHIPS:
        return
    for ident, weapon in prefab["weapons"].items():
        if weapon.get("type") != "beam" or "beamcannon" not in ident.lower():
            continue
        for payload in [weapon, *weapon.get("attack", {}).get("steps", [])]:
            if native_restored or "shipDamageBeforeReduction" not in payload:
                payload["shipDamageBeforeReduction"] = {key:copy.deepcopy(payload[key]) for key in ["damagePerShot","damageComponents"] if key in payload}
            baseline = payload["shipDamageBeforeReduction"]
            if "damageComponents" in baseline:
                payload["damageComponents"] = {key:math.ceil(value * FACTOR / 500) * 500 for key,value in baseline["damageComponents"].items()}
            if "damagePerShot" in baseline:
                payload["damagePerShot"] = sum(payload["damageComponents"].values()) if "damageComponents" in baseline else math.ceil(baseline["damagePerShot"] * FACTOR / 500) * 500
        weapon["shipDamageMultiplier"] = FACTOR


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


def apply_accuracy(prefab, native_restored=False):
    """Reduce all ship weapon base accuracy by 10%, without changing native shot accuracy."""
    if not prefab["stats"].get("ship"):
        return
    for weapon in prefab["weapons"].values():
        if native_restored or "shipHitBeforeReduction" not in weapon:
            weapon["shipHitBeforeReduction"] = weapon["hit"]
        weapon["hit"] = round(weapon["shipHitBeforeReduction"] * 0.9, 6)
        weapon["shipAccuracyMultiplier"] = 0.9
