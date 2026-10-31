"use strict";
const fs = require("node:fs");
const path = require("node:path");
const G = require("../shared/rules.js");
const units = [...G.catalog.prefabs].sort(
  (a, b) => a.stats.actionPoints - b.stats.actionPoints || a.id.localeCompare(b.id),
);
const low = units.filter((p) => p.stats.actionPoints < 10);
const restricted = [];
for (const p of units) {
  const entries = new Map();
  for (const model of Object.values(G.models).filter((m) => m.prefabId === p.id))
    for (const w of model.weapons)
      if (
        w.actionCost >
        G.modelOf({
          id: "audit",
          model: model.prefabId + "__" + model.kitId,
          pilot: { stats: G.pilots.baseStats() },
        }).actionPoints
      )
        entries.set(w.id, {
          name: w.name,
          ap: w.actionCost,
          kind: w.slot === "skill" ? "技能武器" : "普通武器",
        });
  for (const s of p.skills || [])
    if ((s.actionCost || 0) > p.stats.actionPoints)
      entries.set("skill:" + s.id, { name: s.name, ap: s.actionCost, kind: "主动技能" });
  if (entries.size) restricted.push({ p, entries: [...entries.values()] });
}
const lines = [
  "# 单位行动力与机动换算",
  "",
  "由 `node tools/report-action-mobility.cjs` 根据当前单位目录生成。",
  "",
  "## 当前规则",
  "",
  "- 普通单位基础AP：`max(10, 10 + round(2 × log2(baseTurnSpeed / 1.75)))`。round按JavaScript四舍五入处理。最低10 AP，支持原有5 AP武器翻倍后的10 AP费用。",
  "- 战舰固定10 AP，不套用MS的转向速度尺度。部署形态沿用未部署形态的转向速度，防止部署后因原生转向降速而无法攻击。其他变形、EXAM/HADES形态按各自原生转向速度换算，变形当回合不免费恢复AP。",
  "- 机体机动力：`round5(100 × boostMoveSpeed / 1.4)`；只使用常规推进速度，不使用闪避推进或临时推进加速。",
  "- 机体机动以100点为基准，每完整50点增减1格移动距离（向零取整），机体AP倍率为 `max(1,1+(机动-100)×0.005)`。驾驶员机动以100为基准，每点使移动倍率变化0.5%、AP倍率变化0.4%，倍率至少0.5；最终AP按0.5点四舍五入，移动保留小数预算，两者均不影响回避。机体基本移动格数已扣除机体机动格数，保持此次修改前的无驾驶员总移动距离。",
  "- 反应继续控制回避。武器AP通常乘2；头部火神炮及腕部枪炮最终固定3 AP、射程1–2，优先于通用换算。其他普通最大射程+1，狙击与蓄力最大射程+2，最小射程不变。迫击炮基础命中×1.10；火箭筒伤害×1.25，不叠加光束步枪×1.5。EN与发数不变。",
  "- 新对局使用新AP；已有对局存档中的当前剩余AP保留，下次己方回合恢复时采用当前规则。低于100机动会按比例降低驾驶员最终AP，基础10 AP下限不限制这种驾驶员减益。",
  "",
  "## AP分布",
  "",
  "| 基础AP | 单位及形态数量 |",
  "|---:|---:|",
];
const counts = {};
for (const p of units) counts[p.stats.actionPoints] = (counts[p.stats.actionPoints] || 0) + 1;
for (const [ap, count] of Object.entries(counts)) lines.push(`| ${ap} | ${count} |`);
lines.push(
  "",
  `## AP低于10：${low.length}个单位或形态`,
  "",
  "部署形态单列，避免遗漏；低AP不一定是错误，但需要结合武装和定位审核。",
  "",
  "| 单位 | ID | 计算用原生转向 | AP |",
  "|---|---|---:|---:|",
);
for (const p of low)
  lines.push(
    `| ${p.name} | ${p.id} | ${p.sourceStats.actionTurnSpeed} | ${p.stats.actionPoints} |`,
  );
lines.push(
  "",
  `## 武装或技能费用超过基础AP：${restricted.length}个单位或形态`,
  "",
  "以下项目按当前规则无法支付。这里只报告冲突，没有自动提高单位AP或降低技能费用。此表按100机动驾驶员的基础预算审核；驾驶员机动可按比例增减最终AP，反应不影响AP。",
  "",
  "| 单位 | ID | AP | 无法支付的项目 |",
  "|---|---|---:|---|",
);
for (const { p, entries } of restricted)
  lines.push(
    `| ${p.name} | ${p.id} | ${p.stats.actionPoints} | ${entries.map((e) => `${e.name}（${e.ap} AP，${e.kind}）`).join("、")} |`,
  );
lines.push(
  "",
  restricted.length
    ? "以上费用冲突需要逐项复核。"
    : "当前没有因基础AP不足而无法支付的已配置武装或技能；照射、迫击炮与冲撞等武器按翻倍后的费用审查。",
  "",
);
fs.writeFileSync(path.resolve(__dirname, "../单位行动力与机动换算.md"), lines.join("\n"));
console.log(
  `AP report: ${units.length} units/forms, ${low.length} below 10 AP, ${restricted.length} with unaffordable actions.`,
);
