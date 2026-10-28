"""输出原生时间统计；运行时多武器攻击由AP规则控制。"""
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
        unit=json.loads(file.read_text(encoding="utf-8"))
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
    (ROOT/"tools/weapon-timing-report.json").write_text(json.dumps(rows,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    fields=[key for key in rows[0] if key not in ["nativePayload","timeline"]]
    with (ROOT/"武器时间与CD统计.csv").open("w",encoding="utf-8-sig",newline="") as file:
        writer=csv.DictWriter(file,fieldnames=fields,extrasaction="ignore");writer.writeheader();writer.writerows(rows)
    groups=defaultdict(list)
    for row in rows:
        key=(row["weaponId"],row["source"],row["duration"],row["cooldown"],row["projectiles"],row["en"],row["damagePerProjectile"])
        groups[key].append(row)
    lines=["# 武器发射流程与CD统计","",f"共{len(rows)}条单位—武器配置，按ID、来源、流程、发数、消耗等去重后{len(groups)}组；包含隐藏武器与强化形态，hidden字段可筛选。不是只统计武器名称。","",
        "- 流程时间包含原MOD准备、射击、收招，不包含本项目弹道飞行、命中、死亡动画或每单位0～1秒随机延迟。",
        "- CD单独记录：普通动作在开火开始设置CD；自动炮塔通常在弹仓耗尽后进入CD。参考循环取普通动作max(流程,CD)、自动炮塔流程+CD，未计移位、瞄准、驾驶员或特定条件加成。",
        "- emissions是发射动作/炮口次数，projectiles是含霰弹的弹体数；舰炮含全部完好模块。连射中每弹的数值保存在JSON时间线中，不把副炮、左右炮位或不同弹丸重复叠加。",
        "- 原ProjectileAttackTimes是弹体可命中目标容量，不是对同一单位重复伤害；本次不将其改成多段连击。DP、烧灼等原生载荷另存nativePayload，未声称已实现原RTS全部异常状态。",
        "- 声明的_EN宏不等于实际扣费：例如部分战舰迫击炮只用宏做AI门槛，没有price/addResources/UseEN扣费。本表按实际执行的资源操作统计，同时保留declaredEnergy供核对；不擅自补上原MOD未执行的消费。",
        "- 当前已接入AP限制的单目标多武器顺序攻击；本报告记录原始流程，多目标攻击尚未接入。","", "## 当前AP攻击流程","",
        "每单位默认5 AP，先选一个敌人再按顺序添加武器，可重复同一武器；每次分别消耗其AP和EN。流程秒数与CD仅作原生演出参考，不作为本回合次数限制。",
        "光束步枪/火箭筒2 AP，机枪扫射3，头部火神炮1，手臂/内藏武装2，加农炮/舰炮3。格斗、光束喷枪、导弹2，航空炸弹3。零EN武器也必须支付AP。",
        "狙击蓄力与迫击炮作为技能武器独占行动。普通航空投弹可进入AP序列；舰炮按一类完好模块齐射消费一次武器AP。同一单位依次演出，不同单位并行；防守统一选择一次，目标死亡后取消剩余武器。",
        "", "## 按CD分类","", "| 分类 | 单位—武器条目数 |", "| --- | ---: |"]
    counts=Counter(row["class"] for row in rows)
    for label,count in counts.items():lines.append(f"| {label} | {count} |")
    lines += ["", "## 按流程时间分类", "", "| 分类 | 单位—武器条目数 |", "| --- | ---: |"]
    for label,count in Counter(row["flowClass"] for row in rows).items():
        lines.append(f"| {label} | {count} |")
    for kind in sorted(set(row["category"] for row in rows)):
        lines += ["", "## "+kind, "", "| 武器ID | 首发/末发(s) | 收招/流程(s) | CD(s) | 发数 | EN | 使用单位 |", "| --- | ---: | ---: | ---: | ---: | ---: | --- |"]
        for grouped in groups.values():
            row=grouped[0]
            if row["category"]!=kind:continue
            units=", ".join(dict.fromkeys(item["unitId"] for item in grouped))
            lines.append(f"| {row['weaponId']} | {row['firstShot']}/{row['lastShot']} | {row['recovery']}/{row['duration']} | {row['cooldown']} | {row['projectiles']} | {row['en']} | {units} |")
    (ROOT/"武器时间与CD统计.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
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
    (ROOT/"武器命名待确认.md").write_text("\n".join(naming)+"\n",encoding="utf-8")
    print(f"Weapon rows: {len(rows)}; timing groups: {len(groups)}; names awaiting confirmation: {len(uncertain)}")

if __name__=="__main__":
    main()
