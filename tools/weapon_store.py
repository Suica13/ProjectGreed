"""Python source codec matching weapon-store.cjs. Importers work with expanded objects."""
import copy
import json
from pathlib import Path

LIBRARY = Path(__file__).resolve().parents[1] / "assets/weapons.json"
LOCAL_FIELDS = {"source", "muzzle", "chargeMuzzle", "requiredParts", "anyParts", "availability", "moduleId", "moduleIndex"}
_cache = None
_stamp = None


def library():
    global _cache, _stamp
    stat = LIBRARY.stat()
    stamp = (stat.st_mtime_ns, stat.st_size)
    if stamp != _stamp:
        _cache = json.loads(LIBRARY.read_text(encoding="utf-8"))
        if _cache.get("schemaVersion") != 1:
            raise ValueError("Invalid weapon library")
        _stamp = stamp
    return _cache["definitions"]


def expand_prefab(value):
    if not isinstance(value, dict) or not value.get("id") or "weapons" not in value:
        return value
    result = copy.deepcopy(value)
    definitions = library()
    def expand(entry):
        if "ref" not in entry:
            return entry
        if entry["ref"] not in definitions:
            raise ValueError("Unknown weapon reference: " + entry["ref"])
        weapon = copy.deepcopy(definitions[entry["ref"]])
        for field in entry.get("remove", []):
            weapon.pop(field, None)
        weapon.update(entry.get("overrides", {}))
        return weapon
    result["weapons"] = {key: expand(entry) for key, entry in result["weapons"].items()}
    if "skills" in result:
        result["skills"] = [expand(skill) for skill in result["skills"]]
    return result


def pack_prefab(value):
    if not isinstance(value, dict) or not value.get("id") or "weapons" not in value:
        return value
    result = copy.deepcopy(value)
    definitions = library()
    changed = False
    def pack(key, weapon):
        nonlocal changed
        if "ref" in weapon:
            return copy.deepcopy(weapon)
        family = weapon["sourceWeapon"] + "__skill_" + weapon["type"] if weapon.get("sourceWeapon") else weapon.get("sourceName", key)
        ref = family + "__lv" + str(weapon.get("level", 1))
        if ref not in definitions:
            definitions[ref] = {k: v for k, v in weapon.items() if k not in LOCAL_FIELDS}
            changed = True
        base = definitions[ref]
        entry = {"ref": ref}
        overrides = {k: v for k, v in weapon.items() if k not in base or v != base[k]}
        removed = [k for k in base if k not in weapon]
        if overrides:
            entry["overrides"] = overrides
        if removed:
            entry["remove"] = removed
        return entry
    result["weapons"] = {key: pack(key, weapon) for key, weapon in value["weapons"].items()}
    if "skills" in value:
        result["skills"] = [pack(skill.get("id"), skill) if skill.get("sourceWeapon") or "ref" in skill else copy.deepcopy(skill) for skill in value["skills"]]
    if changed:
        temporary = LIBRARY.with_suffix(".json.tmp")
        temporary.write_text(json.dumps({"schemaVersion": 1, "definitions": definitions}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        temporary.replace(LIBRARY)
    return result


def loads(text, *args, **kwargs):
    return expand_prefab(json.loads(text, *args, **kwargs))


def dumps(value, *args, **kwargs):
    return json.dumps(pack_prefab(value), *args, **kwargs)
