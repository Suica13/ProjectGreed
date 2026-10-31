"""Install the native arm-independent body tackle into every weapon kit."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json
import shutil
from pathlib import Path
from mod_source import ROOT

ASSETS = Path(__file__).resolve().parents[1] / "assets"
SKILL = "Common_Push_A"

def apply_body_tackle(prefab):
    prefab["weapons"][SKILL] = dict(
        name="冲撞",
        localization={
            "zh": {"name": "冲撞"},
            "ja": {"name": "体当たり"},
            "en": {"name": "Body Tackle"},
        },
        slot="skill",
        type="melee",
        min=1, max=1,
        hit=95,
        en=0,  # Native body attacks have no energy charge.
        clip=SKILL, sourceName=SKILL, sourceHit=125, hitMultiplier=.85, hitBonus=-11,
        changeHeldWeapon=False,
        requiredParts=[],  # Unlike held weapons, broken arms never disable the body.
        partBreakModifier=.75,
        damagePerShot=5000, damageComponents={"melee":2500,"meleeShell":2500}, hitsPerShot=1,
        attack={"steps":[{"delay":.45,"shots":1},{"delay":1}]},
        sound={"file":"../../sounds/Fist_2.ogg","volume":.5},
        hitEffect="Cqb_Hit_1", swingEffects=["Cqb_Fire_2_Kick_White_R"],
        source={
            "file": "Units/BattleUnits/Weapon/Cqb/Common_Push_A.gw",
            "barrelX": 0, "barrelY": 0,
            "cooldownSeconds": 3,  # Reference only; turn actions enforce usage here.
        },
    )
    specific = f"{prefab['id']}__{SKILL}.json"
    prefab["animations"].setdefault(SKILL, "../../animations/" + (specific if (ASSETS / "animations" / specific).exists() else SKILL+".json"))
    for kit in prefab["weaponKits"]:
        if SKILL not in kit["weapons"]:
            kit["weapons"].append(SKILL)
    return prefab

def import_tackle_assets():
    for source, target in [
        ("Resource/Sound/SE/Weapon/Fire/Fist_2.ogg", "sounds/Fist_2.ogg"),
        ("Resource/Image/Fx/Weapon/Cqb/Image/Cqb_Fire_2_White.png", "effects/textures/Cqb_Fire_2_White.png")]:
        shutil.copyfile(ROOT/source, ASSETS/target)
    path=ASSETS/"effects/effects.json"
    effects=load_source_json(path.read_text(encoding="utf-8"))
    effects["Cqb_Fire_2_Kick_White_R"]=dict(texture="textures/Cqb_Fire_2_White.png",frames=6,startFrame=0,endFrame=5,
        fps=15,scaleFrom=.45,scaleTo=.25,alpha=.85,rotation=90,offset={"x":5,"y":5},drift=21,sounds=[],
        source="Resource/Image/Fx/Weapon/Cqb/Common/Cqb_Fire_2_Kick_White_R.gw")
    path.write_text(dump_source_json(effects,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
