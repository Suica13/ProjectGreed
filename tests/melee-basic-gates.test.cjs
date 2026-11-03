const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules.js"), Classes = require("../shared/weapon-classes.js");
const fs = require("node:fs"), Store = require("../tools/weapon-store.cjs");

test("one ordinary melee remains ungated even with extra melee or a native gated move", () => {
  for (const unitId of ["RX_78_2","RX_78_3","MS_07B"]) {
    const models = Object.values(G.models).filter(m => m.prefabId === unitId);
    for (const m of models) {
      const melee = m.weapons.filter(w => w.type === "melee" && Classes.classify(w) !== "ram");
      assert(melee.some(w => !w.pilotRequirements?.length),m.prefabId + ":" + m.kitId);
    }
  }
  const gundam = G.models.RX_78_2__kit_1;
  assert.equal(gundam.weapons.find(w => w.id === "EF_BeamSaber_AF_Fast_A").pilotRequirements,undefined);
  assert.deepEqual(gundam.weapons.find(w => w.id === "EF_BeamSaber_Double_AALDF").pilotRequirements,
    [{ stat:"melee",operator:">",value:145 }]);
  const gouf = Object.values(G.models).find(m => m.prefabId === "MS_07B");
  assert.equal(gouf.weapons.find(w => w.id === "ZN_HeatSword_A").pilotRequirements,undefined);
  assert.deepEqual(gouf.weapons.find(w => w.id.includes("HeatRod")).pilotRequirements,
    [{ stat:"melee",operator:">=",value:125 }]);
});

test("ram is never counted as a second ordinary melee, and native gates are unchanged", () => {
  const raw = new Map(); let checked = 0;
  for (const m of Object.values(G.models)) {
    if (!raw.has(m.prefabId)) raw.set(m.prefabId,
      Store.parse(fs.readFileSync(`assets/units/${m.prefabId}/unit.json`,"utf8")));
    const melee = m.weapons.filter(w => w.type === "melee" && Classes.classify(w) !== "ram");
    if (melee.length === 1 && !raw.get(m.prefabId).weapons[melee[0].id]?.pilotRequirements?.length) {
      assert.equal(melee[0].pilotRequirements,undefined,m.prefabId + ":" + melee[0].id);
      checked++;
    }
    for (const w of melee) {
      const source = raw.get(m.prefabId).weapons[w.id];
      if (source?.pilotRequirements?.length) assert.deepEqual(w.pilotRequirements,source.pilotRequirements);
    }
    for (const w of m.weapons.filter(w => Classes.classify(w) === "ram"))
      assert(!w.pilotRequirements?.length,m.prefabId);
  }
  assert(checked > 100);
});


test("ordinary pilots counter with a usable sword after skipping a gated utility whip", () => {
  const entry = {unitId:"RGM_79",kitId:"machine_gun"};
  const game = G.create(false,1,[[entry],[entry]],false,{fogMode:"disabled"});
  game.tiles.forEach(row => row.fill("plain"));
  const [a,b] = game.units;
  const model = Object.keys(G.models).find(id => G.models[id].prefabId === "MS_07B");
  Object.assign(a,{x:5,y:5,en:10000});
  Object.assign(b,{model,x:6,y:5,en:10000});
  const available = require("../shared/automatic-fire.js").weapons(G,game,b,a,true);
  assert(available.some(w => w.id === "ZN_HeatSword_A"));
  assert(!available.some(w => w.id.includes("HeatRod") || Classes.classify(w) === "ram"));
});
