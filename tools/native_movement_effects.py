"""Native hover loops and EXAM/HADES system visuals, shared by all import paths."""
import shutil
from mod_source import ASSETS, ROOT, resolve, section
from unit_visuals import BONE_NAMES


def correct_effects(prefab, native):
    # Rotorcraft fly with rotors, not the inherited generic aircraft jet decal.
    helicopter = any("heli" in tag.lower() for tag in prefab.get("sourceStats", {}).get("nativeTags", []))
    if helicopter:
        prefab["presentation"]["thrusters"] = False
        hull_order = max((layer.get("order", 0) for layer in prefab["layers"] if not layer.get("rotationSpeed")), default=5)
        for layer in prefab["layers"]:
            if layer.get("rotationSpeed"):
                layer["order"] = max(layer.get("order", 0), hull_order + 1)
        prefab["layers"].sort(key=lambda layer: layer.get("order", 0))
    thrusters = prefab["presentation"].get("thrusters", True)
    if not thrusters:
        prefab["layers"] = [layer for layer in prefab["layers"]
            if "boost" not in layer["name"].lower()
            and not layer.get("visibleWhen", {}).get("thrustActive")
            and not layer.get("visibleWhen", {}).get("sustainedThrust")]
    for key in native:
        if key != "decal_Hover" and not key.startswith("decal_System_Red_"):
            continue
        source = section(native, key)
        name = key[6:]
        if not source.get("image", "").startswith("ROOT:"):
            continue
        image = resolve(source["image"])
        dest = ASSETS / "units" / prefab["id"] / "textures" / image.name
        dest.parent.mkdir(parents=True, exist_ok=True)
        if not dest.exists():
            shutil.copyfile(image, dest)
        prefab["materials"]["textures"][image.name] = "textures/" + image.name
        layer = next((l for l in prefab["layers"] if l["name"] == name), None)
        if layer is None:
            joint = source.get("basePositionFromLegEnd")
            bone = BONE_NAMES.get(joint, joint)
            if bone not in prefab["skeleton"]:
                # Unattached native system decals are centred on the whole unit.
                bone = "SystemOrigin" if name.startswith("System_") else "Pelvis" if "Pelvis" in prefab["skeleton"] else "Body"
            if bone == "SystemOrigin":
                prefab["skeleton"][bone] = {"x": 0, "y": 0}
            layer = {"name": name, "bone": bone}
            prefab["layers"].append(layer)
        layer.update(texture=image.name, order=float(source.get("order", 0)),
                     scale=float(source.get("imageScale", 1)),
                     offset={"x": float(source.get("xOffsetRelative", 0)), "y": float(source.get("yOffsetRelative", 0))},
                     alpha=float(source.get("alpha", 1)), frames=int(source.get("total_frames", 1)),
                     frame=0, frameFps=10)
        if name == "Hover":
            layer["visibleWhen"] = {"moving": True, "onLand": True}
            for mechanic in prefab.get("mechanics", []):
                if mechanic["id"] in ["Hover", "HoverEffect"]:
                    mechanic.update(status="implemented", name="气垫：仅在地面移动时循环")
        else:
            layer.pop("visibleWhen", None)
            layer["independentClock"] = True
    # Hover movement and its looping visual are one unit mechanic in ProjectGreed.
    # HoverEffect/Lv2/Lv3 only vary the native real-time acceleration or animation cadence.
    hover_ids = {"Hover", "HoverEffect", "Hover_Lv2", "Hover_Lv3"}
    hover = prefab["stats"].get("movementType") == "hover" or "decal_Hover" in native or any(
        mechanic.get("id") in hover_ids for mechanic in prefab.get("mechanics", [])
    )
    if hover:
        mechanics = prefab.setdefault("mechanics", [])
        mechanics[:] = [mechanic for mechanic in mechanics if mechanic.get("id") not in hover_ids]
        movement = next((mechanic for mechanic in mechanics if mechanic.get("id") == "movement"), None)
        if movement is None:
            movement = {"id": "movement", "status": "implemented"}
            mechanics.insert(0, movement)
        movement.update(
            status="implemented",
            name="气垫移动：可横越水域；仅在地面移动时循环气垫特效",
        )

    # Native hull engines remain separate from the ordinary-unit reversing jets.
    prefab["layers"] = [l for l in prefab["layers"] if l["name"] != "EnvironmentBoost"]
    if thrusters and not prefab["stats"].get("ship"):
        reversing = []
        for key in native:
            if not key.startswith("decal_BoostReversing"):
                continue
            source = section(native, key)
            if not source.get("image"):
                continue
            image = resolve(source["image"].replace("\\", "/"))
            dest = ASSETS / "units" / prefab["id"] / "textures" / image.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists(): shutil.copyfile(image, dest)
            prefab["materials"]["textures"][image.name] = "textures/" + image.name
            name = key[6:]
            layer = next((l for l in prefab["layers"] if l["name"] == name), None)
            if layer is None:
                layer = {"name":name}
                prefab["layers"].append(layer)
            bone = BONE_NAMES.get(source.get("basePositionFromLegEnd"), source.get("basePositionFromLegEnd"))
            layer.update(texture=image.name, bone=bone if bone in prefab["skeleton"] else "Body",
                order=float(source.get("order", 0)), scale=float(source.get("imageScale", 1)),
                scaleX=float(source.get("imageScaleX", 1)), scaleY=float(source.get("imageScaleY", 1)),
                rotation=float(source.get("dirOffset", 0)), alpha=float(source.get("alpha", 1)),
                offset={"x":float(source.get("xOffsetRelative", 0)),"y":float(source.get("yOffsetRelative", 0))},
                frames=int(source.get("total_frames", 1)), frame=0, frameFps=12,
                visibleWhen={"sustainedThrust":True}, independentClock=True)
            layer.pop("hidden", None)
            layer.pop("onlyAnimateWhenMoving", None)
            reversing.append(layer)
        # Units without the inherited decal use the same native reverse sheet at their engine mount.
        if not reversing:
            image = resolve("ROOT:Resource/Image/Fx/Unit/Image/BoostReversing_1.png")
            dest = ASSETS / "units" / prefab["id"] / "textures" / image.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists(): shutil.copyfile(image, dest)
            prefab["materials"]["textures"][image.name] = "textures/" + image.name
            prefab["layers"].append(dict(name="BoostReversing",texture=image.name,bone="Body",
                order=0,scale=.65,offset={"x":0,"y":-10},alpha=.65,frames=3,frame=0,frameFps=12,
                visibleWhen={"sustainedThrust":True},independentClock=True))
    for layer in prefab["layers"]:
        if "Boost" in layer["name"] and "Reversing" not in layer["name"] and "FlyHover" not in layer["name"]:
            layer["visibleWhen"] = {"thrustActive":True}
            layer["independentClock"] = True
    # Red engine variants belong to their activation skill, never to ordinary movement.
    red = [layer for layer in prefab["layers"] if "red" in layer.get("texture", "").lower() and
           any(token in layer["name"].lower() for token in ("boost", "system"))]
    if red:
        import copy
        engines = [layer for layer in red if "boost" in layer["name"].lower()]
        for layer in red:
            layer.setdefault("visibleWhen", {})["boostSkillActive"] = True
        for layer in engines:
            blue = layer["texture"].replace("_Red", "")
            candidates = [other for other in prefab["layers"] if other not in red and other.get("texture") == blue]
            if not candidates:
                image = resolve("ROOT:Resource/Image/Fx/Unit/Image/" + blue)
                dest = ASSETS / "units" / prefab["id"] / "textures" / blue
                if not dest.exists():shutil.copyfile(image,dest)
                prefab["materials"]["textures"][blue] = "textures/" + blue
                fallback = copy.deepcopy(layer);fallback["name"] += "_NormalBlue";fallback["texture"] = blue
                prefab["layers"].append(fallback);candidates = [fallback]
            for fallback in candidates:
                fallback.setdefault("visibleWhen", {})["boostSkillActive"] = False
    # These native left/right barrels already share one complete firing flow.
    # Keep the definitions for provenance, expose only the combined weapon.
    if prefab["id"] == "RMV_1":
        for kit in prefab["weaponKits"]:
            kit["weapons"] = [k for k in kit["weapons"] if k != "Common_MortarDouble_L"]
        for key in ["Common_MortarDouble", "Common_MortarDouble_L"]:
            if key in prefab["weapons"]:
                w = prefab["weapons"][key]
                w.update(name="迫击炮轰炸", slot="skill", changeHeldWeapon=False)


def import_system_effect(system, native, effects):
    name = "System_" + system + "_1"
    source = section(native, "effect_" + name)
    image = resolve(source["image"])
    dest = ASSETS / "effects" / "textures" / image.name
    if not dest.exists():
        shutil.copyfile(image, dest)
    effects[name] = dict(texture="textures/" + image.name,
        frames=int(source["total_frames"]), startFrame=int(source["animateFrameStart"]),
        endFrame=int(source["animateFrameEnd"]), fps=float(source["animateFrameSpeed"])*60,
        scaleFrom=float(source["scaleFrom"]), scaleTo=float(source["scaleTo"]),
        alpha=float(source.get("alpha", 1)), rotation=0, offset={"x":0,"y":0},
        drift=0, sounds=[], source="MOD native " + name)
