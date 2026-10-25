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
    if "chestbeam" in weapon_id.lower():
        return "other"  # 大魔的胸部扩散炮等特殊武器保留原来的专用射程。
    if "mortar" in text or "迫击" in text:
        return "mortar"
    if "sniper" in text or "狙击" in text:
        return "sniper"
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
            weapon["max"] = RANGES[kind][1] + 1
    for weapon in prefab["weapons"].values():
        special = weapon.get("special", {})
        if special.get("type") == "snipe":
            base = prefab["weapons"][special["baseWeapon"]]
            weapon["min"] = base["min"]
            weapon["max"] = math.ceil(base["max"] * 1.5)


def configure(prefab, native):
    from native_combat import restore
    restore(prefab, native)
    if prefab["stats"].get("ship"):
        native_accuracy = stat(native, "baseAccuracyLevel", 100)
        prefab["sourceStats"]["accuracy"] = native_accuracy
        prefab["stats"]["accuracy"] = round(native_accuracy * 1.1, 6)
        prefab["stats"]["accuracyMultiplier"] = 1.1
    # Store the pre-bonus distance so refreshes never add the bonus twice.
    baseline = prefab["sourceStats"].setdefault("tacticalMoveBeforeBonus", prefab["stats"]["move"])
    prefab["stats"]["move"] = baseline + 1
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
        if kind == "mortar":
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
    return prefab
