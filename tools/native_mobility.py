"""Read native environment compatibility, preserving existing tactical ground/space balance."""
from mod_source import stat

def correct(prefab, native):
    from unit_action_mobility import apply as apply_action_mobility
    apply_action_mobility(prefab, native)
    from unit_energy import apply_capacity_policy
    apply_capacity_policy(prefab, stat(native, "enMax"))
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
    from native_sensors import correct as correct_sensors
    correct_sensors(prefab, native)
    from native_recon import correct as correct_recon
    correct_recon(prefab, native)
    from native_minovsky import correct as correct_minovsky
    correct_minovsky(prefab, native)
    from native_passives import correct as correct_passives
    correct_passives(prefab, native)
    return prefab
