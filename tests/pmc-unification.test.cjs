const test = require("node:test"),
  assert = require("node:assert/strict");
const E = require("../shared/economy.js"),
  C = require("../shared/campaign.js"),
  G = require("../shared/rules.js"),
  D = require("../shared/development.js");
const ctx = {
  G,
  world: G.catalog.scenarios.earth_0079_mid.world,
  production: require("../shared/production-data.cjs"),
  development: D,
};
const members = [{ seat: 0 }, { seat: 1 }];

test("all strategic production uses the PMC single-unit price and bounded source-derived duration", () => {
  for (const prefab of G.catalog.prefabs) {
    for (const kit of prefab.weaponKits) {
      const expected = E.productionOffer(prefab.id, kit.id),
        actual = C.quote(ctx, prefab.id, kit.id);
      assert.deepEqual(actual, expected, prefab.id + "__" + kit.id);
      if (!actual) continue;
      assert.equal(actual.quantity, 1);
      assert(actual.turns >= 1 && actual.turns <= 5);
    }
  }
  assert.equal(E.productionTiming("Type61").turns, 1);
  assert.equal(E.productionTiming("Medea").secondsPerTurn, 20);
  assert.equal(E.productionTiming("Medea").turns, 2);
  const fake = {
    productionSecondsPerTurn: 30,
    offers: { A__k: { quantity: 3, source: { buildSeconds: 270, queueSeconds: 0 } } },
  };
  assert.equal(E.productionTiming("A", "k", fake).turns, 3);
  fake.offers.A__k.source.buildSeconds = 1000;
  assert.equal(E.productionTiming("A", "k", fake).turns, 5);
});

test("campaign equipment switches freely without stock or resource changes",()=>{
 const s=C.create(ctx,members), pool=s.teams[0];
 pool.researched=D.nodes("EFSF").map(n=>n.id);
 const unit=C.addUnit(ctx,s,0,"jaburo","RGM_79"), old=unit.kitId;
 const money=pool.money,supplies=pool.supplies;
 for(const kitId of ["bazooka",old,"bazooka"]){
   C.action(ctx,s,members,0,{action:"campaign_equip",turn:1,armyId:unit.id,kitId});
   assert.equal(unit.kitId,kitId);assert.equal(pool.money,money);assert.equal(pool.supplies,supplies);
 }
 assert.deepEqual(C.validate(ctx,s,members).teams[0].kits,{});
});
