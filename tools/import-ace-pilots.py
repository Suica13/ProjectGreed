"""Import named ACE pilots and their cheapest beacon offers, never the bundled units."""
import json
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
            skills.append(dict(id=key[7:], name=name, description=text(skill.get("description_zh", skill.get("description", ""))), icon=icon_path, implemented=False,
                localization={"en":{"name":text(skill.get("text", name)).split("%{")[0].strip(),"description":text(skill.get("description", ""))}}))
        base = {key: number(native, 0) for key, native in STATS.items()}
        comprehension = number("pilotComprehensionSkill")
        aces.append(dict(id=ident, name=re.sub(r"\[[^]]+\]", "", core.get("displayText_zh", core["displayText"])).strip(), faction=faction,
            source=file.relative_to(ROOT).as_posix(), icon="assets/pilots/" + ident + ".png",
            description=text(core.get("displayDescription_zh", "")), localization={"en":{"name":re.sub(r"\[[^]]+\]", "", core["displayText"]).strip(),"description":text(core.get("displayDescription", ""))}}, baseStats=base, comprehension=comprehension,
            initialLevel=0, maxLevel=max_level, experienceBase=number("pilotLevelUpExpNeed"), experienceMultiplier=1.5,
            maxStats={key: value * (comprehension / 100) ** max_level for key, value in base.items()},
            price={key:price[key] for key in ("money","supplies")} if price else None, sourceOffers=offers, skills=skills,
            unlockTech=[n["id"] for n in tree[faction] if ident in n["unlocks"]]))
    path = PROJECT / "shared/pilots.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))
    catalog["aces"] = aces
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# ACE驾驶员接入", "", f"共{len(aces)}名。原MOD从0级升至{max_level}级；每次属性乘悟性/100，经验需求乘1.5，超出经验保留。原生没有统一属性硬上限，各项上限是满级成长结果。每级50 COST。技能仅占位，招募不生成信标或附送单位。普通战中所驾机体被击毁后需要重新招募，保留等级、经验、战绩；快速战暂沿用无损规则，存档对局不产生损失。名称和头像固定。", "", "价格取同ACE招募方案中资金+物资合计最低者；同价依次比较资金、物资。保留来源方案与原时间。", "", "| ACE | 阵营 | 悟性 | 初始升级经验 | 资金 | 物资 | 技能占位 |", "| --- | --- | ---: | ---: | ---: | ---: | --- |"]
    for p in aces:
        lines.append(f"| {p['name']} | {p['faction']} | {p['comprehension']} | {p['experienceBase']} | {p['price']['money'] if p['price'] else '—'} | {p['price']['supplies'] if p['price'] else '—'} | {'、'.join(s['name'] for s in p['skills'])} |")
    lines += ["", "没有独立招募报价的5名ACE保留资料，暂不可招募；招募须开发对应科技，CIA无原生科技节点，暂禁招募；同一ACE只能持有一份档案，重新招募恢复配属资格，拥有后全阵营共享。招募界面按当前阵营提供候选，PMC可招募两方。", "", "维护入口：`tools/import-ace-pilots.py`；原生等级与成长依据：`Template/Unit/BattleUnit_Framework_Pilot.ini`的`hiddenAction_TryLevelUp`和`hiddenAction_CheckLevelUp`。"]
    (PROJECT / "ACE驾驶员接入.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Imported {len(aces)} ACE profiles; max level {max_level}")

if __name__ == "__main__": main()
