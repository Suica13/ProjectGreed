"""Read-only audit against MOD inheritance and native firing payloads."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import copy
import json
import math
from mod_source import ASSETS, MOD, load, stat
from native_combat import restore
from weapon_policy import configure
from unit_ship_balance import explosive_cannon, federation_ship

ships = weapons = 0
for path in sorted((ASSETS / "units").glob("*/unit.json")):
    prefab = load_source_json(path.read_text(encoding="utf8"))
    if not prefab["stats"].get("ship"):
        continue
    root_name, reference = prefab["source"].split("/", 1)
    root = MOD / root_name
    native = load(root / reference, root=root)
    raw = restore(copy.deepcopy(prefab), native)
    federation = federation_ship(prefab)
    assert prefab["stats"]["hp"] == max(500, math.floor(float(native["core"]["maxHp"]) * .7 * (1.1 if federation else 1) / 500 + .5) * 500), prefab["id"]
    assert prefab["stats"]["mobility"] == round(stat(native, "baseReactionLevel", 100) * (1.15 if federation else 1), 6), prefab["id"]
    assert prefab["stats"]["accuracy"] == round(stat(native, "baseAccuracyLevel", 100) * .65 * (1.1 if federation else 1), 6), prefab["id"]
    assert "v17BaseHp" not in prefab["sourceStats"], prefab["id"]
    for key, weapon in prefab["weapons"].items():
        original = raw["weapons"][key]
        assert weapon["hit"] == round(original["hit"] * (.8 if explosive_cannon(original) else 1), 6), (prefab["id"], key)
        assert "shipAccuracyMultiplier" not in weapon
        assert "tacticalDamageMultiplier" not in weapon
        assert weapon["shipDamageBeforeReduction"]["damageComponents"] == original["damageComponents"], (prefab["id"], key)
        for channel, value in original["damageComponents"].items():
            assert weapon["damageComponents"][channel] == math.floor(value * .75 / 25 + .5) * 25, (prefab["id"], key, channel)
        for step in weapon["attack"]["steps"]:
            for channel, value in step["shipDamageBeforeReduction"].get("damageComponents", {}).items():
                assert step["damageComponents"][channel] == math.floor(value * .75 / 25 + .5) * 25
        weapons += 1
    first = configure(copy.deepcopy(prefab), native)
    second = configure(copy.deepcopy(first), native)
    assert first == second, (prefab["id"], "refresh must be idempotent")
    assert prefab == first, (prefab["id"], "generated data must match policy")
    ships += 1
print(dump_source_json({"ships": ships, "weapons": weapons, "nativeAudit": "passed"}))
