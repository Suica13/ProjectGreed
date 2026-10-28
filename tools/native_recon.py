"""Recon migration: source equipment decides availability; durations are adapted to team turns."""
import re
from mod_source import section
from native_sensors import RADAR_WORLD_UNITS_PER_TILE

def correct(prefab, native):
    skills = prefab.setdefault("skills", [])
    # Replace the old generic scan placeholder; retain native sonar until separately migrated.
    skills[:] = [s for s in skills if s["id"] not in ["ReconScan", "Common_CameraGun", "Common_DetectArea"]]
    mechanics = prefab.setdefault("mechanics", [])
    mechanics[:] = [m for m in mechanics if m["id"] != "ReconScan"]
    for skill in skills:
        if skill["type"] == "flight": skill["sound"] = {"file":"../../sounds/Fly_1.ogg", "volume":0.6}
    core = native.get("core", {})
    for ident, label, sound in [("Common_CameraGun","摄像枪","Detect_4"),("Common_DetectArea","索敌","Detect_3")]:
        if "action_" + ident + "_Trigger" not in native: continue
        camera = ident == "Common_CameraGun"
        distance = 1500 if camera else float(core.get("@global Common_DetectArea_Range", 900))
        skill = dict(id=ident, type="recon", name=label, reconMode="camera" if camera else "scan",
            range=distance / RADAR_WORLD_UNITS_PER_TILE, enCost=30 if camera else 100,
            actionCost=1, maxUses=99, consumeAction=False, waterOnly=False,
            durationRounds=2, cooldownTurns=1, effect="Light_75_NotAttached",
            sound={"file":"../../sounds/" + sound + ".ogg", "volume":0.5},
            localization={"zh":{"name":label},"en":{"name":"Camera Gun" if camera else "Active Scan"},"ja":{"name":"カメラガン" if camera else "索敵"}})
        if camera:
            skill.update(minRange=10, range=15, areaSight=3, areaRadar=3, actionCost=3,
                description="射程10～15格，消耗3 AP与30 EN；揭露目标半径3格视野并探测敌人，持续至下次己方回合。")
            source = section(native, "hiddenAction_Common_CameraGun_SetWeaponIndex")
            match = re.search(r"nowWeaponIndex\s*=\s*(\d+)", source.get("setUnitMemory", ""))
            if match: skill["weaponDisplayIndex"] = int(match[1])
        skills.append(skill)
        # The actionable skill card already contains the complete turn-based rules.
        # Keeping the imported provenance mechanic beside it produced a duplicate card.
        ids = {"special_" + ident, ident}
        mechanics[:] = [m for m in mechanics if m["id"] not in ids]
    prefab["stats"].setdefault("sensors", {})["antiDetect"] = bool(re.search(r"(?:^|,)\s*AntiDetect\s*(?:,|$)", core.get("tags", "")))
    tags = prefab.get("unitTags", [])
    hover = "decal_Hover" in native or "Hover" in tags
    presentation = prefab["presentation"]
    presentation["moveSoundKey"] = "moveSound" if hover else "tankMoveSound" if "Tank" in tags else "moveSound" if presentation.get("movement") == "boost" and presentation.get("thrusters", True) else None
    return prefab

if __name__ == "__main__":
    import json
    from mod_source import ASSETS, MOD, load
    for path in (ASSETS / "units").glob("*/unit.json"):
        prefab = json.loads(path.read_text(encoding="utf-8-sig"))
        correct(prefab, load(MOD / prefab["source"]))
        path.write_text(json.dumps(prefab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("Refreshed native recon skills and movement/flight sounds")
