"""统一武器射程、特殊攻击规则及原 MOD 攻防系数。"""
import copy
import math
import re
from mod_source import ROOT, load, section, stat

RANGES = {
    "melee": (1, 1),
    "mortar": (5, 8),
    "sniper": (3, 6),
    "bomb": (1, 2),
    "nuke": (3, 8),
    "bazooka": (2, 4),
    "cannon": (3, 5),
    "beam_gun": (2, 3),
    "beam_rifle": (2, 3),
    "machine_gun": (2, 3),
    "missile": (3, 4),
}
DEFENSE_CHANNELS = {"beam": "Beam", "shell": "Shell", "melee": "Cqb", "dp": "Dp", "sp": "Sp"}


def category(weapon_id, weapon):
    # MS-06 等型号中的 MS 不能被误认为 Missile。DoubleMS / LegMS 才是武器标识。
    short_id = re.sub(r"^(?:ef|zn)_(?:msm?|rx|rgm)_\d+[a-z0-9]*_", "", weapon_id.lower())
    text = (weapon_id + " " + weapon.get("source", {}).get("file", "") + " " + weapon.get("name", "")).lower()
    if weapon["type"] == "melee":
        return "melee"
    if any(token in weapon_id.lower() for token in ["minigun", "gatling", "gattling"]):
        return "machine_gun"
    if "chestbeam" in weapon_id.lower():
        return "other"  # 大魔的胸部扩散炮等特殊武器保留原来的专用射程。
    if "mortar" in text or "迫击" in text:
        return "mortar"
    if "sniper" in text or "狙击" in text:
        return "sniper"
    if weapon_id == "ZN_MS_06C_Bombing_Nuke":
        return "nuke"
    if "bomb" in text or "航空炸弹" in text:
        return "bomb"
    if "bazooka" in text or "panzerfaust" in text or "火箭筒" in text or re.search(r"_bz(?:_|$)", short_id):
        return "bazooka"
    if "cannon" in text or "加农" in text or re.search(r"_cn(?:_|$)", short_id):
        return "cannon"
    if "beamspray" in text or "beamgun" in text or "光束喷枪" in text:
        return "beam_gun"
    if "beamrifle" in text or "armbr" in short_id or "光束步枪" in text or re.search(r"(?:^|_)br(?:_|$)", short_id):
        return "beam_rifle"
    if any(token in text for token in ["mg", "vulcan", "机枪", "机炮", "火神炮"]) or any(token in short_id for token in ["biggun", "handgun"]) or re.search(r"_aa(?:_|$)", short_id):
        return "machine_gun"
    if "missile" in text or "导弹" in text or re.search(r"(?:doublems|chestms|legms|msl|_(?:a?ms|sms)(?:_|$))", short_id):
        return "missile"
    return "other"


def action_cost(prefab, key, weapon):
    if weapon.get("category") == "sniper":
        return 4
    if weapon.get("slot") == "skill":
        return 5
    if key == "Common_DoubleVulcan_MS" or ("head" in weapon.get("requiredParts", []) and "Vulcan" in key):
        return 1
    if prefab["stats"].get("ship"):
        return 2 if weapon["category"] == "missile" else 3
    if weapon.get("rangeRole") == "short_secondary" or re.search(r"Arm|Hand|Chest|Leg|Internal|Vulcan", key):
        return 2
    if weapon["category"] in ["cannon", "mortar", "machine_gun", "bomb"]:
        return 3
    return 2


def configure_sniper(prefab):
    ordinary = [(key, weapon) for key, weapon in prefab["weapons"].items()
                if weapon["category"] == "sniper" and "_Sniper_Aim" not in key]
    for key, weapon in prefab["weapons"].items():
        if "_Sniper_Aim" not in key:
            continue
        match = next(((base_id, base) for base_id, base in ordinary if key.startswith(base_id)), None)
        if not match:
            continue
        base_id, base = match
        if weapon.get("projectile") and base.get("projectile"):
            weapon["projectile"]["speed"] = base["projectile"]["speed"]
        # 伤害、耗能、步骤使用原生技能；仅保留回合制蓄力与命中倍率规则。
        weapon.update(
            name="狙击蓄力", slot="skill", changeHeldWeapon=False, noCounter=True, hitScale=2,
            description="本回合蓄力，下次己方回合目标仍在射程内时自动攻击；命中率×2，伤害与EN沿用原MOD技能。",
            special={"type": "snipe", "delayOwnTurns": 1, "baseWeapon": base_id},
        )
        for kit in prefab["weaponKits"]:
            if base_id in kit["weapons"] and key not in kit["weapons"]:
                kit["weapons"].append(key)
            elif base_id not in kit["weapons"] and key in kit["weapons"]:
                kit["weapons"].remove(key)


def extended_ranges(prefab):
    """Final range bonuses derive from category baselines, so reloads are idempotent."""
    for weapon in prefab["weapons"].values():
        kind = weapon.get("category")
        if kind == "sniper":
            weapon["min"], weapon["max"] = RANGES["sniper"]
            weapon["actionCost"] = 4
        if prefab["stats"].get("ship") and kind in ["cannon", "mortar"] and weapon.get("rangeRole") != "ship_anti_air":
            weapon["max"] = RANGES[kind][1] + (3 if kind == "cannon" else 1)
    for weapon in prefab["weapons"].values():
        special = weapon.get("special", {})
        if special.get("type") == "snipe":
            base = prefab["weapons"][special["baseWeapon"]]
            weapon["min"] = base["min"]
            weapon["max"] = math.ceil(base["max"] * 1.5)


def federation_space_turret_damage(prefab):
    # Tactical bonus; preserve nativePayload as the original MOD audit source.
    if prefab["id"] not in {"SalamisClass", "MagellanClass", "MagellanClass_Green"}:
        return
    for weapon in prefab["weapons"].values():
        if not (weapon.get("moduleIds") or weapon.get("moduleId")):
            continue
        factor = 1.25 / weapon.get("tacticalDamageMultiplier", 1)
        for payload in [weapon, *weapon.get("attack", {}).get("steps", [])]:
            if "damagePerShot" in payload:
                payload["damagePerShot"] *= factor
            if "damageComponents" in payload:
                payload["damageComponents"] = {k: v * factor for k, v in payload["damageComponents"].items()}
        weapon["tacticalDamageMultiplier"] = 1.25


def flight_skill(prefab):
    if not any(m["id"] == "FlyStyle" for m in prefab.get("mechanics", [])):
        return
    prefab["skills"] = [s for s in prefab.get("skills", []) if s["id"] != "flight_stance"]
    prefab["skills"].append({"id":"flight_stance", "type":"flight", "name":"飞行姿态", "actionCost":1,
        "requiredParts":["head","backpack","leftArm","rightArm","leftLeg","rightLeg"],
        "maxUses":99999, "consumeAction":False, "range":0, "effect":"Light_75_NotAttached",
        "sound":{"file":"../../sounds/Fly_1.ogg","volume":0.6},
        "localization":{"zh":{"name":"飞行姿态"},"en":{"name":"Flight Stance"},"ja":{"name":"飛行形態"}}})
    for mechanic in prefab["mechanics"]:
        if mechanic["id"] == "FlyStyle":
            mechanic.update(status="adapted", name="飞行姿态：部位完好时消耗1 AP起飞或降落，保留移动机会")


def type61_spg_mortar(prefab):
    if prefab["id"] != "Type61_SPG":
        return
    key = "Common_Mortar_Type61_SPG"
    if key not in prefab["weapons"]:
        import importlib.util
        from pathlib import Path
        from mod_source import ASSETS
        spec = importlib.util.spec_from_file_location("spg_importer", Path(__file__).with_name("import-0079-page-one.py"))
        importer = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(importer)
        effects = importer.read(ASSETS / "effects/effects.json")
        for weapon_id, weapon in importer.weapon(prefab, ROOT / "Units/BattleUnits/Weapon/Shell/Common_Mortar_Type61_SPG.gw", effects):
            prefab["weapons"][weapon_id] = weapon
        importer.write(ASSETS / "effects/effects.json", effects)
    prefab["weapons"].pop("EF_Type61_SPG_Cannon", None)
    for kit in prefab["weaponKits"]:
        kit["weapons"] = [key]
    prefab["weapons"][key]["name"] = "迫击炮"
    prefab["weapons"][key]["localization"] = {"zh":{"name":"迫击炮"},"en":{"name":"Mortar"},"ja":{"name":"迫撃砲"}}


def configure_nuke(weapon):
    weapon.update(
        name="\u6838\u5f39\u8f70\u70b8",
        slot="skill",
        noCounter=True,
        maxUses=1,
        special={"type": "nuke", "radius": 3, "emptyCells": True},
    )
    weapon["localization"] = {
        "zh": {"name": "\u6838\u5f39\u8f70\u70b8"},
        "en": {"name": "Nuclear Bombardment"},
        "ja": {"name": "\u6838\u7206\u6483"},
    }
    weapon["projectile"].update(motion="mortar", rotation=0)
    weapon["hitEffect"] = "Nuke_Hit_1"
    weapon["damagePerShot"] = 30000
    weapon["damageComponents"] = {"shell": 30000}
    weapon["special"]["shape"] = "circle"
    weapon["description"] = "指定目标格为圆心，半径3格圆形范围造成30000基础实弹伤害；每条命限用1次。"
    for step in weapon.get("attack", {}).get("steps", []):
        if step.get("shots", 0):
            step["damageComponents"] = {"shell": 30000}
            step["damageMultiplier"] = 1


def configure(prefab, native):
    from native_combat import restore
    type61_spg_mortar(prefab)
    restore(prefab, native)
    flight_skill(prefab)
    for weapon in prefab["weapons"].values():
        weapon.pop("tacticalDamageMultiplier", None)
    federation_space_turret_damage(prefab)
    if prefab["stats"].get("ship"):
        native_accuracy = stat(native, "baseAccuracyLevel", 100)
        prefab["sourceStats"]["accuracy"] = native_accuracy
        prefab["stats"]["accuracy"] = round(native_accuracy * 1.1, 6)
        prefab["stats"]["accuracyMultiplier"] = 1.1
    # Store the pre-bonus distance so refreshes never add the bonus twice.
    baseline = prefab["sourceStats"].setdefault("tacticalMoveBeforeBonus", prefab["stats"]["move"])
    prefab["stats"]["move"] = baseline + (3 if prefab["stats"].get("ship") else 1)
    shooting = stat(native, "baseShootLevel", 100)
    melee = stat(native, "baseCqbLevel", 100)
    prefab["attackBonuses"].update(shooting=shooting - 100, melee=melee - 100)
    prefab["sourceStats"].update(shooting=shooting, melee=melee)
    for channel, source_name in DEFENSE_CHANNELS.items():
        prefab["defenses"][channel] = {
            "percent": stat(native, "base" + source_name + "Def"),
            "flat": stat(native, "base" + source_name + "DefPlus"),
        }
        if channel in prefab["shield"]["defenses"]:
            prefab["shield"]["defenses"][channel] = {
                "percent": stat(native, "shield" + source_name + "Def"),
                "flat": stat(native, "shield" + source_name + "DefPlus"),
            }
    for key, weapon in prefab["weapons"].items():
        if key == "ZN_MS_07B3_Minigun":
            weapon["name"] = "加特林盾牌"
            weapon["localization"] = {"zh":{"name":"加特林盾牌"},"en":{"name":"Gatling Shield"},"ja":{"name":"ガトリングシールド"}}
        if "ChestMS_Line" in key:
            weapon["name"] = "胸部有线导弹"
            weapon["localization"] = {"zh": {"name": weapon["name"]}, "en": {"name": "Chest Wire-Guided Missiles"}, "ja": {"name": "胸部有線ミサイル"}}
        kind = category(key, weapon)
        weapon["category"] = kind
        if kind in RANGES:
            weapon["min"], weapon["max"] = RANGES[kind]
        else:
            # 未指定类别保持原导入规则，避免将霰弹枪、手榴弹等误套机枪射程。
            source_file = weapon.get("source", {}).get("file")
            if source_file:
                source = load(ROOT / source_file)
                turret_id = "turret_" + weapon.get("sourceName", key)
                if turret_id in source:
                    turret = section(source, turret_id)
                    value = turret.get("limitingRange", stat(source, "baseAttackRange", 450))
                    try:
                        maximum = max(2, min(4, round(float(value) / 100)))
                        weapon.update(min=1, max=maximum)
                    except (ValueError, TypeError):
                        pass
            if key == "ZN_MS_09_ChestBeam":
                weapon.update(min=1, max=1)
        if kind == "nuke":
            configure_nuke(weapon)
        if kind == "mortar":
            if prefab["id"] in ["RX_77_2", "RX_77_3", "RX_77_3D"]:
                weapon["requiredParts"] = ["backpack"]
                weapon.pop("anyParts", None)
                weapon["changeHeldWeapon"] = False
                for step in weapon.get("attack", {}).get("steps", []):
                    if step.get("shots", 0):
                        step["requiredParts"] = ["backpack"]
            if prefab["id"] == "RGC_80" and "Common_Cannon" in prefab["weapons"]:
                cannon = prefab["weapons"]["Common_Cannon"]
                weapon["requiredParts"] = copy.deepcopy(cannon.get("requiredParts", []))
                weapon["muzzle"] = copy.deepcopy(cannon["muzzle"])
                weapon["changeHeldWeapon"] = False
            weapon.update(slot="skill", noCounter=True, special={"type": "mortar", "radius": 1, "emptyCells": True})
            weapon["projectile"].update(motion="mortar",rotation=0)
            weapon["description"] = "向目标九宫格随机落弹，空格落空；被击中的敌人只能防御或回避。"
        if kind == "bomb" and prefab["stats"].get("movementType") in ["air", "hover"]:
            weapon.setdefault("projectile", {})["motion"] = "bomb"
            weapon["special"] = {"type": "bomb"}
    for key, weapon in prefab["weapons"].items():
        if prefab["id"] in ["Medea", "FatUncle"] and "_Turret_MG" in key:
            weapon["min"], weapon["max"] = 1, 2
            weapon["rangeRole"] = "ship_anti_air"
        if prefab["stats"].get("ship") and re.search(r"_Turret_AA(?:_|$)", key):
            weapon["min"], weapon["max"] = 1, 2
            weapon["rangeRole"] = "ship_anti_air"
        if key == "Common_DoubleVulcan_MS" or re.search(r"(?:HandMG|HandGun|ArmMG|ArmGL|ArmBR)", key):
            weapon["min"], weapon["max"] = 1, 2
            weapon["rangeRole"] = "short_secondary"
        if weapon.get("special", {}).get("type") == "bomb":
            weapon["targetModifiers"]["air"] = 0
    configure_sniper(prefab)
    extended_ranges(prefab)
    from native_presentation import correct
    correct(prefab, native)
    from native_conversions import attach
    attach(prefab, native)
    from paired_weapons import configure as pair_weapons
    pair_weapons(prefab)
    prefab["stats"].setdefault("actionPoints", 5)
    for key, weapon in prefab["weapons"].items():
        weapon["actionCost"] = action_cost(prefab, key, weapon)
    from v17_balance import apply as apply_v17_balance
    return apply_v17_balance(prefab)
