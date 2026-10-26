"""Rebuild all ship attachment art, preserving native default headings and hull layering."""
import shutil
from mod_source import ASSETS, ROOT, section, resolve
from native_ship_arcs import module_source


def artwork(data):
    # Targeting rings, status effects and GUI markers are not physical turret sprites.
    result = []
    for key in data:
        if not key.startswith("decal_"):
            continue
        layer = section(data, key)
        image = layer.get("image", "")
        if image.startswith("ROOT:Units/") and layer.get("isVisible") != "if false":
            result.append((key, layer))
    return result


def correct_layers(prefab, native):
    hull = [l for l in prefab["layers"] if not l.get("moduleId")]
    body_orders = [float(l.get("order", 0)) for l in hull if l["name"] in ["Hull", "Body", "Body_2"]]
    if not body_orders:
        raise ValueError("Missing ship hull layer: " + prefab["id"])
    layers = []
    for module in prefab["stats"].get("modules", []):
        attachment, data, source = module_source(native, module)
        art = artwork(data)
        below = attachment.get("setDrawLayerOnBottom") == "true" or (
            not prefab["stats"].get("ship") and any(layer.get("layer") == "beforeBody" for _, layer in art)
        )
        module["visual"] = dict(source=source.relative_to(ROOT).as_posix(),
            separateSprite=bool(art), belowHull=below, decals=[name for name, _ in art])
        for i, (name, native_layer) in enumerate(art):
            image = resolve(native_layer["image"], source.parent)
            dest = ASSETS / "units" / prefab["id"] / "textures" / image.name
            dest.parent.mkdir(parents=True, exist_ok=True)
            if not dest.exists() or dest.read_bytes() != image.read_bytes():
                shutil.copyfile(image, dest)
            prefab["materials"]["textures"][image.name] = "textures/" + image.name
            anchor = min(body_orders) - 1 if below else max(body_orders) + 1
            layer = dict(name=module["id"] if i == 0 else module["id"] + "__" + name,
                bone=module["bone"], moduleId=module["id"], texture=image.name,
                order=anchor + float(native_layer.get("order", 0)) / 1000,
                scale=float(native_layer.get("imageScale", 1)),
                scaleX=float(native_layer.get("imageScaleX", 1)),
                scaleY=float(native_layer.get("imageScaleY", 1)),
                rotation=float(native_layer.get("dirOffset", 0)),
                offset={"x":float(native_layer.get("xOffsetRelative", 0)),
                        "y":float(native_layer.get("yOffsetRelative", 0))})
            layers.append(layer)
    prefab["layers"] = sorted(hull + layers, key=lambda l:l.get("order", 0))
