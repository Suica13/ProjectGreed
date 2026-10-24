"""Attach the original boost loop; runtime uses plain JSON, named bones and a frame clock."""
import shutil
from mod_source import ASSETS, section, resolve, number, stat
from unit_visuals import BONE_NAMES


def configure_movement(prefab, data):
    presentation = prefab["presentation"]
    can_boost = "decal_Boost" in data and "OnMoving" in prefab["animations"] and stat(data, "boostMoveSpeed") > 0
    presentation.update(movement="boost" if can_boost else "walk", move="OnMoving" if can_boost else "OnMovingWalk", walk="OnMovingWalk")
    if not can_boost:
        return prefab
    decal = section(data, "decal_Boost")
    source = resolve(decal["image"])
    target = ASSETS / "units" / prefab["id"] / "textures" / source.name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    prefab["materials"]["textures"][source.name] = "textures/" + source.name
    bone = decal["basePositionFromLegEnd"]
    if bone not in prefab["skeleton"]:
        bone = BONE_NAMES.get(bone, bone)
    layer = dict(name="BoostLoop", texture=source.name, bone=bone,
        order=number(decal.get("order", 4.1)), frames=int(decal["total_frames"]), frameFps=4,
        offset=dict(x=number(decal.get("xOffsetRelative", 0)), y=number(decal.get("yOffsetRelative", 0))),
        scale=number(decal.get("imageScale", 1)), scaleY=number(decal.get("imageScaleY", 1)),
        rotation=number(decal.get("dirOffset", 0)), alpha=number(decal.get("alpha", 1)),
        visibleWhen=dict(moving=True, boosting=True))
    prefab["layers"] = sorted([l for l in prefab["layers"] if l["name"] != "BoostLoop"] + [layer], key=lambda l: l["order"])
    return prefab
