"""ProjectGreed unit EN capacity policy; weapon EN consumption keeps its native value."""
import math

EN_CAPACITY_MULTIPLIER = 0.5
EN_CAPACITY_OVERRIDES = {"MS_06C": 350}


def capacity_for(unit_id, baseline):
    return EN_CAPACITY_OVERRIDES.get(unit_id, baseline * EN_CAPACITY_MULTIPLIER)


def apply_capacity_policy(prefab, native_capacity=None):
    source = prefab.setdefault("sourceStats", {})
    baseline = native_capacity if native_capacity is not None else source.get(
        "enBeforeReduction", prefab["stats"]["en"]
    )
    if not isinstance(baseline, (int, float)) or not math.isfinite(baseline) or baseline <= 0:
        raise ValueError("Invalid unit EN capacity: " + prefab["id"])
    source["enBeforeReduction"] = baseline
    source["enCapacityMultiplier"] = EN_CAPACITY_MULTIPLIER
    if prefab["id"] in EN_CAPACITY_OVERRIDES:
        source["enCapacityOverride"] = EN_CAPACITY_OVERRIDES[prefab["id"]]
    else:
        source.pop("enCapacityOverride", None)
    prefab["stats"]["en"] = capacity_for(prefab["id"], baseline)
    return prefab
