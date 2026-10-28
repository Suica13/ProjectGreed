"""原生持枪／射击显示、炮管排序、套件和主手优先顺序。"""
import math
import re
from mod_source import ROOT, load, section


def correct_shared_weapon_layers(prefab, native):
    if prefab["id"] == "MS_10":
        # Native cooldown selects equipment state, not a time-driven sprite loop.
        layer = next(l for l in prefab["layers"] if l["name"] == "ZN_MS_10_MS_MS")
        layer.pop("frameFps", None)
        layer.pop("onlyAnimateWhenMoving", None)
        layer["frame"] = 1
        layer["attackFrame"] = {"frame": 0, "weapons": ["ZN_MS_10_MS_MS", "ZN_MS_10_MS_MS_R"]}
        return
    if prefab["id"] == "RX_78_1":
        # Native EquipmentIndex2 selects saber (0) vs javelin (1), both at display index 1.
        # ProjectGreed exposes both attacks, so the selected held weapon is the discriminator.
        for layer in prefab["layers"]:
            weapon = {"EF_BeamSaber_AF_Fast":"EF_BeamSaber_AF_Fast_A", "EF_BeamJavelin_BF":"EF_BeamJavelin_BF_B"}.get(layer["name"])
            if weapon:
                layer.setdefault("visibleWhen", {})["heldWeapon"] = weapon
        return
    if prefab["id"] != "RX_78XX":
        return
    for kit in prefab["weaponKits"]:
        if "EF_90mmMG" in kit["weapons"]:
            kit["name"] = "90mm机枪套件"
    # AALDE is pilot-gated, but its left dagger decal is shared by both native
    # combos (nowWeaponIndex=1). Hiding the combo must not hide that physical blade.
    right = next(layer for layer in prefab["layers"] if layer["name"] == "EF_BeamDagger_Double_AALDF")
    left = next(layer for layer in prefab["layers"] if layer["name"] == "EF_BeamDagger_Double_AALDE_L")
    source = section(native, "decal_" + left["name"])
    if "memory.nowWeaponIndex==1" not in source.get("isVisible", ""):
        raise ValueError("RX-78XX shared dagger visibility changed in source")
    left.pop("hidden", None)
    left["visibleWhen"] = {"weaponDisplayIndex": 1}
    if "kit" in right.get("visibleWhen", {}):
        left["visibleWhen"]["kit"] = list(right["visibleWhen"]["kit"])
    left["requiredParts"] = ["leftArm"]


def correct(prefab, native):
    from native_movement_effects import correct_effects
    correct_effects(prefab, native)
    if prefab["stats"].get("modules"):
        from native_ship_arcs import correct_arcs
        correct_arcs(prefab, native)
        from native_ship_presentation import correct_layers
        correct_layers(prefab, native)
    layers = prefab["layers"]
    for layer in layers:
        name = layer["name"]
        source_key = "decal_" + name
        if source_key in native:
            condition = section(native, source_key).get("isVisible", "")
            match = re.search(r"memory\.nowWeaponIndex\s*(==|!=)\s*(-?\d+)", condition)
            if match and any("displayIndex" in weapon for weapon in prefab["weapons"].values()):
                matches = re.findall(r"memory\.nowWeaponIndex\s*(==|!=)\s*(-?\d+)", condition)
                values = list(dict.fromkeys(int(value) for _, value in matches))
                visibility = layer.setdefault("visibleWhen", {})
                layer.pop("hideWhenFiringIndex", None)
                if " or " in condition and "${onAttacking}==false" in condition:
                    # NT-1's gun-arm sprite replaces the regular arm only during firing.
                    layer["hideWhenFiringIndex"] = int(match[2])
                    visibility.pop("weaponDisplayIndex", None)
                else:
                    value = values[0] if len(values) == 1 else values
                    visibility["weaponDisplayIndex"] = {"not": value} if match[1] == "!=" else value
                visibility.pop("heldWeapon", None)
                # This native state replaces old hard-coded axe animation windows.
                layer.pop("animationVisibility", None)
            elif condition and "nowWeaponIndex" not in condition:
                # Native fixed/attached equipment is not controlled by the held weapon.
                visibility = layer.setdefault("visibleWhen", {})
                visibility.pop("heldWeapon", None)
                if re.search(r"self\.shield\s*>\s*0", condition):
                    visibility["shieldVisible"] = True
        if "Sniper" in name and name.endswith(("_Idle", "_Attack")):
            visibility = layer.setdefault("visibleWhen", {})
            visibility.pop("attacking", None)
            visibility["heldAttacking"] = name.endswith("_Attack")
    correct_shared_weapon_layers(prefab, native)
    if prefab["id"] == "RGM_79HC":
        for layer in layers:
            if layer["name"] == "Shield_Breaked":
                layer["visibleWhen"] = {"shieldVisible": False}
            elif layer["name"] == "Shield":
                layer["visibleWhen"] = {"shieldVisible": True}
    if prefab["id"] == "RX_77_3":
        for layer in layers:
            weapon = {"RX_77_3_Cannon": "Common_DoubleCannon_B2", "RX_77_4_Cannon": "EF_RX_77_4_BeamCannon"}.get(layer["name"])
            if weapon:
                layer["visibleWhen"] = {"kit": [kit["id"] for kit in prefab["weaponKits"] if weapon in kit["weapons"]]}
    if prefab["id"] == "RX_78GP02A":
        for layer in layers:
            if layer["name"].startswith(("ShoulderL_Booster_", "ShoulderR_Booster_")):
                layer["visibleWhen"] = {"moving": layer["name"].endswith("_On")}
                layer.pop("hidden", None)
    if prefab["id"] in ["RX_75", "RX_75R", "RMV_1", "RTX_440"]:
        body = max((layer.get("order", 0) for layer in layers if layer["name"] == "Body"), default=5)
        for layer in layers:
            if "Cannon" in layer["name"]:
                layer["order"] = max(layer.get("order", 0), body + 0.2)
    # 固定炮口和持枪炮口均按单位覆盖后的原生barrelX/Y重新求挂点。
    for key, weapon in prefab["weapons"].items():
        if weapon.get("moduleIds"):
            continue
        own = load(ROOT / weapon["source"]["file"])
        source = {name:{**own.get(name,{}),**native.get(name,{})} for name in own.keys() | native.keys()}
        mounts = weapon.get("muzzle",{}).get("mounts",[weapon.get("muzzle",{})])
        barrels = weapon["source"]["barrels"]
        corrected = []
        base = weapon.get("special",{}).get("baseWeapon",key)
        attack_layer = next((layer for layer in layers if layer["name"] == base+"_Attack"),None)
        for index,mount in enumerate(mounts):
            barrel = weapon["nativeTiming"]["barrel"] if attack_layer else barrels[min(index,len(barrels)-1)]["id"]
            turret = section(source,"turret_"+barrel)
            layer = attack_layer or next((layer for layer in layers if layer["name"] == mount.get("layer")),None)
            if layer:
                joint = prefab["skeleton"][layer["bone"]]
                facing = joint.get("endDirOffset",0)+joint.get("drawDirOffset",0)
                angle=math.radians(facing+layer.get("pivot",0))
                tx=joint["y"]+math.cos(angle)*layer["offset"]["y"]-math.sin(angle)*layer["offset"]["x"]
                ty=joint["x"]+math.sin(angle)*layer["offset"]["y"]+math.cos(angle)*layer["offset"]["x"]-layer.get("height",0)
                rotation=math.radians(facing+90+layer.get("rotation",0))
                dx,dy=float(turret.get("barrelY",0))-tx,float(turret.get("barrelX",0))-ty
                result={"layer":layer["name"],"point":{
                    "x":(dx*math.cos(rotation)+dy*math.sin(rotation))/(layer.get("scale",1)*layer.get("scaleX",1)),
                    "y":(-dx*math.sin(rotation)+dy*math.cos(rotation))/(layer.get("scale",1)*layer.get("scaleY",1)),
                }}
            else:
                bone=mount.get("bone","Body" if "Body" in prefab["skeleton"] else next(iter(prefab["skeleton"])))
                joint=prefab["skeleton"][bone]
                result={"bone":bone,"offset":{"x":float(turret.get("barrelX",0))-joint["x"],"y":float(turret.get("barrelY",0))-joint["y"]}}
            if turret.get("barrelOffsetX_onOddShots"):
                result["alternatingOffsetX"]=float(turret["barrelOffsetX_onOddShots"])
            corrected.append(result)
        weapon["muzzle"]={"mounts":corrected} if "mounts" in weapon.get("muzzle",{}) or attack_layer else corrected[0]
    if prefab["id"] == "RX_77_2":
        for kit in prefab["weaponKits"]:
            missile = "EF_RX_77_2_MS" in kit["weapons"]
            kit["name"] = "导弹套件" if missile else "加农炮套件"
            # 导弹套件不能携带加农炮的迫击炮分支。
            if missile:
                kit["weapons"] = [key for key in kit["weapons"] if prefab["weapons"][key].get("special",{}).get("type") != "mortar"]
        for layer in layers:
            if layer["name"] in ["RX_77_2_Cannon", "RX_77_2_SML"]:
                missile = layer["name"].endswith("SML")
                layer.setdefault("visibleWhen",{})["kit"] = [kit["id"] for kit in prefab["weaponKits"] if ("EF_RX_77_2_MS" in kit["weapons"]) == missile]
    for kit in prefab["weaponKits"]:
        def priority(key):
            weapon = prefab["weapons"][key]
            if weapon.get("special") or weapon["type"] == "melee" or "Grenade" in key:
                return 3
            # 有持枪贴图的主手武器优先；固定武器／腕部副武器随后。
            held = any(layer["name"] in [key,key+"_Idle",key+"_Attack"] and layer["bone"] in ["RightArm","RightWeapon","LeftArm","LeftWeapon"] for layer in layers)
            return 0 if held and weapon.get("rangeRole") != "short_secondary" else 2 if weapon.get("rangeRole") == "short_secondary" else 1
        if kit["weapons"]:
            primary = min(kit["weapons"],key=priority)
            kit["weapons"] = [primary,*[key for key in kit["weapons"] if key != primary]]
    from native_tethers import correct as correct_tethers
    correct_tethers(prefab, native)
    from native_hangars import correct as correct_hangars
    correct_hangars(prefab, native)
    from native_mobility import correct as correct_mobility
    correct_mobility(prefab, native)
    layers.sort(key=lambda layer:layer.get("order",0))
