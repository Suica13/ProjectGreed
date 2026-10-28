"""Explicit tactical supply policy, shared by targeted edits and future MOD refreshes."""
SUPPLY_UNITS = {"Medea", "MedeaKai", "FatUncle", "FatUncleKai", "ColumbusClass", "PapuaClass"}
SUPPLY_DESCRIPTION = "消耗自身25%最大EN与2 AP，为一台相邻友军恢复50%最大EN，每个己方回合限用一次。"

def apply(prefab):
    if prefab["id"] not in SUPPLY_UNITS:
        return prefab
    if prefab["id"] in {"ColumbusClass", "PapuaClass"}:
        prefab["stats"]["cost"] = 250
        prefab.setdefault("costBalance", {})["published"] = 250
        prefab["costBalance"]["tacticalOverride"] = "Supply carrier COST halved from 500 to 250"
    prefab.setdefault("sourceStats", {})["supplyTacticalPolicy"] = {
        "enCostPercent": 25, "enRecoveryPercent": 50, "actionCost": 2, "usesPerOwnTurn": 1,
    }
    skills = prefab.setdefault("skills", [])
    skills[:] = [skill for skill in skills if skill["id"] != "adjacent_en_supply"]
    skills.append({
        "id": "adjacent_en_supply", "type": "resupply", "name": "EN补给",
        "localization": {"en": {"name": "EN Resupply"}, "ja": {"name": "EN補給"}},
        "description": SUPPLY_DESCRIPTION,
        "range": 1, "actionCost": 2, "enCostPercent": 25, "enRecoveryPercent": 50,
        "cooldownTurns": 1, "consumeAction": False,
        "effect": "Flash_1_N", "sound": {"file": "../../sounds/Action_8.ogg", "volume": 0.5},
    })
    return prefab
