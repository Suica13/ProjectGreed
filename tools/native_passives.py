"""Adapt native passive tags and self-buffs into ProjectGreed rules."""


def _skills(prefab):
    return set(prefab.get("sourceStats", {}).get("nativeSkills", [])) | {
        mechanic.get("id", "") for mechanic in prefab.get("mechanics", [])
    }


def apply_command_auras(prefab, native=None):
    """Keep native aura ownership; tactical range/power are the user-defined policy."""
    names = {"CmdAtk": ("cmdAtk", "攻击指挥"), "CmdDef": ("cmdDef", "防御指挥"), "CmdCom": ("cmdCom", "通信指挥")}
    declared = _skills(prefab)
    auras = []
    for ident, (kind, name) in names.items():
        present = ("hiddenAction_Check_" + ident in native) if native is not None else ident in declared
        if not present:
            continue
        auras.append({"type": kind, "name": name, "source": "Template/Unit/Skill/" + ident + ".gw"})
        for mechanic in prefab.get("mechanics", []):
            if mechanic.get("id") == ident:
                mechanic.update(status="adapted", name=name + "：范围与效果随驾驶员领导力变化")
    if auras:
        prefab.setdefault("stats", {})["commandAuras"] = auras
    else:
        prefab.setdefault("stats", {}).pop("commandAuras", None)
    return auras


def apply_learning_computer(prefab, native=None):
    """Read the inherited LPC action, including legacy units without skill tags."""
    import re
    declared = "LPC" in _skills(prefab)
    action = native.get("hiddenAction_LPCTrue", {}) if native is not None else {}
    match = re.search(r"(?:^|,)\s*baseExpSpeed\s*=\s*([0-9.]+)", action.get("setUnitMemory", ""))
    present = bool(match) if native is not None else declared
    if not present:
        prefab.setdefault("stats", {}).pop("pilotExperienceMultiplier", None)
        return
    multiplier = float(match[1]) if match else 1.1
    prefab.setdefault("stats", {})["pilotExperienceMultiplier"] = multiplier
    mechanics = prefab.setdefault("mechanics", [])
    mechanic = next((m for m in mechanics if m.get("id") == "LPC"), None)
    if mechanic is None:
        mechanic = {"id": "LPC", "source": "Template/Unit/Skill/LPC.gw"}
        mechanics.append(mechanic)
    mechanic.update(status="adapted", name="学习型电脑：驾驶员经验获取×" + f"{multiplier:g}")


def correct(prefab, native=None):
    apply_command_auras(prefab, native)
    apply_learning_computer(prefab, native)
    skills = _skills(prefab)
    sensors = prefab.setdefault("stats", {}).setdefault("sensors", {})
    sensors["stealth"] = "Stealth" in skills
    sensors["stealthAqua"] = "Stealth_Aqua" in skills
    sensors["antiDetect"] = sensors.get("antiDetect", False) or "AntiDetect" in skills
    sensors["antiDetectAqua"] = "AntiDetect_Aqua" in skills

    if "ExplosiveReactiveArmor_Shell" in skills:
        prefab["stats"]["shellFinalResistance"] = 25

    mechanics = prefab.setdefault("mechanics", [])
    if prefab["stats"].get("supplyAura"):
        mechanics[:] = [
            mechanic
            for mechanic in mechanics
            if not mechanic.get("id", "").startswith("SupplyPoint")
            and mechanic.get("id") != "AutoRepair"
        ]

    for mechanic in mechanics:
        ident = mechanic.get("id", "")
        if ident == "Stealth":
            mechanic.update(status="adapted", name="\u9690\u853d\uff1a\u964d\u4f4e\u654c\u65b9\u96f7\u8fbe\u7684\u6709\u6548\u4fa6\u6d4b\u8ddd\u79bb")
        elif ident == "Stealth_Aqua":
            mechanic.update(status="adapted", name="\u6c34\u4e0b\u9690\u853d\uff1a\u4f4d\u4e8e\u6c34\u4e2d\u65f6\u964d\u4f4e\u654c\u65b9\u96f7\u8fbe\u6709\u6548\u8ddd\u79bb")
        elif ident == "AntiDetect":
            mechanic.update(status="adapted", name="\u53cd\u4fa6\u6d4b\uff1a\u96f7\u8fbe\u4e0e\u4e3b\u52a8\u7d22\u654c\u6709\u6548\u8ddd\u79bb\u51cf\u534a")
        elif ident == "AntiDetect_Aqua":
            mechanic.update(status="adapted", name="\u6c34\u4e0b\u53cd\u4fa6\u6d4b\uff1a\u4f4d\u4e8e\u6c34\u4e2d\u65f6\u96f7\u8fbe\u4e0e\u4e3b\u52a8\u7d22\u654c\u8ddd\u79bb\u51cf\u534a")
        elif ident == "ExplosiveReactiveArmor_Shell":
            mechanic.update(status="adapted", name="\u7206\u70b8\u53cd\u5e94\u88c5\u7532\uff1a\u6700\u7ec8\u5b9e\u5f39\u4f24\u5bb3\u964d\u4f4e25%")

    actionable = {skill.get("id") for skill in prefab.get("skills", [])}
    if "EXAM" in actionable:
        mechanics[:] = [m for m in mechanics if "EXAM" not in m.get("id", "").upper() and "EXAM" not in m.get("name", "").upper()]
    if "HADES" in actionable:
        mechanics[:] = [m for m in mechanics if "HADES" not in m.get("id", "").upper() and "HADES" not in m.get("name", "").upper()]

    if "special_Common_OverBoost" in skills:
        prefab["skills"] = [s for s in prefab.get("skills", []) if s.get("id") != "Common_OverBoost"]
        prefab["skills"].append({
            "id": "Common_OverBoost",
            "type": "overboost",
            "name": "\u8d85\u9650\u55b7\u5c04",
            "actionCost": 1,
            "enCost": 100,
            "maxUses": 1,
            "consumeAction": False,
            "range": 0,
            "effect": "Light_75_NotAttached",
            "sound": {"file": "../../sounds/Action_8.ogg", "volume": 0.5},
            "moveBonus": 3,
            "mobilityMultiplier": 1.15,
            "hpDrainPercent": 25,
            "description": "\u542f\u52a8\u540e\u79fb\u52a8\u529b+3\u3001\u53cd\u5e94\u7cfb\u6570\u00d71.15\uff1b\u4ece\u4e0b\u4e00\u5df1\u65b9\u56de\u5408\u8d77\u6bcf\u56de\u5408\u635f\u593125%\u6700\u5927\u8010\u4e45\uff0c\u76f4\u81f3\u6b7b\u4ea1\u3002\u642d\u8f7d\u4e2d\u4ecd\u4f1a\u6301\u7eed\u3002",
        })
        for mechanic in mechanics:
            if mechanic.get("id") == "special_Common_OverBoost":
                mechanic.update(status="adapted", name="\u8d85\u9650\u55b7\u5c04\uff1a\u79fb\u52a8\u529b+3\u3001\u53cd\u5e94\u7cfb\u6570\u00d71.15\uff0c\u6bcf\u56de\u5408\u635f\u593125%\u6700\u5927\u8010\u4e45")

    if "special_Common_FullBoost" in skills or any(s.get("id") == "Common_FullBoost" for s in prefab.get("skills", [])):
        prefab["skills"] = [s for s in prefab.get("skills", []) if s.get("id") != "Common_FullBoost"]
        prefab["skills"].append({
            "id": "Common_FullBoost",
            "type": "fullboost",
            "name": "\u5168\u529b\u63a8\u8fdb",
            "actionCost": 0,
            "enCost": 250,
            "consumeAction": False,
            "range": 0,
            "effect": "Flash_1_N",
            "sound": {"file": "../../sounds/Action_8.ogg", "volume": 0.5},
            "duration": 2,
            "cooldownTurns": 1,
            "moveBonus": 2,
            "mobilityMultiplier": 1.1,
            "description": "\u6d88\u8017250 EN\uff0c\u57282\u4e2a\u5df1\u65b9\u56de\u5408\u5185\u79fb\u52a8\u529b+2\u3001\u53cd\u5e94\u7cfb\u6570\u00d71.10\uff1b\u6548\u679c\u7ed3\u675f\u540e\u51b7\u53741\u4e2a\u5df1\u65b9\u56de\u5408\u3002\u642d\u8f7d\u4e2d\u4ecd\u4f1a\u6301\u7eed\u4e0e\u8ba1\u65f6\u3002",
        })
        mechanics[:] = [m for m in mechanics if m.get("id") != "special_Common_FullBoost"]
    return prefab


if __name__ == "__main__":
    import json
    from mod_source import ASSETS, MOD, load
    count = 0
    for path in sorted((ASSETS / "units").glob("*/unit.json")):
        prefab = json.loads(path.read_text(encoding="utf-8-sig"))
        correct(prefab, load(MOD / prefab["source"]))
        path.write_text(json.dumps(prefab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        count += 1
    print("Updated native passives for", count, "units")
