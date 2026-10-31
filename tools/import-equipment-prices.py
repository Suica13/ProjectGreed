"""Archive actual MOD equipment-change fees; sources remain read-only."""
import json
import re
from mod_source import ASSETS, MOD, section, number
from native_refits import definitions
from native_weapon_layout import conditions
from weapon_store import loads


def collect(catalog):
    result = {}
    registry = json.loads((ASSETS / "unit-catalog.json").read_text(encoding="utf-8"))
    for reference in registry["units"]:
        prefab = loads((ASSETS / reference).read_text(encoding="utf-8"))
        if len(prefab["weaponKits"]) < 2:
            continue
        data = definitions(MOD / prefab["source"])
        actions = {}
        for key in data:
            if not key.startswith("action_Set_Equipment"):
                continue
            action = section(data, key)
            match = re.search(r"\b(EquipmentIndex\d*)\s*=\s*(\d+)", action.get("setResourcesWithLogic", ""))
            if not match:
                continue
            try:
                money = number(action["define.Money"])
                supplies = number(action["define.Resource"])
            except (KeyError, ValueError):
                continue
            if money < 0 or supplies < 0:
                raise ValueError("Negative native equipment cost: " + prefab["id"] + "/" + key)
            target = (match[1], int(match[2]))
            value = {"money": money, "supplies": supplies, "source": {"file": prefab["source"], "action": key, "seconds": number(action.get("buildSpeed", 0))}}
            if target in actions and (actions[target]["money"], actions[target]["supplies"]) != (money, supplies):
                raise ValueError("Ambiguous equipment action: " + prefab["id"] + "/" + str(target))
            actions[target] = value
        for kit in prefab["weaponKits"]:
            required = {}
            for weapon_id in kit["weapons"]:
                for condition in conditions(data, prefab["weapons"][weapon_id]):
                    for variable, index in re.findall(r"\b(EquipmentIndex\d*)\s*==\s*(\d+)", condition):
                        required.setdefault(variable, set()).add(int(index))
            native = catalog.get("nativePricing", {}).get(prefab["id"], {}).get("kits", {}).get(kit["id"], {})
            if "equipmentIndex" in native:
                required["EquipmentIndex"] = {native["equipmentIndex"]}
            for output in native.get("source", {}).get("outputs", []):
                for variable, index in re.findall(r"\b(EquipmentIndex\d*):(\d+)", output.get("resources", "")):
                    required[variable] = {int(index)}
            # Some units retain an unused EquipmentIndex2 counter, with no switch action.
            # Such fixed equipment is not another billable purchase.
            variables = {variable for variable, _ in actions}
            required = {variable: indices for variable, indices in required.items() if variable in variables}
            if not required or any(len(indices) != 1 for indices in required.values()):
                continue
            parts = [actions.get((variable, next(iter(indices)))) for variable, indices in sorted(required.items())]
            if not all(parts):
                continue
            result[prefab["id"] + "__" + kit["id"]] = {
                "money": sum(part["money"] for part in parts),
                "supplies": sum(part["supplies"] for part in parts),
                "sources": [part["source"] for part in parts],
            }
    return result


if __name__ == "__main__":
    file = ASSETS.parent / "shared/production-catalog.json"
    catalog = json.loads(file.read_text(encoding="utf-8"))
    catalog["nativeEquipmentCosts"] = collect(catalog)
    file.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Archived native equipment-change prices:", len(catalog["nativeEquipmentCosts"]))
    for unit in ("RGM_79", "RX_78_2", "RFF_06"):
        print(unit, {key: value for key, value in catalog["nativeEquipmentCosts"].items() if key.startswith(unit + "__")})
