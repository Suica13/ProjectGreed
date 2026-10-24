"""Semantic names for imported skeletons, animation curves and visual attachments.
Only the MOD reader uses legacy arm/leg numbers; runtime JSON uses part names.
"""
import copy
import json
from pathlib import Path

BONE_NAMES = {
    "arm1": "Pelvis", "arm2": "Body",
    "arm3": "LeftArm", "arm4": "RightArm",
    "arm5": "LeftShoulder", "arm6": "RightShoulder",
    "arm10": "LeftWeapon", "arm11": "RightWeapon",
    "arm19": "Head", "arm20": "Eye",
    "leg17": "LeftFoot", "leg18": "LeftLeg",
    "leg19": "RightFoot", "leg20": "RightLeg",
}
# Empty reserve joints have no layers/muzzles in any current prefab.
UNUSED_BONES = {"arm12", "arm13", "arm15"}

def rename_bones(value):
    if isinstance(value, dict):
        return {BONE_NAMES.get(key, key): rename_bones(item)
                for key, item in value.items() if key not in UNUSED_BONES}
    if isinstance(value, list):
        return [rename_bones(item) for item in value]
    if isinstance(value, str):
        return BONE_NAMES.get(value, value)
    return value

def normalize_visuals(prefab, base):
    prefab = rename_bones(copy.deepcopy(prefab))
    for reference in prefab["animations"].values():
        path = (Path(base) / reference).resolve()
        old = json.loads(path.read_text(encoding="utf-8"))
        new = rename_bones(old)
        if new != old:
            path.write_text(json.dumps(new, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    prefab.setdefault("tags", ["EFSF" if prefab["id"].startswith("R") else "ZEON"])
    if "0079" not in prefab["tags"]: prefab["tags"].append("0079")
    return prefab
