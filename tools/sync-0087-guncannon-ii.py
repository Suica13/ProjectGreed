"""Refresh RX_77D_4 native hull/attributes without rebuilding its loadout or art."""
import json
import os

os.environ["PROJECTGREED_MOD_DLC"] = "GW_BattleUniverse_DLC_0087"

from mod_source import ASSETS, load, source_path, stat
from unit_action_mobility import apply as apply_mobility
from v17_balance import rounded_hp
from weapon_store import loads, dumps


def synchronize(prefab, native):
    if prefab["id"] != "RX_77D_4":
        raise ValueError("This refresh only supports RX_77D_4")
    source = prefab["sourceStats"]
    source.update(
        hp=float(native["core"]["maxHp"]),
        v17BaseHp=float(native["core"]["maxHp"]),
        walkSpeed=stat(native, "baseMoveSpeed"),
        boostSpeed=stat(native, "boostMoveSpeed"),
        turnSpeed=stat(native, "baseTurnSpeed"),
        shooting=stat(native, "baseShootLevel"),
        accuracy=stat(native, "baseAccuracyLevel"),
    )
    # Existing tactical HP policy precedes runtime conversions/manual adjustments.
    prefab["stats"]["hp"] = rounded_hp(source["hp"] * 1.25)
    prefab["stats"]["accuracy"] = source["accuracy"]
    prefab["attackBonuses"]["shooting"] = source["shooting"] - 100
    apply_mobility(prefab, native)
    return prefab


if __name__ == "__main__":
    file = ASSETS / "units/RX_77D_4/unit.json"
    prefab = loads(file.read_text(encoding="utf-8"))
    synchronize(prefab, load(source_path(prefab["source"])))
    file.write_text(dumps(prefab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"id": prefab["id"], "stats": prefab["stats"],
                      "attackBonuses": prefab["attackBonuses"]}))
