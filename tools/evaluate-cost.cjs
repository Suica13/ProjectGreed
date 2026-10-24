/* COST 估算工具：复用实战命中、逐发防护和盾牌规则，不改变战斗随机数。 */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const G = require("../shared/rules.js");
const distanceWeights = [0.22, 0.17, 0.16, 0.14, 0.11, 0.09, 0.07, 0.04];
// 平台战力继续估算供参考；发布的套件费用使用统一类别定价，不覆盖机体基础 COST。
const costBalance = require("./cost-balance.json");
const kitCosts = require("../assets/weapon-kit-costs.json");
const costStep = G.catalog.formation.costStep;
// 每种机体等权，所有套件都进入武器威胁池，避免只用旧吉姆估价。
const targets = G.catalog.prefabs.map((p) => p.id + "__" + p.weaponKits[0].id);
const threats = Object.values(G.models).flatMap((m) =>
  m.weapons.map((w) => [
    m.prefabId + "__" + m.kitId,
    w.id,
    1 /
      G.catalog.prefabs.length /
      G.catalog.prefabs.find((p) => p.id === m.prefabId).weaponKits.length /
      m.weapons.length,
  ]),
);
// 枚举每段命中/未命中/格挡分支，合并盾牌剩余值，求整次攻击的期望 HP 损伤。
// 不截断到目标 HP；估算满盾目标的第一轮交火，不代替长期实战胜率。
function expectedVolley(attackerId, defenderId, weapon, distance) {
  if (distance < weapon.min || distance > weapon.max) return 0;
  return [
    ["plain", 0.8],
    ["forest", 0.2],
  ].reduce((total, [terrain, weight]) => {
    const a = { model: attackerId, x: 0, y: 0 },
      b = {
        model: defenderId,
        x: distance,
        y: 0,
        shield: G.models[defenderId].shield.hp,
      };
    const g = { tiles: [Array(10).fill(terrain)] };
    let states = new Map([[b.shield, 1]]),
      damage = 0;
    for (const strike of weapon.attack.strikes) {
      const next = new Map(),
        single = { ...weapon, attack: { strikes: [strike] } };
      const add = (shield, probability) => next.set(shield, (next.get(shield) || 0) + probability);
      for (const [shield, probability] of states) {
        const e = G.estimate(g, a, { ...b, shield }, single),
          hit = e.hit / 100;
        const block = e.blockChance,
          blocked = probability * hit * block;
        damage += probability * hit * ((1 - block) * e.damage + block * e.blockedDamage);
        add(shield, probability * (1 - hit * block));
        if (blocked) add(shield - e.shieldDamage, blocked);
      }
      states = next;
    }
    return total + damage * weight;
  }, 0);
}
function score(modelId) {
  const model = G.models[modelId];
  const offense = distanceWeights.reduce((sum, weight, index) => {
    const distance = index + 1;
    const best = Math.max(
      0,
      ...model.weapons.map(
        (w) =>
          (targets.reduce(
            (total, target) => total + expectedVolley(modelId, target, w, distance),
            0,
          ) /
            targets.length) *
          (0.7 + 0.3 * Math.min(1, 15 / w.en)),
      ),
    );
    return sum + weight * best;
  }, 0);
  const incoming = threats.reduce((sum, [id, weaponId, weight]) => {
    const w = G.models[id].weapons.find((w) => w.id === weaponId);
    return sum + weight * expectedVolley(id, modelId, w, w.min);
  }, 0);
  const raw = threats.reduce(
    (sum, [id, weaponId, weight]) =>
      sum + weight * G.models[id].weapons.find((w) => w.id === weaponId).damage,
    0,
  );
  const effectiveHp = (model.hp * raw) / incoming;
  const value = Math.sqrt(offense * effectiveHp) * Math.pow(model.move / 5, 0.65);
  return { offense, effectiveHp, value };
}
const metrics = Object.fromEntries(Object.keys(G.models).map((id) => [id, score(id)]));
const platformValues = Object.fromEntries(
  G.catalog.prefabs.map((prefab) => {
    const values = prefab.weaponKits.map((kit) => metrics[prefab.id + "__" + kit.id].value);
    return [
      prefab.id,
      0.75 * Math.max(...values) +
        (0.25 * values.reduce((sum, value) => sum + value, 0)) / values.length,
    ];
  }),
);
const baseline = platformValues.MS_06F;
const rows = Object.keys(G.models).map((id) => {
  const value = 0.8 * platformValues[G.models[id].prefabId] + 0.2 * metrics[id].value;
  const prefabId = G.models[id].prefabId;
  const band = costBalance[prefabId];
  if (
    !band ||
    ![band.anchor, band.min, band.max].every(
      (value) => Number.isInteger(value) && value > 0 && value % costStep === 0,
    ) ||
    band.min > band.anchor ||
    band.anchor > band.max
  )
    throw Error("缺少或无效的 COST 档位: " + prefabId);
  const estimatedCost = Math.max(
    costStep,
    Math.round((200 * value) / baseline / costStep) * costStep,
  );
  const platformEstimate = Math.max(
    band.min,
    Math.min(
      band.max,
      Math.round((band.anchor * value) / platformValues[prefabId] / costStep) * costStep,
    ),
  );
  const prefab = G.catalog.prefabs.find((prefab) => prefab.id === prefabId);
  const surcharge = kitCosts[G.models[id].kitId];
  if (!Number.isInteger(surcharge) || surcharge < 0 || surcharge % costStep !== 0)
    throw Error("缺少或无效的武器套件 COST: " + G.models[id].kitId);
  return {
    id,
    ...metrics[id],
    estimatedCost,
    platformEstimate,
    cost: prefab.stats.cost + surcharge,
  };
});
if (require.main === module) {
  console.table(
    rows.map((row) => ({
      unit: row.id,
      expectedDamage: Math.round(row.offense),
      effectiveHP: Math.round(row.effectiveHp),
      rawEstimate: row.estimatedCost,
      cost: row.cost,
    })),
  );
  if (process.argv.includes("--write")) {
    for (const prefab of G.catalog.prefabs) {
      const file = path.join(__dirname, "../assets/units", prefab.id, "unit.json");
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      for (const kit of raw.weaponKits) kit.cost = kitCosts[kit.id];
      fs.writeFileSync(file, JSON.stringify(raw, null, 2) + "\n");
    }
    const lines = rows.map(
      (row) =>
        "| " +
        G.models[row.id].code +
        " / " +
        G.models[row.id].kitName +
        " | " +
        Math.round(row.offense) +
        " | " +
        Math.round(row.effectiveHp) +
        " | " +
        row.cost +
        " |",
    );
    fs.writeFileSync(
      path.join(__dirname, "../单位COST估算.md"),
      [
        "# V05 单位 COST 估算",
        "",
        "运行 node tools/evaluate-cost.cjs 查看战力估算与当前定价；加 --write 只按 assets/weapon-kit-costs.json 统一套件附加费，并更新本报告，不改机体基础 COST。",
        "",
        "发布 COST = unit.json 的 stats.cost + 武器套件附加费。机枪（含对空机枪）+0；火箭筒、导弹发射器（含双联装大枪）+50；光束喷枪、光束枪+75；光束步枪、加农炮系+100。固定和副武器包含在机体基础 COST，不重复加价。机体基础 COST 保持现值；数学期望与 tools/cost-balance.json 中的档位只用于参考。默认编组5000 COST、单机1000 COST、9台；房主可设置3～12台及禁用标签，AI使用相同的最终套件 COST 生成合法编组。进入房间前本地编组预算无限。",
        "",
        "## 计算假设",
        "",
        "- 交战距离1～8格权重依次为22%、17%、16%、14%、11%、9%、7%、4%；地形80%平地、20%林地。",
        `- 对手均匀取全部${G.catalog.prefabs.length}种机体。每个距离只选择一把期望伤害最高的合法武器，计入固定武装的覆盖范围。`,
        "- 逐段枚举命中与格挡，沿用游戏的机动性、防御、伤害加成及盾牌损耗；不将格挡当成固定减伤，不把军刀第二段当作全伤害。",
        "- 火力按70%短期爆发、30%按每回合15 EN恢复估算的续航加权。",
        "- 耐久威胁池覆盖全部机体、套件与武器：机体等权，机体内部套件等权，套件内部武器等权。有效耐久=HP×平均原始伤害/平均期望HP损伤，已计入盾牌、命中率与地形。",
        "- 套件战力=sqrt(加权期望伤害×有效耐久)×(移动力/5)^0.65。平台值=75%最强套件+25%套件均值；套件计价值=80%平台值+20%套件自身战力。原始期望估值=200×计价值/扎古ⅡF平台值，仅作参考。最终COST=平台设计锚点×计价值/本平台值，四舍五入到25并限制在设计档位内。档位体现单位定位，套件相对溢价由期望值决定。",
        "",
        "移动力只影响移动范围及估值的位置收益；机动性只通过命中公式影响生存能力。大魔为移动7格、机动85，不能用移动力推导回避能力。",
        "",
        "所有机体均为默认2次反击，反击上限暂未另设溢价。估算使用普通应战、满盾开始的一轮交火；不是无限回合或所有站位的精确胜率，后续应结合实战调整。",
        "",
        "| 单位 / 套件 | 加权期望伤害 | 估算有效耐久 | COST |",
        "| --- | ---: | ---: | ---: |",
        ...lines,
        "",
      ].join("\n"),
    );
  }
}
module.exports = { score, expectedVolley, rows };
