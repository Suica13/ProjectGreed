const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const G = require("../shared/rules.js"), E = require("../shared/economy.js");
const tree = require("../shared/development-tree.json");
const starter = require("../shared/starter-profile.json");
test("fresh profile has doubled wallet and five complete configured formations of chassis and kits", () => {
  const initial=E.initial();
  assert.equal(initial.money,10000); assert.equal(initial.supplies,20000);
  assert.deepEqual(initial.inventory,{FatUncle:5,MS_06S:5,MS_06F:10,Medea:10,Type61:30,FF_B2:15,FF_S3:15});
  assert.equal(initial.kits.MS_06F__machine_gun,10);assert.equal(initial.kits.MS_06F__bazooka,undefined);
  assert.equal(Object.values(initial.kits).reduce((a,b)=>a+b,0),90);
  const five=Array.from({length:5},()=>starter.units).flat();
  assert.equal(E.stockPlan(five,initial).missing.length,0);
  assert.ok(E.stockPlan([...five,...starter.units],initial).missing.length>0);
});
test("starter formation preserves each carrier and passenger index and fits the actual hangars", () => {
  const entries=E.starterFormation();
  assert.equal(entries.length,18);
  assert.deepEqual(entries.filter(u=>!u.preload).map(u=>u.unitId),['FatUncle','Medea','Medea']);
  assert.deepEqual(entries.filter(u=>u.preload).map(u=>u.preload.carrierIndex),[0,0,0,4,4,4,4,4,4,11,11,11,11,11,11]);
  assert.equal(entries[3].kitId,'machine_gun');
  assert.equal(G.validateFormation(entries,Infinity,G.catalog.formation.maxUnits).length,18);
  assert.equal(G.formationPoints(entries),21);
  const plan=G.planFormation(entries,Infinity,{licenses:E.initial().licenses,...E.normalizeStock(E.initial())});
  assert.equal(plan.indices.length,18);
  assert.equal(plan.totalCost,2000);
  for(const index of [0,4,11]) {
    const carrier=G.models[entries[index].unitId+'__standard'];
    const passengers=entries.filter(u=>u.preload?.carrierIndex===index);
    const points=passengers.reduce((sum,u)=>sum+G.formationPoints([u]),0);
    assert.equal(points,carrier.hangars[0].capacity);
  }
  entries[1].preload.carrierIndex=99;
  assert.equal(E.starterFormation()[1].preload.carrierIndex,0);
});
test("all deployable base-tech units are licensed across factions without granting old saves starter stock or money", () => {
  const old=E.validate({schemaVersion:3,money:123,supplies:456,licenses:{RGM_79:true},inventory:{Type61:2},kits:{Type61__standard:1}});
  for(const id of Object.values(tree).flatMap(nodes=>nodes.filter(n=>/BaseTech$/i.test(n.id)).flatMap(n=>n.unlocks)).filter(id=>Object.hasOwn(E.catalog.baseModels,id))) assert.equal(old.licenses[id],true,id);
  assert.equal(old.licenses.RGM_79,true);assert.equal(old.money,123);assert.equal(old.supplies,456);
  assert.deepEqual(old.inventory,{Type61:2});assert.deepEqual(old.kits,{Type61__standard:1});
  assert.equal(old.inventory.Medea,undefined);
});
