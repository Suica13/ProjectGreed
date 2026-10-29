"""Shared post-import policy for pilot buffs and custom level-six skill choices."""
from copy import deepcopy

CUSTOM_IDS = ["Pilot_AtkUp_Trigger", "Pilot_AccuracyUp_Trigger", "Pilot_ReactionUp_Trigger", "Pilot_DefUp_Trigger", "Pilot_LeaderShipUp_Trigger", "Pilot_SpdUp_Trigger"]

def apply(catalog):
    for pilot in catalog["aces"]:
        for skill in pilot["skills"]:
            if skill.get("passive"):
                continue
            skill["statMultipliers"] = {key: 1.35 for key in skill.get("statMultipliers", {})}
            skill["experienceMultiplier"] = 1.35 if skill["id"] == "Pilot_ExpUp_Trigger" else 1
            skill.update(durationTurns=1, cooldownTurns=5, cooldownStarts="effect_end")
            experience = skill["id"] == "Pilot_ExpUp_Trigger"
            skill["description"] = ("驾驶员经验获取" if experience else "驾驶员属性") + "×1.35，持续1回合，冷却5回合。"
            localization = skill.setdefault("localization", {})
            localization.setdefault("en", {})["description"] = ("Pilot experience gain" if experience else "Pilot stats") + " ×1.35 for 1 turn; 5-turn cooldown after expiry."
            localization.setdefault("ja", {})["description"] = ("パイロット経験値" if experience else "パイロット能力") + "×1.35。1ターン持続、終了後5ターンのクールダウン。"
    templates = {s["id"]: s for p in catalog["aces"] for s in p["skills"]}
    for pilot in catalog["aces"]:
        ids = {s["id"] for s in pilot["skills"]}
        if "Pilot_ExpUp_Trigger" in ids and "Pilot_AtkUp_Trigger" not in ids:
            pilot["skills"].append(deepcopy(templates["Pilot_AtkUp_Trigger"]))
    catalog["customSkills"] = [deepcopy(templates[key]) for key in CUSTOM_IDS]
    reaction = next(s for s in catalog["customSkills"] if s["id"] == "Pilot_ReactionUp_Trigger")
    reaction["name"] = "回避率上升"
    reaction["localization"]["en"]["name"] = "Evasion Up"
    reaction["localization"]["ja"]["name"] = "回避率上昇"
