const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const D = require("../shared/development.js");
const bans = require("../shared/ai-unit-bans.json");
const research = Object.fromEntries(["EFSF", "ZEON", "AEUG", "TITANS", "NEO_ZEON"].map(f => [f, D.nodes(f).map(n => n.id)]));
const player = {seat: 1, characterFaction: "PMC", researched: research, licenses: {MS_06C: true}};
const entries = Object.entries(G.models).filter(([,m]) => m.prefabId === "MS_06C").map(([,m]) => ({unitId:m.prefabId, kitId:m.kitId}));

test("AI exclusion configuration contains valid unique unit IDs for both ordinary modes", () => {
  assert(entries.length > 0);
  for (const mode of ["regular", "quick"]) {
    assert(bans[mode].includes("MS_06C"));
    assert.equal(new Set(bans[mode]).size, bans[mode].length);
    for (const id of bans[mode]) assert(G.catalog.prefabs.some(p => p.id === id), id);
  }
});

for (const mode of ["regular", "quick"]) {
  test(`${mode} excludes every MS-06C kit from AI plans without restricting human or campaign units`, () => {
    const settings = {...G.defaultRoomSettings(), mode, costLimit:99999, unitCostLimit:99999};
    const bot = G.armyRestrictions(settings, {...player, bot:true});
    const human = G.armyRestrictions(settings, player);
    const strategic = G.armyRestrictions({...settings, mode:"campaign"}, {...player, bot:true});
    for(const entry of entries) {
      const m=G.models[entry.unitId+"__"+entry.kitId];
      assert.equal(G.restrictionReason(m,bot),"not_allowed");
      assert.equal(G.restrictionReason(m,human),null);
      assert.equal(G.restrictionReason(m,strategic),null);
    }
    const plan=G.planFormation(entries,99999,bot,72);
    assert.equal(plan.deployable.length,0);
    assert(Object.values(plan.reasons).every(reason=>reason==="not_allowed"));
    const all={...G.models};
    try {
      for(const [id,m] of Object.entries(G.models)) if(m.prefabId!=="MS_06C") delete G.models[id];
      for(const seed of [1,7,7319]) assert.deepEqual(G.randomFormation(seed,99999,bot,12),[]);
      assert(G.randomFormation(7319,99999,{characterFaction:"PMC",researched:research},12).length>0);
    } finally { Object.assign(G.models,all); }
  });
}
