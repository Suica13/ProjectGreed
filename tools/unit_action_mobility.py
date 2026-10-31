"""Separate native turning/AP, boost/movement and reaction/evasion policies."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json
import math
from mod_source import ASSETS, MOD, load, stat


def action_points(turn_speed, ship=False):
    # Ships use a different native turning scale; keep their existing action budget.
    if ship:
        return 5
    if turn_speed <= 0:
        raise ValueError("Action turn speed must be positive")
    # Match JavaScript Math.round, including the negative logarithmic adjustment.
    return max(5, 5 + math.floor(2 * math.log2(turn_speed / 1.75) + 0.5))


def apply(prefab, native):
    stats = prefab["stats"]
    source = prefab.setdefault("sourceStats", {})
    turn = stat(native, "baseTurnSpeed", source.get("turnSpeed", 1.75))
    boost = stat(native, "boostMoveSpeed", source.get("boostSpeed", 1.4))
    from native_conversions import DEPLOYMENTS
    parent = next((base for base, form in DEPLOYMENTS.items() if form == prefab["id"]), None)
    deployed = bool(parent or stats.get("deployed"))
    if deployed:
        parent = parent or prefab.get("formOf")
        if not parent:
            raise ValueError("Missing deployment parent: " + prefab["id"])
        original = load_source_json((ASSETS / "units" / parent / "unit.json").read_text(encoding="utf-8"))
        reference = original["source"].split("/", 1)
        root = MOD / reference[0]
        base_native = load(root / reference[1], root=root)
        turn = stat(base_native, "baseTurnSpeed", original["sourceStats"]["turnSpeed"])
        boost = stat(base_native, "boostMoveSpeed", original["sourceStats"]["boostSpeed"])
    stats["speed"] = max(0, 5 * math.floor((100 * boost / 1.4) / 5 + 0.5))
    stats["actionPoints"] = action_points(turn, stats.get("ship", False))
    source["actionTurnSpeed"] = turn
    # Preserve the existing tactical distance: speed now describes that distance,
    # rather than granting a second bonus on top of the imported boost distance.
    if "tacticalMoveBeforeBonus" in source:
        distance = source["tacticalMoveBeforeBonus"] + (3 if stats.get("ship") else 1)
    else:
        distance = source.setdefault("movementBeforeMobility", stats["move"])
    source["mobilityMoveTarget"] = 0 if deployed else distance
    stats["move"] = 0 if deployed else distance - math.trunc((stats["speed"] - 100) / 50)
    return prefab


def refresh():
    paths = sorted((ASSETS / "units").glob("*/unit.json"))
    pending = []
    for path in paths:
        prefab = load_source_json(path.read_text(encoding="utf-8"))
        reference = prefab["source"].split("/", 1)
        root = MOD / reference[0]
        apply(prefab, load(root / reference[1], root=root))
        pending.append((path, dump_source_json(prefab, ensure_ascii=False, indent=2) + "\n"))
    for path, text in pending:
        path.write_text(text, encoding="utf-8", newline="\n")
    print(f"Updated only movement/AP policy for {len(pending)} units.")


if __name__ == "__main__":
    refresh()
