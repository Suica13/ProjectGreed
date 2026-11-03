const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const D = require("../shared/development.js");
const research = Object.fromEntries(["EFSF", "ZEON"].map(f => [f, D.nodes(f).map(n => n.id)]));
const modelOf = e => G.formationModel(e);

test("6000/475/32 armies prioritize combat MS, retain fleets and actually load transports", () => {
  for (const faction of ["EFSF", "ZEON"])
    for (let seed = 1; seed <= 32; seed++) {
      const restrictions = { characterFaction: faction, researched: research, unitCostLimit: 475 };
      const army = G.randomFormation(seed, 6000, restrictions, 32);
      assert.deepEqual(army, G.randomFormation(seed, 6000, restrictions, 32));
      assert(G.formationPoints(army) <= 32);
      assert(army.reduce((sum,e) => sum + modelOf(e).cost,0) <= 6000);
      assert(army.every(e => modelOf(e).cost <= 475));
      const msPoints = army.filter(e => modelOf(e).unitTags.includes("MS"))
        .reduce((sum,e) => sum + G.formationWeight(modelOf(e)),0);
      assert(msPoints >= 18, faction + ":" + seed + " needs an MS backbone");
      const fighters = army.filter(e => modelOf(e).unitTags.includes("Aircraft") &&
        !modelOf(e).unitTags.includes("MS") && !modelOf(e).hangars.length);
      assert(fighters.length <= 4);
      const transports = army.map((e,i) => ({e,i})).filter(({e}) =>
        ["Medea","MedeaKai","FatUncle","FatUncleKai"].includes(e.unitId));
      assert(transports.length >= 1, faction + ":" + seed + " logistics");
      for (const {e,i} of transports) {
        const cargo = army.filter(p => p.preload?.carrierIndex === i);
        assert(cargo.length > 0, "transport must not be empty");
        assert(cargo.some(p => modelOf(p).unitTags.includes("MS")));
      }
      G.validateFormation(army,6000,32);
    }
});

test("AI restores fleet slots while honoring small armies and available ship COST", () => {
  assert.equal(G.aiShipQuota(6,1),0);
  assert(G.aiShipQuota(16,1) >= 2);
  for (let seed = 1; seed <= 12; seed++) {
    const army = G.randomFormation(seed,6000,{ characterFaction:"EFSF", researched:research, unitCostLimit:800 },32);
    assert(army.some(e => modelOf(e).ship));
    assert(army.filter(e => modelOf(e).ship).length <= 2);
  }
});

test("transport hull policy and upgraded COST agree for flight and deployed forms", () => {
  const fs = require("node:fs");
  for (const family of ["Medea","MedeaKai","FatUncle","FatUncleKai"])
    for (const suffix of ["","_DeployState"]) {
      const id = family + suffix;
      const raw = JSON.parse(fs.readFileSync(`assets/units/${id}/unit.json`,"utf8"));
      const base = Math.floor(raw.sourceStats.v17BaseHp * 1.25 / 500 + 0.5) * 500;
      const upgraded = family.endsWith("Kai"), factor = upgraded ? 1 : 0.75;
      const models = Object.values(G.models).filter(m => m.prefabId === id);
      assert(models.length > 0);
      assert.equal(raw.sourceStats.transportHullMultiplier,factor);
      for (const m of models) {
        assert.equal(m.hp,Math.ceil(base * factor),id);
        assert.equal(m.cost,upgraded ? 275 : 250,id);
        assert(m.skills.some(s => s.id === "adjacent_en_supply" && s.type === "resupply"),id);
      }
    }
});

test("all deployed transports can use normal cell resupply at zero AP", () => {
  for (const family of ["Medea","MedeaKai","FatUncle","FatUncleKai"]) {
    const [modelId, carrier] = Object.entries(G.models).find(([,m]) => m.prefabId === family + "_DeployState");
    const entry = { unitId:"RGM_79",kitId:"machine_gun" };
    const game = G.create(false,3,[[entry,entry],[entry]],false,{fogMode:"disabled"});
    game.tiles.forEach(row => row.fill("plain"));
    const [a,b] = game.units;
    Object.assign(a,{model:modelId,x:8,y:8,hp:carrier.hp,en:carrier.en,actionPoints:0,acted:false});
    Object.assign(b,{x:9,y:8,en:0});
    const before = a.en;
    const event = G.useSkill(game,a,"adjacent_en_supply",9,8);
    assert.equal(event.targets.length,1);
    assert.equal(b.en,G.modelOf(b).en * 0.5);
    assert.equal(a.en,before - Math.ceil(before * 0.1));
    assert.equal(a.actionPoints,0);
    assert.throws(() => G.useSkill(game,a,"adjacent_en_supply",9,8));
  }
});
