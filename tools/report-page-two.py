"""Generate the second-page migration list from registered prefabs and original tech links."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json
from collections import Counter, defaultdict
from pathlib import Path
from mod_source import ASSETS

read=lambda path:load_source_json(Path(path).read_text(encoding="utf-8-sig"))

def cell(value):return str(value).replace("|","\\|").replace("\n"," ")

def main():
    rows=read("tools/0079-page-two-manifest.json")
    catalog=read(ASSETS/"unit-catalog.json")
    prefabs={p["id"]:p for p in (read(ASSETS/ref) for ref in catalog["units"])}
    tree=read("shared/development-tree.json")
    nodes={node["id"]:node for group in tree.values() for node in group}
    production=read("shared/production-catalog.json")
    audit=read("tools/0079-page-two-audit.json")
    imported=sum(prefabs[row["id"]].get("sourceStats",{}).get("importedTechPage")==1 for row in rows)
    eras=Counter(prefabs[row["id"]]["sourceStats"]["technologyEra"] for row in rows)
    lines=["# 0079 第二页单位移植清单", "",
        "生成命令：`python tools/report-page-two.py`。范围来自原 MOD 两阵营 `TechTree_UI_Page_*_0079_01.ini`，不是按模型目录猜测。", "",
        f"第二页共 **{len(rows)} 个独立作战单位**：新增基础机体 {imported} 个，复用既有机体 {len(rows)-imported} 个；另接入苍白骑兵宇宙型 HADES 专用形态。新增科技 20 项（每阵营 10 项），目录合计 {len(prefabs)} 个预制体。", "",
        "## 年代与开发规则", "",
        "- 第一页单位标为 `0079E`，第二页单位标为 `0079L`；两页共用同一机体时采用最早出现的年代，不复制库存。",
        "- 星辰作战与联邦 GP 计划所解锁的单位标为 `0083`，仍在第二页科技树中显示。",
        "- 第二页科技树入口目前暂时隐藏，单位、科技数据及原 MOD 跨页前置关系保留；已有研究存档保留原科技 ID。",
        "- 科技点消费、资金与物资消费已接通；科技资金／物资为原 MOD 的两倍，原研究时间保存在 sourceCosts.researchSeconds，本版不等待计时。",
        "- GP02 仅使用一个单位及库存条目，两阵营分别完成各自科技后均可生产、编组。",
        "- EN 沿用原值的50%；HP沿用现有1.25倍并按500取整政策；武器载荷、原生发数与消费保留来源，射程/AP沿用项目武器政策，舰船命中沿用0.9倍。", "",
        "第二页条目年代统计："+"，".join(f"{era}：{count}" for era,count in sorted(eras.items()))+"。", "",
        "## 科技连接", "", "资金在前，物资在后；价格为本项目实际消费。", "",
        "| 阵营 | 科技 | 前置科技 | 科技点 | 资金 / 物资 | 原研究秒数 |", "|---|---|---|---:|---:|---:|"]
    for faction,group in tree.items():
        for node in group:
            if node.get("page")!=1:continue
            requires="、".join(nodes[id]["name"] for id in node["requires"])
            lines.append("| "+" | ".join(map(cell,[faction,node["name"],requires,node["points"],f"{node['money']} / {node['supplies']}",node["sourceCosts"]["researchSeconds"]]))+" |")
    lines += ["", "## 作战单位", "", "价格是最便宜素体每批的工厂价格；武器套件按单台差价计算后按该单位生产批量购买。复用条目保留已有机体属性修改。", "",
        "| 单位ID | 名称 | 阵营 | 年代 | COST起 | 每批 | 资金 / 物资 | 解锁科技 | 接入 |", "|---|---|---|---|---:|---:|---:|---|---|"]
    review=defaultdict(set)
    for row in rows:
        prefab=prefabs[row["id"]]
        offer=production["offers"][production["baseModels"][prefab["id"]]]
        status="新增" if prefab.get("sourceStats",{}).get("importedTechPage")==1 else "复用"
        for mechanic in prefab.get("mechanics",[]):
            if mechanic["status"]=="review":review[prefab["id"]].add(mechanic.get("name",mechanic["id"]))
        if review[prefab["id"]]:status+="；含待适配机制"
        values=[f"[{prefab['id']}](assets/units/{prefab['id']}/unit.json)",prefab["name"]," / ".join(prefab.get("availableFactions",[prefab.get("faction",row["faction"])])),prefab["sourceStats"]["technologyEra"],prefab["stats"]["cost"]+min(k["cost"] for k in prefab["weaponKits"]),offer["quantity"],f"{offer['money']} / {offer['supplies']}","、".join(nodes[id]["name"] for id in row["tech"]),status]
        lines.append("| "+" | ".join(map(cell,values))+" |")
    lines += ["", "## 待适配的原 MOD 机制", "",
        "基础移植包括素材、可读取的骨骼动画、武器流程、炮口、弹体、音效与现有回合规则。以下原 RTS 机制保留 review 标识，不视作已经实现；普通移动和可用武装仍可使用。", "",
        "GP02核弹原生消费600 EN，超过本项目减半后的475 EN容量；比格扎姆环射光束流程也需单独适配。这些武装保留原数据并隐藏，不用伪造低消费或扩大容量来绕过校验。", "",
        "| 单位 | 待适配机制 |", "|---|---|"]
    for ident,names in review.items():
        if names:lines.append("| "+cell(ident)+" | "+cell("；".join(sorted(names)))+" |")
    unavailable=[key for key in production["unavailable"] if key.rsplit("__",1)[0] in {row["id"] for row in rows}]
    lines += ["", "## 无独立工厂价格的武器套件", "",
        "所有第二页基础机体都有生产方案。以下额外套件未找到对应的原工厂价格，不凭空定价；不影响其素体生产：", ""]
    lines += ["- `"+key+"`" for key in unavailable]
    excluded=read("tools/0079-page-two-import-report.json")["excluded"]
    grouped=defaultdict(list)
    for row in excluded:grouped[row["tech"]].append(row["id"])
    lines += ["", "## 未作为机体导入的原科技条目", "", "建筑、炮台、雷达与ACE驾驶员不作为独立机体导入，以下保留来源记录。", "", "| 科技 | 原始条目ID |", "|---|---|"]
    for ident,ids in grouped.items():lines.append("| "+cell(nodes[ident]["name"])+" | "+cell("、".join(dict.fromkeys(ids)))+" |")
    lines += ["", "## 共享动画与检查范围", "",
        "- 动画按原动作名称保存；同名且内容相同的动作共用文件。同名差异使用来源单位后缀，不使用数字哈希作为文件名。",
        "- `tools/animation_pool.py` 维护动画引用；构建时 `shared/asset-pool.js` 对相同动画和武器内容再次去重，保留单位专属炮口、部位和套件差异。",
        f"- 原生源数据审计：{audit['units']} 个新增机体、{audit['weapons']} 份武器配置，差异 {len(audit['errors'])} 项；详见 tools/0079-page-two-audit.json。",
        "- 资源加载器检查注册、素材路径、骨骼、武器步骤、形态引用与有效套件。自动检查不等于所有单位均已逐一完成实机视觉和完整对局验收。", ""]
    Path("0079第二页移植清单.md").write_text("\n".join(lines),encoding="utf-8")
    print("Wrote 0079第二页移植清单.md:",len(rows),"units,",sum(bool(names) for names in review.values()),"units with review mechanics")


if __name__=="__main__":main()
