"""Import named ACE pilots and their cheapest beacon offers, never the bundled units."""
import json
import math
import re
import shutil
from pathlib import Path
from mod_source import ROOT, load, parse, section
from importlib import import_module

PROJECT = Path(__file__).resolve().parents[1]
STATS = import_module("import-pilots").STATS
DEST = PROJECT / "assets/pilots"

def text(value):
    return value.replace("\\n", "\n").strip()

def skill_timing(ident):
    """Preserve authoritative native timers; one turn represents fifteen seconds."""
    if ident == "Pilot_ExamPilot_Trigger":
        return {"passive": True}
    base = ident.removesuffix("_Trigger")
    source = ROOT / "Template/Unit/Skill_Pilot" / (base + ".gw")
    raw = source.read_text(encoding="utf-8-sig")
    def seconds(suffix):
        match = re.search(r"@global\s+" + re.escape(base + suffix) + r"\s*[:=]\s*([\d.]+)", raw)
        if not match: raise ValueError("Missing native ACE timer: " + base + suffix)
        return float(match[1])
    duration, cooldown = seconds("_ActiveTime"), seconds("_CD")
    return dict(durationTurns=math.ceil(duration / 15), cooldownTurns=math.ceil(cooldown / 15),
                cooldownStarts="effect_end", nativeTiming=dict(durationSeconds=duration, cooldownSeconds=cooldown))



def skill_runtime(ident):
    base=ident.removesuffix('_Trigger')
    common=dict(owner="pilot",range=0,minRange=0,actionCost=0,maxUses=99,consumeAction=False,implemented=True)
    if base=="Pilot_ExamPilot":
        return dict(**common,type="pilot_passive",examImmunity=True,enCost=0)
    data=load(ROOT / "Template/Unit/Skill_Pilot" / (base+".gw"))
    raw=(ROOT / "Template/Unit/Skill_Pilot" / (base+".gw")).read_text(encoding="utf-8-sig")
    values={key:float(value) for key,value in re.findall(r"@global\s+(\w+)\s*[:=]\s*([\d.]+)",raw)}
    effect=next(value for key,value in values.items() if key not in [base+"_ActiveTime",base+"_CD"])
    fields={"Pilot_AtkUp":["shooting","melee"],"Pilot_DefUp":["defense"],"Pilot_SpdUp":["speed"],"Pilot_AccuracyUp":["accuracy"],"Pilot_ReactionUp":["reaction"],"Pilot_LeaderShipUp":["leadership"],"Pilot_AwakeningUp":["awakening"]}
    en=int(re.search(r"EN\s*=\s*(\d+)",data['action_'+ident]['price'])[1])
    sound=ROOT / "Resource/Sound/SE/Action/Common/Action_8.ogg"
    shutil.copyfile(sound, PROJECT / "assets/sounds/Action_8.ogg")
    return dict(**common,type="pilot_buff",enCost=en,statMultipliers={key:effect for key in fields.get(base,[])},
        experienceMultiplier=effect if base=="Pilot_ExpUp" else 1,nativeEffect=values,
        effect="Flash_1_N",sound={"file":"assets/sounds/Action_8.ogg","asset":"pilot/activation","volume":0.5})

def main():
    aces = []
    tree = json.loads((PROJECT / "shared/development-tree.json").read_text(encoding="utf-8"))
    framework = load(ROOT / "Template/Unit/BattleUnit_Framework_Pilot.ini")
    level_action = section(framework, "hiddenAction_TryLevelUp")
    max_level = int(re.search(r"pilotLevelCount<(\d+)", level_action["autoTrigger"])[1])
    for file in sorted((ROOT / "Units/BattleUnits/Pilot/0079/ACE").glob("**/Pilot_*_N_ACE_*.ini")):
        data = load(file)
        core = data["core"]
        ident = core["name"]
        faction = next(tag for tag in core["tags"].split(",") if tag in ("EFSF", "ZEON"))
        init = section(data, "hiddenAction_InitializeStats_PilotSkills")["setUnitMemory"]
        def number(name, default=None):
            match = re.search(r"\b" + name + r"\s*=\s*([\d.]+)", init)
            if not match:
                if default is not None: return default
                raise ValueError(f"Missing {name}: {ident}")
            return float(match[1])
        offers = []
        for offer_file in (ROOT / "Units/Buildings/Beacon_ACE/UnitList").glob("*/Units/ACE/" + ident + ".gw"):
            for key, block in parse(offer_file).items():
                if not re.fullmatch(r"action_" + ident + r"_Produce_Switch_[GS]", key): continue
                # Defines belong to this action; preserve every candidate for audit.
                raw = offer_file.read_text(encoding="utf-8-sig")
                block_text = re.search(r"\[" + re.escape(key) + r"\]([^[]*)", raw)[1]
                values = dict(re.findall(r"@define\s+(Money|Resource|Time)\s*=\s*([\d.]+)", block_text))
                offers.append(dict(money=int(values["Money"]), supplies=int(values["Resource"]), seconds=float(values["Time"]), source=offer_file.relative_to(ROOT).as_posix(), action=key))
        price = min(offers, key=lambda p: (p["money"] + p["supplies"], p["money"], p["supplies"])) if offers else None
        icon = data["graphics"]["icon_build"]
        if not icon.startswith("ROOT:"): raise ValueError(icon)
        shutil.copyfile(ROOT / icon[5:], DEST / (ident + ".png"))
        skills = []
        for key in data:
            if not re.fullmatch(r"action_Pilot_.*_Trigger", key): continue
            skill = section(data, key)
            name = text(skill.get("text_zh", skill.get("text", key))).split("%{")[0].strip()
            skill_icon = skill.get("iconImage", "")
            icon_path = None
            if skill_icon.startswith("ROOT:"):
                target = "ace-skill-" + Path(skill_icon[5:]).name
                shutil.copyfile(ROOT / skill_icon[5:], DEST / target)
                icon_path = "assets/pilots/" + target
            skills.append(dict(id=key[7:], name=name, description=text(skill.get("description_zh", skill.get("description", ""))), icon=icon_path, **skill_runtime(key[7:]), **skill_timing(key[7:]),
                localization={"en":{"name":text(skill.get("text", name)).split("%{")[0].strip(),"description":text(skill.get("description", ""))}}))
        base = {key: number(native, 0) for key, native in STATS.items()}
        comprehension = number("pilotComprehensionSkill")
        aces.append(dict(id=ident, name=re.sub(r"\[[^]]+\]", "", core.get("displayText_zh", core["displayText"])).strip(), faction=faction, era="0079",
            source=file.relative_to(ROOT).as_posix(), icon="assets/pilots/" + ident + ".png",
            description=text(core.get("displayDescription_zh", "")), localization={"en":{"name":re.sub(r"\[[^]]+\]", "", core["displayText"]).strip(),"description":text(core.get("displayDescription", ""))}}, baseStats=base, comprehension=comprehension,
            initialLevel=0, maxLevel=5, growthVersion=2, costBase=100, costPerLevel=50, experienceBase=2000, experienceMultiplier=2,
            nativeGrowth=dict(maxLevel=max_level, experienceBase=number("pilotLevelUpExpNeed"), experienceMultiplier=1.5),
            maxStats={key: value * (comprehension / 100) ** max_level for key, value in base.items()},
            price={key:price[key] for key in ("money","supplies")} if price else None, sourceOffers=offers, skills=skills,
            unlockTech=[n["id"] for n in tree[faction] if ident in n["unlocks"]]))
    path = PROJECT / "shared/pilots.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))
    for ace in aces:
        if ace["id"] == "Pilot_ZEON_0079_N_ACE_CIA": ace["availableFactions"] = ["ZEON", "EFSF"]
    catalog["aces"] = aces
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# ACE驾驶员接入", "", "共40名。当前从0级升至5级，五次升级按几何曲线分配原版满级成长，每项满级上限保持原MOD三次悟性成长的结果。初始100 COST，每级增加50 COST；升级经验为自定义驾驶员对应升级的2倍，依次为2000、4000、8000、16000、32000，超出经验保留。旧版档案按总成长进度迁移，旧满级保留完整属性上限、战绩及重新招募状态。技能已接入，招募不生成信标或附送单位。普通战中所驾机体被击毁后进入待回归，重新招募时保留等级与战绩、清空经验；快速战无损，存档对局不产生损失。名称和头像固定。", "", "价格取同ACE招募方案中资金+物资合计最低者；同价依次比较资金、物资。保留来源方案与原时间。", "", "| ACE | 阵营 | 悟性 | 初始升级经验 | 资金 | 物资 | 技能 |", "| --- | --- | ---: | ---: | ---: | ---: | --- |"]
    for p in aces:
        lines.append(f"| {p['name']} | {p['faction']} | {p['comprehension']} | {p['experienceBase']} | {p['price']['money'] if p['price'] else '—'} | {p['price']['supplies'] if p['price'] else '—'} | {'、'.join(s['name'] for s in p['skills'])} |")
    lines += ["", "没有独立招募报价的5名ACE保留资料，暂不可招募；招募须开发对应科技或通过活动独立解锁；西玛可通过全服累计击坠活动解锁；同一ACE只能持有一份档案，待回归时按资金与物资各半价重新招募，保留等级和战绩、经验清零后恢复配属资格，驾驶员档案全阵营共享，但联邦与吉翁编组只能配属本阵营ACE；PMC可以配属任意ACE；西玛具有EFSF副阵营，也可供联邦编组使用。招募入口始终可打开，未开放候选显示未解锁，阵营与0079年代标识常驻。活动奖励可以独立解锁已有报价但无科技节点的ACE（例如西玛）。", "", "维护入口：`tools/import-ace-pilots.py`；原生等级与成长依据：`Template/Unit/BattleUnit_Framework_Pilot.ini`的`hiddenAction_TryLevelUp`和`hiddenAction_CheckLevelUp`。"]
    lines += ["", "ACE限时技能：持续1回合，效果结束后冷却6个己方回合（15秒=1回合）；两次开启最短间隔7回合。EXAM驾驶员为常驻被动。原秒数保存在技能nativeTiming中，技能机制已启用。主动技能消耗100 EN、0 AP，属性倍率取原MOD，效果覆盖敌方回合；EXAM驾驶员免除EXAM耐久自损，EN与系统持续时间仍正常结算。"]
    (PROJECT / "ACE驾驶员接入.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Imported {len(aces)} ACE profiles; max level 5 (native cap: {max_level} upgrades)")

if __name__ == "__main__": main()
