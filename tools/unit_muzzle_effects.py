"""Import native turret muzzle flashes without changing weapon balance or timing.
Run: python tools/unit_muzzle_effects.py
"""
import json
import shutil
from mod_source import ROOT, ASSETS, load, section, resolve, number


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def apply_muzzle_effects(prefab, data, effects=None):
    save_effects = effects is None
    if save_effects:
        effects = read(ASSETS / "effects/effects.json")
    for key, weapon in prefab["weapons"].items():
        if weapon["type"] == "melee":
            weapon.pop("muzzleEffects", None)
            continue
        native = key.replace("380mm", "360mm")
        barrels = weapon.get("source", {}).get("barrels", []) or [{"id": native}]
        names = []
        for barrel in barrels:
            turret_name = "turret_" + barrel["id"]
            native_data = data
            if turret_name not in native_data:
                # Light GM reuses the standard GM head vulcan added in this project.
                reference = weapon.get("source", {}).get("file", "Units/BattleUnits/Weapon/Shell/Common_DoubleVulcan_MS.gw")
                native_data = load(ROOT / reference)
            turret = section(native_data, turret_name)
            name = turret.get("shoot_flame", "").strip()
            if not name or "effect_" + name not in native_data:
                raise ValueError("Missing native muzzle flash: " + prefab["id"] + "/" + key)
            names.append(name)
            if name in effects:
                continue
            value = section(native_data, "effect_" + name)
            source = resolve(value["image"])
            target = ASSETS / "effects/textures" / source.name
            if target.exists() and target.read_bytes() != source.read_bytes():
                raise ValueError("Conflicting muzzle texture: " + source.name)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, target)
            effects[name] = dict(
                texture="textures/" + source.name,
                frames=int(number(value.get("total_frames", 1))),
                startFrame=int(number(value.get("animateFrameStart", 0))),
                endFrame=int(number(value.get("animateFrameEnd", 0))),
                fps=number(value.get("animateFrameSpeed", 1)) * 60,
                scaleFrom=number(value.get("scaleFrom", 1)),
                scaleTo=number(value.get("scaleTo", 1)),
                alpha=number(value.get("alpha", 1)), rotation=number(value.get("dirOffset", 0)),
                offset={"x": number(value.get("xOffsetRelative", 0)), "y": number(value.get("yOffsetRelative", 0))},
                drift=number(value.get("ySpeedRelative", 0)) * 60,
                attached=value.get("attachedToUnit", "false") == "true",
                sounds=[], source="MOD native turret shoot_flame: " + name)
        weapon["muzzleEffects"] = names
    if save_effects:
        write(ASSETS / "effects/effects.json", effects)
    return prefab


def main():
    effects = read(ASSETS / "effects/effects.json")
    prefabs = []
    for reference in read(ASSETS / "unit-catalog.json")["units"]:
        path = ASSETS / reference
        prefab = read(path)
        apply_muzzle_effects(prefab, load(ROOT.parent / prefab["source"]), effects)
        prefabs.append((path, prefab))
    for path, prefab in prefabs:
        write(path, prefab)
    write(ASSETS / "effects/effects.json", effects)
    print("Imported native muzzle flashes for all available units.")


if __name__ == "__main__":
    main()
