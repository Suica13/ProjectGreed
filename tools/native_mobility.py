"""Read native environment compatibility, preserving existing tactical ground/space balance."""
from mod_source import stat

def correct(prefab, native):
    raw = {name: stat(native, source + "Adaptability", 0)
           for name, source in [("ground","ground"),("space","space"),("water","water"),("air","sky"),("mountain","cliff")]}
    raw["atmosphere"] = 0
    prefab.setdefault("sourceStats", {})["adaptability"] = raw
    current = prefab["stats"].setdefault("adaptability", {})
    for name in ["ground", "space"]:
        current.setdefault(name, raw[name])
    for name in ["water", "air", "atmosphere", "mountain"]:
        current[name] = raw[name]
    # Tactical terrain types absent from the native environment attributes.
    for name in ["forest", "snow", "desert", "rubble"]:
        current.setdefault(name, 75)
    return prefab
