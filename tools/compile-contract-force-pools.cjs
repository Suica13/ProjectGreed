"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  root = path.resolve(__dirname, "..");
const names = [
  ["61式主战坦克A5型", "Type61A5"],
  ["飞鳐", "FF_B2"],
  ["迪普罗格", "DEPP_ROG"],
  ["吉姆初期型", "RGM_79_E"],
  ["陆战型吉姆", "RGM_79_G"],
  ["陆战型吉姆[武器货柜]", "RGM_79_G_WithBackpack"],
  ["吉姆狙击型", "RGM_79_G_SP"],
  ["量产型钢坦克", "RX_75R"],
  ["陆战型高达", "RX_79_G"],
  ["陆战型高达[武器货柜]", "RX_79_G_WithBackpack"],
  ["吉姆", "RGM_79"],
  ["吉姆[指挥官机]", "RGM_79_Commander"],
  ["钢加农", "RX_77_2"],
  ["钢坦克", "RX_75"],
  ["高达", "RX_78_2"],
  ["扎古2F", "MS_06F"],
  ["扎古2S", "MS_06S"],
  ["马哲兰坦克", "MTank"],
  ["多普", "Dopp"],
  ["战斗直升机[ZEON]", "ZN_Heli"],
  ["水中型扎古", "MS_06M"],
  ["扎古2J", "MS_06J"],
  ["扎古加农", "MS_06K"],
  ["战蟹", "MSM_03"],
  ["龟霸", "MSM_04"],
  ["扎古沙漠型", "MS_06D"],
  ["老虎B型", "MS_07B"],
  ["老虎特装型", "MS_07B3"],
  ["扎古2陆战型高机动型", "MS_06G"],
  ["扎古2F2后期型", "MS_06F2"],
  ["扎古2F2后期型[指挥官机]", "MS_06F2_Commander"],
  ["大魔", "MS_09"],
  ["大魔热带式样", "MS_09D"],
  ["扎古半加农", "MS_06JK"],
  ["扎古狙击型", "MS_05SP"],
  ["米迪亚", "Medea"],
  ["米迪亚改", "MedeaKai"],
  ["胖叔叔", "FatUncle"],
  ["胖叔叔改", "FatUncleKai"],
];
const aliases = Object.fromEntries(names),
  weights = { 主力: 8, "主力／常规": 8, 常规辅助: 4, 部分: 4, 少数: 1, 极少数: 0.25 };
function compile(text, { minimum = 1 } = {}) {
  const levels = Object.fromEntries(
    Array.from({ length: 7 - minimum }, (_, i) => [i + minimum, { formations: [], garrisons: {}, waves: {} }]),
  );
  let section,
    level,
    weight = 8,
    qualityMultiplier = 1,
    event,
    trigger;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("## ")) {
      section = line.slice(3);
      event = trigger = null;
      continue;
    }
    const heading = /^### N([1-6])$/.exec(line);
    if (heading) {
      level = levels[heading[1]];
      event = trigger = null;
      weight = 8;
      qualityMultiplier = 1;
      continue;
    }
    if (!level || !["巡逻队", "驻军", "特殊事件"].includes(section)) continue;
    if (section === "巡逻队") {
      const quality = /^精锐编队权重倍率 ([\d.]+)$/.exec(line);
      if (quality) {
        qualityMultiplier = Number(quality[1]);
        if (!(qualityMultiplier >= 1 && qualityMultiplier <= 2)) throw Error("Invalid quality multiplier");
        continue;
      }
      if (weights[line] !== undefined) {
        weight = weights[line];
        continue;
      }
      const m = /^(.*?)\s+(\d+)$/.exec(line);
      if (!m || Number(m[2]) < 25 || Number(m[2]) % 25) throw Error("Invalid formation: " + line);
      const units = m[1].split(/[ /]+/).flatMap((token) => {
        const q = /^(.*?)[xX](\d+)$/.exec(token),
          name = q ? q[1] : token;
        const unitId = aliases[name] || (/^[A-Za-z][A-Za-z0-9_]*$/.test(name) ? name : null);
        if (!unitId) throw Error("Unknown force-pool unit: " + name);
        const count = Number(q?.[2] || 1);
        if (count < 1 || count > 60) throw Error("Invalid formation quantity: " + token);
        return Array(count).fill(unitId);
      });
      level.formations.push({ label: m[1], units, budget: Number(m[2]), weight: weight <= 1 ? weight * qualityMultiplier : weight });
      continue;
    }
    const type = /(salvage|command|factory|capture|upload|radar|defend):?$/.exec(line);
    if (type) {
      event = type[1];
      trigger = "first";
      continue;
    }
    const total = /^合计(\d+)$/.exec(line);
    if (total) {
      if (!event) throw Error("Missing event: " + line);
      if (section === "驻军") level.garrisons[event] = Number(total[1]);
      else level.waves[event + "." + trigger] = Number(total[1]);
      continue;
    }
    const transport = /^(.+?)x(\d+)\s+([\d/]+)$/.exec(line);
    if (transport) {
      const budgets = transport[3].split("/").map(Number),
        unitId = aliases[transport[1]] || (/^[A-Za-z][A-Za-z0-9_]*$/.test(transport[1]) ? transport[1] : null);
      if (!unitId || budgets.length !== Number(transport[2]))
        throw Error("Invalid transport wave: " + line);
      level.transports = { unitId, budgets };
      continue;
    }
    trigger = line.includes("周期性边缘")
      ? "edge"
      : line.includes("后续攻击")
        ? "followup"
        : line.includes("空降")
          ? "airdrop"
          : "first";
  }
  for (const [n, d] of Object.entries(levels))
    if (
      !d.formations.length ||
      Object.keys(d.garrisons).length !== 6 ||
      Object.keys(d.waves).length !== 7 ||
      !d.transports
    )
      throw Error("Incomplete N" + n);
  return levels;
}
function generate({ check = false } = {}) {
  const data = { version: 1, era: "UC_0079_T1", environment: "ground", factions: {} };
  for (const f of ["EFSF", "ZEON"])
    data.factions[f] = compile(
      fs.readFileSync(
        path.join(root, `docs/design/contract-force-pools-${f.toLowerCase()}-0079t1.md`),
        "utf8",
      ),
    );
  data.eras = {CE_0071_T1:{environment:"ground", factions:{}}};
  for (const faction of ["OMNI", "ZAFT"])
    data.eras.CE_0071_T1.factions[faction] = compile(fs.readFileSync(
      path.join(root, `docs/design/contract-force-pools-${faction.toLowerCase()}-ce0071t1.md`), "utf8"), {minimum:2});
  const output = JSON.stringify(data, null, 2) + "\n",
    target = path.join(root, "shared/contract-force-pools.json");
  if (check) {
    if (fs.readFileSync(target, "utf8") !== output)
      throw Error("Contract force-pool data is stale");
  } else fs.writeFileSync(target, output);
  return data;
}
module.exports = { compile, generate };
if (require.main === module) {
  generate({ check: process.argv.includes("--check") });
  console.log("Contract force pools: EFSF/ZEON N1-N6 and OMNI/ZAFT N2-N6 checked.");
}
