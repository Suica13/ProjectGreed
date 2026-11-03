"""输出原生时间统计；运行时多武器攻击由AP规则控制。"""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import csv
import json
from collections import Counter, defaultdict
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]


def timing_class(value):
    if value == 0:
        return "未配置独立CD"
    return "快循环（≤2秒）" if value <= 2 else "中循环（2～5秒）" if value <= 5 else "慢循环（5～10秒）" if value <= 10 else "长冷却（>10秒）"


def flow_class(value):
    return "极短流程（≤0.5秒）" if value <= .5 else "短流程（0.5～2秒）" if value <= 2 else "中流程（2～5秒）" if value <= 5 else "长流程（>5秒）"


def main():
    rows=[]
    for file in sorted((ROOT/"assets/units").glob("*/unit.json")):
        unit=load_source_json(file.read_text(encoding="utf-8"))
        for key,weapon in unit["weapons"].items():
            native=weapon["nativeTiming"]
            burst_end=native["duration"]
            cooldown=native["cooldown"]
            automatic=native["entry"]=="automatic_turret"
            rows.append({
                "unitId":unit["id"],"unitName":unit["name"],"weaponId":key,"displayName":weapon["name"],
                "category":weapon.get("category","other"),"class":timing_class(cooldown),"flowClass":flow_class(burst_end),
                "firstShot":round(native["firstShot"],6),"lastShot":round(native["lastShot"],6),
                "recovery":round(burst_end-native["lastShot"],6),"duration":round(burst_end,6),"cooldown":cooldown,
                "referenceCycle":round(burst_end+cooldown if automatic else max(burst_end,cooldown),6),
                "cooldownStarts":"弹仓耗尽后" if automatic else "技能/开火开始时",
                "emissions":native["firingEvents"],"projectiles":native["projectiles"],
                "damagePerProjectile":weapon["damagePerShot"],
                "totalRawDamage":sum(sum(step.get("damageComponents",weapon["damageComponents"]).values())*step.get("shots",0)*step.get("repeat",1) for step in weapon["attack"]["steps"]),
                "accuracy":weapon["hit"],"en":weapon["en"],"energyMode":native["energyMode"],"enPerEmission":native["energyPerEmission"],"declaredEnergy":native["declaredEnergy"],
                "hidden":bool(weapon.get("availability",{}).get("hidden")),"source":native["source"],
                "nativePayload":weapon["nativePayload"],"timeline":weapon["attack"]["steps"],
            })
    (ROOT/"tools/weapon-timing-report.json").write_text(dump_source_json(rows,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    fields=[key for key in rows[0] if key not in ["nativePayload","timeline"]]
    with (ROOT/"武器时间与CD统计.csv").open("w",encoding="utf-8-sig",newline="") as file:
        writer=csv.DictWriter(file,fieldnames=fields,extrasaction="ignore");writer.writeheader();writer.writerows(rows)
    groups=defaultdict(list)
    for row in rows:
        key=(row["weaponId"],row["source"],row["duration"],row["cooldown"],row["projectiles"],row["en"],row["damagePerProjectile"])
        groups[key].append(row)
    from native_weapon_names import label as confirmed_label
    uncertain=defaultdict(list)
    for row in rows:
        name=row["displayName"]
        if confirmed_label(row["weaponId"], {}, False):
            continue
        # 有型号/口径的既有人工名称保留；泛称、占位英文和未确认新武器列出请用户命名。
        if name in ["近身格斗","光束炮","舰载光束炮","舰载机枪","舰载火神炮","舰载导弹发射器","机枪","火神炮","导弹发射器","光束狙击枪","狙击步枪","步兵班武器","航空炸弹","加农炮","迫击炮轰炸"] or (name.isascii() and any(c.isalpha() for c in name)):
            uncertain[row["weaponId"]].append(row)
    naming=["# 武器命名待确认","",f"以下{len(uncertain)}个武器ID的显示名仍是泛称或占位名，先保留现状，等待用户提供命名规则。已确认系列由`tools/native_weapon_names.py`维护。武器ID不改名；左右位和同类舰炮合并后仍保留来源。","", "| 武器ID | 当前显示名 | 出现单位 |", "| --- | --- | --- |"]
    for key,items in sorted(uncertain.items()):
        naming.append("| "+key+" | "+items[0]["displayName"]+" | "+", ".join(dict.fromkeys(item["unitId"] for item in items))+" |")
    naming += ["", "可按武器ID或一组前缀提供命名规则，例如：ArmGL、ArmBR、HandMG、AA、CN、BigGun、MS／AMS／SMS。不会凭ID猜测新的正式显示名。"]
    (ROOT/"docs/imports/weapon-names.md").write_text("\n".join(naming)+"\n",encoding="utf-8")
    print(f"Weapon rows: {len(rows)}; timing groups: {len(groups)}; names awaiting confirmation: {len(uncertain)}")

if __name__=="__main__":
    main()
