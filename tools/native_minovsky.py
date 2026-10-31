"""Import native 0079 Minovsky dispensers as turn-based grid fields."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json
from mod_source import ASSETS, MOD, load


def correct(prefab, native):
    skills = prefab.setdefault("skills", [])
    before = dump_source_json(skills, ensure_ascii=False, sort_keys=True)
    skills[:] = [skill for skill in skills if skill.get("id") not in [
        "Common_MinovskyParticle_S", "Common_MinovskyParticle_M"
    ]]
    size = next((name for name in ["M", "S"]
                 if "action_Common_MinovskyParticle_" + name + "_Trigger" in native), None)
    if size:
        ident = "Common_MinovskyParticle_" + size
        radius, en_cost = ((9, 450) if size == "M" else (7, 300))
        skills.append({
            "id": ident,
            "type": "minovsky",
            "name": "米诺夫斯基粒子散布[" + size + "]",
            "radius": radius,
            "enCost": en_cost,
            "actionCost": 2,
            "durationRounds": 4,  # Two complete cycles; game.round advances on each side handoff.
            "cooldownTurns": 3,
            "maxUses": 99,
            "consumeAction": False,
            "effect": "Light_75_NotAttached",
            "sound": {"file": "../../sounds/Detect_3.ogg", "volume": 0.5},
            "localization": {
                "zh": {"name": "米诺夫斯基粒子散布[" + size + "]"},
                "en": {"name": "Minovsky Particle Dispersal [" + size + "]"},
                "ja": {"name": "ミノフスキー粒子散布[" + size + "]"},
            },
        })
        mechanics = prefab.setdefault("mechanics", [])
        mechanic = next((entry for entry in mechanics if entry.get("id") == ident), None)
        info = {
            "id": ident,
            "name": "米诺夫斯基粒子散布：格子区域内防守回避、反侦测与制导干扰",
            "status": "adapted",
            "source": "Units/BattleUnits/Weapon/Sp/" + ident + ".gw",
        }
        if mechanic:
            mechanic.update(info)
        else:
            mechanics.append(info)
    return before != dump_source_json(skills, ensure_ascii=False, sort_keys=True)


def main():
    changed = []
    for path in (ASSETS / "units").glob("*/unit.json"):
        prefab = load_source_json(path.read_text(encoding="utf-8-sig"))
        native = load(MOD / prefab["source"])
        if correct(prefab, native):
            path.write_text(dump_source_json(prefab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            changed.append(prefab["id"])
    print("Minovsky skills refreshed:", ", ".join(changed) if changed else "none")


if __name__ == "__main__":
    main()
