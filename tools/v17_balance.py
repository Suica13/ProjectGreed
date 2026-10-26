"""V17 tactical balance applied to current prefabs and future MOD refreshes."""
import copy
import math

TANKS = {"Type61", "Type61A5"}
SQUAD_WEAPON = "Squad_Combined_Weapons"


def combine_squad_weapons(prefab):
    if not prefab["id"].startswith("Army_Squad_") or len(prefab["weapons"]) <= 1:
        return
    weapons = list(prefab["weapons"].items())
    combined = copy.deepcopy(weapons[0][1])
    events = []
    mounts = []
    for index, (_, weapon) in enumerate(weapons):
        mounts.extend(copy.deepcopy(weapon["muzzle"]["mounts"]))
        elapsed = 0
        for step in weapon["attack"]["steps"]:
            for _ in range(step.get("repeat", 1)):
                elapsed += step["delay"]
                if step.get("shots", 0):
                    shot = copy.deepcopy(step)
                    shot.pop("repeat", None)
                    shot["muzzleIndex"] = index
                    shot["damageComponents"] = copy.deepcopy(
                        step.get("damageComponents", weapon["damageComponents"])
                    )
                    events.append((elapsed, index, shot))
    events.sort(key=lambda event: (event[0], event[1]))
    steps = []
    previous = 0
    for at, _, step in events:
        step["delay"] = round(at - previous, 6)
        previous = at
        steps.append(step)
    steps.append({"delay": 0.3})
    combined["name"] = "步兵班联合武装"
    combined["localization"] = {
        "zh": {"name": "步兵班联合武装"},
        "en": {"name": "Infantry Squad Weapons"},
        "ja": {"name": "歩兵分隊武装"},
    }
    combined["muzzle"]["mounts"] = mounts
    combined["muzzleEffects"] = [weapon.get("muzzleEffects", ["MG_Fire_1_S"])[0] for _, weapon in weapons]
    combined["attack"]["steps"] = steps
    combined["min"] = min(weapon["min"] for _, weapon in weapons)
    combined["max"] = max(weapon["max"] for _, weapon in weapons)
    combined["en"] = sum(weapon["en"] for _, weapon in weapons)
    combined["actionCost"] = 2
    combined["sourceWeapons"] = [key for key, _ in weapons]
    prefab["weapons"] = {SQUAD_WEAPON: combined}
    for kit in prefab["weaponKits"]:
        kit["weapons"] = [SQUAD_WEAPON]
        kit["cost"] = 0


def apply(prefab):
    stats = prefab["stats"]
    source = prefab.setdefault("sourceStats", {})
    base_hp = source.setdefault("v17BaseHp", stats["hp"])
    multiplier = 1.25 * (1.25 if prefab["id"] in TANKS else 1)
    stats["hp"] = math.ceil(base_hp * multiplier)
    if prefab["id"].startswith("Army_Squad_"):
        stats["cost"] = 0
        if "costBalance" in prefab:
            prefab["costBalance"]["published"] = 0
        combine_squad_weapons(prefab)
        prefab.pop("pairedWeapons", None)
        prefab["weapons"][SQUAD_WEAPON].pop("availability", None)
        combined = prefab["weapons"][SQUAD_WEAPON]
        if len(combined.get("muzzleEffects", [])) < len(combined["muzzle"]["mounts"]):
            combined["muzzleEffects"] = [
                "BZ_Fire_1_XS" if "_BZ_" in key else "MG_Fire_1_S"
                for key in combined["sourceWeapons"]
            ]
    for weapon in prefab["weapons"].values():
        if weapon.get("special", {}).get("type") != "bomb":
            continue
        target = 1.25 if prefab["id"] == "GawClass" else 1.5
        current = weapon.get("v17BombMultiplier", 1)
        if current == target:
            continue
        factor = target / current
        for payload in [weapon, *weapon.get("attack", {}).get("steps", [])]:
            if "damagePerShot" in payload:
                payload["damagePerShot"] *= factor
            if "damageComponents" in payload:
                payload["damageComponents"] = {
                    kind: damage * factor
                    for kind, damage in payload["damageComponents"].items()
                }
        if "damage" in weapon:
            weapon["damage"] *= factor
        weapon["v17BombMultiplier"] = target
    return prefab


if __name__ == "__main__":
    import json
    from pathlib import Path

    for path in Path("assets/units").glob("*/unit.json"):
        prefab = json.loads(path.read_text(encoding="utf-8"))
        apply(prefab)
        path.write_text(json.dumps(prefab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")