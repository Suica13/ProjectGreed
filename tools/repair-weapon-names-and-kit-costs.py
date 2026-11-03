"""Repair confirmed names and kit COSTs without reimporting assets or native payloads."""
import copy
import json
import re
from pathlib import Path
from mod_source import ASSETS
from native_weapon_names import label
from weapon_store import loads, dumps


def confirmed(key, weapon):
    source = weapon.get("sourceName", key)
    return source == "EF_GMRifle" or bool(re.search(r"\d+mmMG|BeamRifle|(?:^|_)[SHL]?BR(?:_|$)", source, re.I)) and not bool(re.search(r"(?:Arm|Double|Hand)_?BR", source))


def names(weapon, value):
    weapon["name"] = value[0]
    for language, name in zip(("zh", "en", "ja"), value):
        weapon.setdefault("localization", {}).setdefault(language, {})["name"] = name


def main():
    library = ASSETS / "weapons.json"
    data = json.loads(library.read_text(encoding="utf-8"))
    updated_definitions = []
    for key, weapon in data["definitions"].items():
        if not confirmed(key, weapon):
            continue
        value = label(key, weapon)
        if not value:
            continue
        before = copy.deepcopy(weapon)
        names(weapon, value)
        if weapon.get("sourceName") == "EF_GMRifle":
            weapon["category"] = "machine_gun"
        elif weapon.get("type") == "beam" and re.search(r"BeamRifle|(?:^|_)[SHL]?BR(?:_|$)", weapon.get("sourceName", key), re.I):
            weapon["category"] = "beam_rifle"
        if weapon != before:
            updated_definitions.append(key)
    if updated_definitions:
        library.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    registry = json.loads((ASSETS / "unit-catalog.json").read_text(encoding="utf-8"))
    changed = []
    renamed = []
    repriced = []
    for ref in registry["units"]:
        path = ASSETS / ref
        original_text = path.read_text(encoding="utf-8")
        prefab = loads(original_text)
        for key, weapon in prefab["weapons"].items():
            if not confirmed(key, weapon):
                continue
            value = label(key, weapon)
            if value:
                names(weapon, value)
            if weapon.get("sourceName") == "EF_GMRifle":
                weapon["category"] = "machine_gun"
            elif weapon.get("type") == "beam" and re.search(r"BeamRifle|(?:^|_)[SHL]?BR(?:_|$)", weapon.get("sourceName", key), re.I):
                weapon["category"] = "beam_rifle"
        for kit in prefab["weaponKits"]:
            weapon = prefab["weapons"].get((kit.get("weapons") or [None])[0])
            if not weapon:
                continue
            source = weapon.get("sourceName", "")
            protected = kit.get("name") == "复合发射器套件"
            if confirmed(source, weapon) and not protected and len(prefab["weaponKits"]) > 1:
                value = label(source, weapon)
                if value and (kit["id"].startswith(("kit_", "main_")) or kit["name"] in
                        {"光束步枪套件", "光束炮套件", "机枪套件", value[0] + "套件"}):
                    old = copy.deepcopy(kit)
                    names(kit, tuple(n + s for n, s in zip(value, ("套件", " Kit", "装備"))))
                    if kit != old:
                        renamed.append([prefab["id"], kit["id"], kit["name"]])
            old_cost = kit["cost"]
            if old_cost == 100 and not protected:
                if source == "EF_GMRifle":
                    kit["cost"] = 0
                elif (weapon.get("type") == "beam" and weapon.get("category") == "beam_rifle") or weapon.get("category") == "cannon" or (weapon.get("type") == "beam" and re.search(r"BeamRifle|(?:^|_)[SHL]?BR(?:_|$)", source, re.I)) or "Cannon" in source or kit["id"] in {"beam_rifle", "cannon", "magella_cannon"}:
                    kit["cost"] = 75
                elif len(prefab["weaponKits"]) == 1 and any("Cannon" in key for key in kit["weapons"]):
                    kit["cost"] = 75
            if old_cost != kit["cost"]:
                repriced.append([prefab["id"], kit["id"], old_cost, kit["cost"]])
        output = dumps(prefab, ensure_ascii=False, indent=2) + "\n"
        if json.loads(output) != json.loads(original_text):
            path.write_text(output, encoding="utf-8")
            changed.append(prefab["id"])
    result = {"definitions": updated_definitions, "units": changed, "renamedKits": renamed, "repricedKits": repriced}
    output = ASSETS.parent / "tmp/weapon-kit-repair-result.json"
    output.parent.mkdir(exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    print(f"Definitions: {len(updated_definitions)}; units: {len(changed)}; kits renamed: {len(renamed)}; kits repriced: {len(repriced)}")


if __name__ == "__main__":
    main()
