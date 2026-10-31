"""Project conversion: sight = round(native sight * 0.4); standard radar = project sight * 1.25."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import re
import math

# Native standard radar is native sight * 18. Preserve scout and anti-detection ratios.
RADAR_WORLD_UNITS_PER_TILE = 36
ANTI_DETECTION_WORLD_UNITS_PER_TILE = 28.8
from mod_source import section

def correct(prefab, native):
    values = {}
    # InitializeStats overrides framework defaults; do not read the first regex match.
    for name in ["hiddenAction_Start_SetStats", "hiddenAction_InitializeStats"]:
        if name in native:
            values.update(re.findall(r"(base\w+)\s*=\s*([^,]+)", section(native, name).get("setUnitMemory", "")))
    def value(name, default=0, stack=()):
        if name in stack: raise ValueError("Cyclic sensor value: " + name)
        expr = values.get(name)
        if expr is None: return default
        expr = re.sub(r"memory\.(base\w+)", lambda m: str(value(m[1], 0, (*stack, name))), expr.strip())
        if not re.fullmatch(r"[0-9. +*/()\-]+", expr):
            raise ValueError("Unsupported sensor expression: " + prefab["id"] + " " + expr)
        return float(eval(expr, {"__builtins__": {}}, {}))
    raw = {"sight": value("baseFogOfWarSightRange", 20), "radar": value("baseDetectRange", 360), "antiDetection": value("baseAntiDetectRange")}
    prefab.setdefault("sourceStats", {})["sensors"] = raw
    prefab["stats"]["sensors"] = {**prefab["stats"].get("sensors", {}), "sight": math.floor(raw["sight"] * 2 / 5 + 0.5), "radar": raw["radar"] / RADAR_WORLD_UNITS_PER_TILE, "antiDetection": raw["antiDetection"] / ANTI_DETECTION_WORLD_UNITS_PER_TILE, "revealOnDetection": bool(prefab["stats"].get("ship"))}
    return prefab

if __name__ == "__main__":
    import json
    from mod_source import ASSETS, MOD, load
    count = 0
    for path in sorted((ASSETS / "units").glob("*/unit.json")):
        data = load_source_json(path.read_text(encoding="utf-8-sig"))
        source = MOD / data["source"]
        correct(data, load(source))
        path.write_text(dump_source_json(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        count += 1
    print("Updated sensor status for", count, "units")
