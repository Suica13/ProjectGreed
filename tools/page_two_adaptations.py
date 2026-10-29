"""Keep source payloads that exceed reduced EN capacity out of playable loadouts."""
import re
from mod_source import ROOT, parse


def apply(prefab):
    labels={
        "DogFight_MA_Fighter":"MA空战机动",
        "I_Field":"I力场",
        "SFS_CantAttack_Neutral":"辅助飞行平台：可见MS搭载槽",
        "special_Common_DemolitionChain_Back_Space_GP_03D":"爆导索",
        "special_Common_MineLauncher_Continuous_Front_Space_YMS_15":"连续布雷",
    }
    skill_ids={skill["id"] for skill in prefab.get("skills",[])}
    prefab["mechanics"]=[mechanic for mechanic in prefab.get("mechanics",[])
        if not (mechanic["id"].startswith("special_") and mechanic["id"][8:] in skill_ids)]
    for mechanic in prefab["mechanics"]:
        if mechanic["id"] in labels:mechanic["name"]=labels[mechanic["id"]]
        elif mechanic["id"].startswith("special_Common_ReEntry"):mechanic["name"]="大气层突入"
    # These source weapons spawn independently controlled entities, not direct projectiles.
    source=ROOT/prefab["source"].split("/",1)[1]
    refs=parse(source).get("core",{}).get("copyFrom","")
    for reference in re.findall(r"ROOT:(Units/BattleUnits/Weapon/Funnel/[^,\s]+)",refs):
        ident="remote_weapon_"+reference.rsplit("/",1)[-1].rsplit(".",1)[0]
        if not any(item["id"]==ident for item in prefab.get("mechanics",[])):
            prefab.setdefault("mechanics",[]).append({"id":ident,"name":"浮游兵器：部署、远程操控与回收待适配","status":"review","source":reference})
    if prefab["id"]=="PublicClass" and not any(item["id"]=="BeamDiffusionArea" for item in prefab.get("mechanics",[])):
        prefab.setdefault("mechanics",[]).append({"id":"BeamDiffusionArea","name":"光束扰乱膜区域效果待适配；保留飞弹直接伤害","status":"review","source":"Units/BattleUnits/Weapon/Shell/EF_PublicClass_BeamDiffusionMS.gw"})
    if prefab["id"] not in ("RX_78GP02A", "MA_08", "MA_08_DZL"):
        return prefab
    deferred = set()
    for key, weapon in prefab["weapons"].items():
        if weapon["en"] <= prefab["stats"]["en"]:
            continue
        deferred.add(key)
        weapon["availability"] = {"hidden": True, "reasons": ["energy_capacity_review"]}
        ident = "energy_capacity_" + key
        if not any(item["id"] == ident for item in prefab.get("mechanics", [])):
            prefab.setdefault("mechanics", []).append({"id": ident, "name": "待适配：" + weapon["name"] + "（原生EN消费超过减半后的机体容量）", "status": "review", "source": weapon["source"]["file"]})
    for kit in prefab["weaponKits"]:
        kit["weapons"] = [key for key in kit["weapons"] if key not in deferred]
    if prefab.get("pairedWeapons"):
        prefab["pairedWeapons"] = [group for group in prefab["pairedWeapons"] if group["id"] not in deferred]
    return prefab
