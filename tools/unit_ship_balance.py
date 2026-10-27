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
