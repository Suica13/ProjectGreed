const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "assets/unit-catalog.json"), "utf8"));
const units = catalog.units.map((rel) =>
  JSON.parse(fs.readFileSync(path.join(root, "assets", rel), "utf8")),
);
const superseded = (unit, mechanic) => {
  if (/^special_Common_MinovskyParticle_[SM]$/.test(mechanic.id))
    return (unit.skills || []).some((skill) => skill.type === "minovsky");
  if (["Exam_On", "HADES_On", "HADES_PR2_On"].includes(mechanic.id) && unit.formOnly) return true;
  return false;
};
const review = [];
const legacy = [];
for (const unit of units)
  for (const mechanic of unit.mechanics || []) {
    if (mechanic.status !== "review") continue;
    (superseded(unit, mechanic) ? legacy : review).push({
      unit: unit.id,
      id: mechanic.id,
      name: mechanic.name || mechanic.id,
    });
  }
const grouped = (rows) => {
  const result = new Map();
  for (const row of rows) {
    const entry = result.get(row.id) || { name: row.name, units: [] };
    entry.units.push(row.unit);
    result.set(row.id, entry);
  }
  return [...result].sort(([a], [b]) => a.localeCompare(b));
};
const missing = {};
for (const lang of ["zh", "ja", "en"])
  for (const field of ["name", "description"])
    missing[lang + field] = units
      .filter((unit) => !String(unit.localization?.[lang]?.[field] || "").trim())
      .map((unit) => unit.id);
const weapons = units.flatMap((unit) =>
  Object.entries(unit.weapons || {}).map(([id, weapon]) => ({ unit: unit.id, id, weapon })),
);
for (const lang of ["zh", "ja", "en"])
  missing[lang + "WeaponName"] = weapons.filter(
    ({ weapon }) => !String(weapon.localization?.[lang]?.name || "").trim(),
  ).length;
const naming = fs.readFileSync(path.join(root, "武器命名待确认.md"), "utf8");
const uncertain = Number(naming.match(/以下(\d+)个武器ID/)?.[1] || 0);
const lines = [
  "# 单位移植遗漏审计",
  "",
  "> 由 `node tools/audit-unit-migration.cjs` 从当前单位目录生成。`review` 表示原 MOD 来源已经保留，但对应回合制规则尚未接通；`adapted`、`implemented` 与 `not_applicable` 不列为遗漏。",
  "",
  `- 单位预制体：${units.length}`,
  `- 武器配置：${weapons.length}`,
  `- 实际待接机制：${review.length} 条来源记录，共 ${grouped(review).length} 类`,
  `- 已由新实现替代但仍保留的旧来源标记：${legacy.length} 条（不计入遗漏）`,
  "",
  "## 尚未移植的机制",
  "",
  "| 机制 | 显示名 | 单位数 | 涉及单位 |",
  "| --- | --- | ---: | --- |",
  ...grouped(review).map(
    ([id, entry]) =>
      `| ${id} | ${entry.name} | ${entry.units.length} | ${entry.units.join("、")} |`,
  ),
  "",
  "## 已接通但仍保留的旧来源标记",
  "",
  "这些标记用于追溯原 MOD，不代表功能缺失：米诺夫斯基散布已经由 `minovsky` 技能接管；EXAM/HADES 的强化形态自身不再重复提供启动技能。",
  "",
  "| 来源标记 | 单位数 | 涉及单位 |",
  "| --- | ---: | --- |",
  ...grouped(legacy).map(
    ([id, entry]) => `| ${id} | ${entry.units.length} | ${entry.units.join("、")} |`,
  ),
  "",
  "## 缺失或待确认文本",
  "",
  `- 中文：${missing.zhname.length} 个单位名、${missing.zhdescription.length} 个单位介绍缺失。`,
  `- 英文：${missing.enname.length} 个单位名、${missing.endescription.length} 个单位介绍缺失。`,
  `- 日文：${missing.janame.length} 个单位名、${missing.jadescription.length} 个单位介绍缺失；缺失单位名见下方列表。`,
  `- 武器本地化：${missing.zhWeaponName} / ${missing.jaWeaponName} / ${missing.enWeaponName} 条配置分别缺少中/日/英本地化名称；运行时仍有非空的通用显示名作为回退。`,
  `- 武器命名：${uncertain} 个唯一武器 ID 仍使用泛称或占位名，详见《武器命名待确认.md》。`,
  "",
  "### 缺少日文单位名",
  "",
  missing.janame.join("、") || "无",
  "",
  "## 全局战斗载荷仍待实现",
  "",
  "这些项目来自仓库 `TODO.md`，部分原 MOD 武器已经保存对应载荷数据，但规则层尚未结算：",
  "",
  "- 火焰持续伤害。",
  "- 硬直导致 AP 减半。",
  "- 压制导致移动力减半。",
  "- 射击、格斗和指定属性伤害下降。",
  "- 指定防御属性下降。",
  "- 武器穿甲效率。",
  "",
  "## 审计边界",
  "",
  "本报告核对 JSON 状态、技能类型和文本字段。贴图层级、炮口、动画、声音与多人演出仍需在浏览器中逐单位目视验证；自动化通过不能替代全部单位的人工演出检查。",
  "",
];
fs.writeFileSync(path.join(root, "单位移植遗漏审计.md"), lines.join("\n"));
console.log(
  `Wrote 单位移植遗漏审计.md: ${review.length} review records, ${grouped(review).length} kinds, ${legacy.length} superseded markers.`,
);
