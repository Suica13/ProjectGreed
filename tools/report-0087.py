"""Generate the 0087 import inventory and explicit conversion gap audit from current JSON."""
import collections, json, re, sys
from pathlib import Path
from weapon_store import loads
ROOT = Path(__file__).resolve().parents[1]
def read(file): return loads((ROOT / file).read_text(encoding="utf8"))
def suggestion(ident):
    if "remote_" in ident: return "单独适配反射／转送型浮游炮：中继点与射线分段判定；不可直接套普通浮游炮的单元弹头。"
    if "Transform" in ident: return "导入原生飞行形态与回退形态，沿用显式transform/source、套件映射和部位继承；校验空域适应与搭载限制。"
    if "ReEntry" in ident: return "战略地球／宇宙跨区移动时校验再入资格与助推器；局地战不执行RTS跨图动作。"
    if ident == "ABC": return "抗光束涂层独立耐久，按原MOD范围与系数吸收光束；不要直接复用永久SP减伤。"
    if "ALICE" in ident: return "独立系统技能，按原触发条件切换驾驶辅助、持续回合、冷却及结束恢复；与ACE增益叠加规则单列。"
    if ident == "SFS_2X": return "将双乘坐点映射为两格SFS槽位；当前单槽SFS的容量、座标、攻击选择面板需扩展。"
    if "DogFight" in ident: return "由机动技能处理转向／闪避演出；保留原生触发参数并重新制定回合制费用。"
    if "MineLauncher" in ident: return "新增持续地雷实体／区域，进入时触发、可见性与寿命由服务端维护。"
    if "DetectArea" in ident: return "转为指定区域持续侦察；明确范围、持续回合、隐形探测等级与费用。"
    if "CustomUnit" in ident: return "补齐专用形态与对应0087 ACE后，沿用自动特殊变换；普通改装只提供部署许可来源。"
    if "Fly" in ident: return "校验飞行类别与搭载形态的转换，保留移动类型与适应性条件。"
    return "核对原生条件、动作和资源，再映射现有回合制机制；未实现前保留review标记。"
def main():
    sys.stdout.reconfigure(encoding="utf8")
    rows=read("tools/0087-manifest.json"); tree=read("shared/development-tree.json"); production=read("shared/production-catalog.json")
    report=read("tools/0087-import-report.json")
    prefabs={r["id"]:read("assets/units/"+r["id"]+"/unit.json") for r in rows}
    native=[r for r in rows if prefabs[r["id"]]["source"].startswith("GW_BattleUniverse_DLC_0087/")]
    lines=["# 0087单位与科技树移植清单", "", f"科技目录引用{len(rows)}种战斗单位，其中{len(native)}种使用0087来源，其余沿用已有0079／0083机体与人工配置。", "", "## 固定规则", "", "- 完成地球联邦军0079科技树中间主线后开放奥古、提坦斯；完成吉翁公国军0079科技树中间主线后开放新吉翁。主线包含两页的中间节点，不要求上下支线。", "- 未达门槛时，科技树及单位详情显示黑色遮罩，并明确提示所需前置阵营的主线。0093地球联邦军需要奥古或提坦斯任一完整主线；0093新吉翁需要新吉翁完整主线。", "- 第二页首项恢复原MOD的10800科技点需求，原值保留在sourceCosts.points中；其余资金、物资沿用原MOD的两倍。", "- 单位套件沿用原生EquipmentIndex 0；部署许可及原生工厂整批／单机／换装费用独立归档，不恢复个人套件库存。", "- 不支持的机制显式标记review；原MOD只读，正常构建无需原MOD。", "", "## 第二页首项科技需求", "", "| 阵营 | 科技 | 原科技点 | 当前科技点 |", "|---|---|---:|---:|"]
    for f in ("AEUG","TITANS","NEO_ZEON"):
        n=next(n for n in tree[f] if n.get("era") == "UC_0087_T2")
        lines.append(f"| {f} | {n['id']} · {n['name']} | {n['sourceCosts']['points']} | {n['points']} |")
    lines += ["", "## 单位索引", "", "| ID | 中文名称 | 可用阵营 | 年代 | 套件数 | 部署许可：资金／物资 |", "|---|---|---|---|---:|---|"]
    for r in rows:
        p=prefabs[r['id']];price=production['licenseOffers'].get(r['id']); label=f"{price['money']} / {price['supplies']}" if price else "无法购买／形态或条件限定"
        era=next((t for t in p['tags'] if re.fullmatch(r"(?:\d{4}(?:T[12])?|(?:UC|CE)_\d{4}_T\d+)",t)),"")
        lines.append(f"| {r['id']} | {p['name']} | {', '.join(p.get('availableFactions',[next(t for t in p['tags'] if t in ('EFSF','ZEON','AEUG','TITANS','NEO_ZEON'))]))} | {era} | {len(p['weaponKits'])} | {label} |")
    (ROOT/'docs/imports/0087-units.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
    gaps=collections.defaultdict(list)
    for r in native:
        for m in prefabs[r['id']].get('mechanics',[]):
            if m.get('status')=='review': gaps[m['id']].append(r['id'])
    lines=["# 0087缺失机制与转换建议", "", "此表由当前JSON生成，列出未接入机制；资源校验通过不代表这些机制已实现。已接入的普通武装、浮游炮／INCOM、装甲、指挥光环等继续使用共享规则。", "", "## 未接入机制", "", "| 原生机制 | 适用单位 | 转换建议 |", "|---|---|---|"]
    for ident, ids in sorted(gaps.items()):lines.append(f"| {ident} | {', '.join(sorted(set(ids)))} | {suggestion(ident)} |")
    lines += ["", "## 科技中非战斗单位／未移植对象", "", "包含建筑、信标与0087 ACE；本轮不新增0087 ACE招募数据，这些科技项目显示尚未接入。建议后续按ACE原报价、悟性和技能单独移植，建筑改为模式设施而非可部署机体。", "", "| ID | 科技来源 | 原因 |", "|---|---|---|"]
    for row in report['excluded']:lines.append(f"| {row['id']} | {row['tech']} | {row['reason']} |")
    deferred = read("tools/0087-deferred-content.json")
    lines += ["", "## 未注册衍生形态与科技树外内容", "", "以下对象尚未注册到可玩目录。再入辅助对象无需照搬成独立战棋单位；变形、系统和收纳形态应在对应机制接通时导入并映射。科技树外机型需补充明确的开发／特殊变换来源，ACE需单独移植招募数据。", "", "| ID | 名称 | 类型 | 原MOD文件 |", "|---|---|---|---|"]
    for item in deferred: lines.append(f"| {item['id']} | {item['name']} | {item['reason']} | {item['source']} |")
    lines += ["", "## 复核边界", "", "- 自动校验覆盖目录引用、科技前置与门槛、价格、AP／射程换算及编辑器数据作用域。", "- 大型MA、变形机、复杂背包与多炮塔的逐机视觉、枪口、音效及实际多人交战仍需人工试玩；不得仅凭导入成功宣称全部还原。", "", "重新生成：`python tools/report-0087.py`。"]
    (ROOT/'docs/imports/0087-gaps.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
    print(len(rows),'units;',len(gaps),'review mechanism groups;',len(report['excluded']),'non-combat unlock references')
if __name__=='__main__':main()
