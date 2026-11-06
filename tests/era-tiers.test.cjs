const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const tree = require("../shared/development-tree.json");

test("technology pages determine T1/T2, sharing earliest unlock and inheriting derived forms", () => {
  const earliest = new Map();
  for (const nodes of Object.values(tree)) for (const node of nodes) {
    if (node.id.includes("_0087_")) assert.equal(node.era, node.page ? "0087T2" : "0087T1");
    for (const id of node.unlocks) {
      const old = earliest.get(id);
      if (!old || node.era < old) earliest.set(id, node.era);
    }
  }
  for (const p of G.catalog.prefabs) {
    const tags = p.tags.filter(t => /^\d{4}(?:T[12])?$/.test(t));
    assert.equal(tags.length, 1, p.id);
    assert(!p.tags.some(t => ["0079E", "0079L", "0087"].includes(t)), p.id);
    if (!tags[0].startsWith("0087")) continue;
    const parent = [...earliest.keys()].sort((a,b) => b.length-a.length).find(id => p.id.startsWith(id+"_"));
    assert.equal(tags[0], earliest.get(p.id) || earliest.get(parent), p.id);
  }
  assert(G.catalog.prefabs.find(p=>p.id==="MSZ_006").tags.includes("0087T2"));
  assert(G.catalog.prefabs.find(p=>p.id==="RMS_179_AEUG").tags.includes("0087T1"));
});

test("legacy era restrictions retain their coverage", () => {
  assert.deepEqual(G.validateTagRestrictions({bannedEras:["0079E","0079L","0087"]}).bannedEras,
    ["0079T1","0079T2","0087T1","0087T2"]);
  for (const old of ["0079E", "0079L", "0087"]) {
    const current = G.validateTagRestrictions({bannedEras:[old]});
    for (const model of Object.values(G.models))
      assert.equal(G.restrictionReason(model,{bannedEras:[old]}),G.restrictionReason(model,current),model.id);
  }
});
