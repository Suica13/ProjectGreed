"""Record weapon grades from the unit copyFrom chain, not its base animation file."""
import functools
import json
import re
from pathlib import Path
from mod_source import ASSETS, MOD, load, parse, resolve, section


def file_level(path):
    match = re.search(r"(?:^|_)Lv(\d+)(?:_|$)", path.stem, re.I)
    return int(match[1]) if match else 1


@functools.lru_cache(None)
def section_levels(path, root):
    own = parse(path)
    result = {}
    for reference in own.get("core", {}).get("copyFrom", "").split(","):
        if reference.strip():
            result.update(section_levels(resolve(reference, path.parent, root), root))
    level = file_level(path)
    for key in own:
        if key.startswith(("turret_", "projectile_")):
            if level > 1 or key not in result:
                result[key] = (level, path.relative_to(root).as_posix())
    return result


def apply(prefab):
    package, reference = prefab["source"].split("/", 1)
    root = MOD / package
    path = root / reference
    native = load(path, root=root)
    levels = section_levels(path, root)
    for key, weapon in prefab["weapons"].items():
        source = weapon.get("source", {})
        fallback = source.get("file", "")
        candidates = [(file_level(Path(fallback)), fallback)]
        for barrel in source.get("barrels", []):
            turret = "turret_" + barrel["id"]
            if turret in levels:
                candidates.append(levels[turret])
            if turret in native:
                projectile = "projectile_" + section(native, turret).get("projectile", "")
                if projectile in levels:
                    candidates.append(levels[projectile])
        level, source_file = max(candidates, key=lambda value: value[0])
        weapon["level"] = level
        weapon["levelSource"] = source_file
    for skill in prefab.get("skills", []):
        weapon = prefab["weapons"].get(skill.get("sourceWeapon"))
        if weapon:
            skill["level"] = weapon["level"]
            skill["levelSource"] = weapon["levelSource"]
    return prefab


if __name__ == "__main__":
    count = 0
    for path in sorted((ASSETS / "units").glob("*/unit.json")):
        prefab = apply(json.loads(path.read_text(encoding="utf-8")))
        path.write_text(json.dumps(prefab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        count += 1
    print(f"Recorded native weapon levels for {count} units.")
