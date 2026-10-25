"""补齐旧预制体漏导的迫击炮，并刷新全部单位的武器政策。"""
import copy
import importlib.util
from pathlib import Path
from mod_source import ROOT, ASSETS, load
from weapon_policy import configure


def add_legacy_mortars(importer, effects):
    for unit_id in ["RGC_80", "MS_06K"]:
        path = ASSETS / f"units/{unit_id}/unit.json"
        prefab = importer.read(path)
        source = ROOT / prefab["source"].split("/", 1)[1]
        for weapon_file in importer.graph(source):
            if "/Weapon/" not in weapon_file.as_posix() or weapon_file.suffix != ".gw":
                continue
            native = load(weapon_file)
            if not any("Mortar" in key for key in native if key.startswith("turret_")):
                continue
            for key, weapon in importer.weapon(prefab, weapon_file, effects):
                if "Mortar" not in key or key in prefab["weapons"]:
                    continue
                cannon = next((w for k, w in prefab["weapons"].items() if "Cannon" in k), None)
                if cannon:
                    weapon["requiredParts"] = copy.deepcopy(cannon.get("requiredParts", []))
                    weapon["muzzle"] = copy.deepcopy(cannon["muzzle"])
                    weapon["changeHeldWeapon"] = False
                prefab["weapons"][key] = weapon
                for kit in prefab["weaponKits"]:
                    kit["weapons"].append(key)
                print("Mortar added:", unit_id, key)
        importer.write(path, prefab)


def refresh():
    spec = importlib.util.spec_from_file_location("bulk", Path(__file__).with_name("import-0079-page-one.py"))
    importer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(importer)
    effects = importer.read(ASSETS / "effects/effects.json")
    from sniper_presentation import attach
    attach(effects)
    add_legacy_mortars(importer, effects)
    for path in (ASSETS / "units").glob("*/unit.json"):
        prefab = importer.read(path)
        native = load(ROOT / prefab["source"].split("/", 1)[1])
        configure(prefab, native)
        importer.write(path, prefab)
    importer.write(ASSETS / "effects/effects.json", effects)


if __name__ == "__main__":
    refresh()
