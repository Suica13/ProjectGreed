const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),vm=require("node:vm"),G=require("../shared/rules");
function output(id,kit,distance) {
  const game=G.create(false,1,[[{unitId:id,kitId:kit}],
    [{unitId:"RGM_79",kitId:"machine_gun"}]],false,
    {costLimit:99999,unitCostLimit:99999,fogMode:"disabled"});
  game.tiles.forEach(row=>row.fill("plain"));game.deployment=null;
  const [actor,target]=game.units;
  Object.assign(actor,{x:5,y:5});Object.assign(target,{x:5+distance,y:5});
  const plan=G.firePlan(game,actor,target);
  return {actor,game,plan,damage:plan.weapons.reduce((total,w)=>total+
    Object.values(w.damageComponents).reduce((sum,n)=>sum+n,0)*
    w.attack.strikes.reduce((sum,strike)=>sum+(strike.damageMultiplier??1),0),0)};
}
test("full-armament ACE caps its general-pilot peak at 125 percent with rounded 125 percent COST",()=>{
  const normal=output("RX_78_2","kit_1",1),ace=output("RX_78_2_ACE","standard",1);
  assert.equal(normal.damage,27900);
  assert.equal(ace.damage,34875);
  assert.equal(ace.damage,normal.damage*1.25);
  for(const distance of [2,3])assert(output("RX_78_2_ACE","standard",distance).damage<=normal.damage*1.25);
  assert.equal(G.modelOf(ace.actor).cost,Math.round(G.modelOf(normal.actor).cost*1.25/25)*25);
  assert.equal(G.modelOf(ace.actor).cost,1100);
  assert(ace.plan.weapons.some(w=>w.id==="EF_RX_78_2_BR"));
  assert.equal(ace.plan.weapons.filter(w=>w.id==="EF_HypeBazooka_ACE").length,2);
  assert(ace.plan.weapons.some(w=>w.id==="EF_SHM_ACE"));
  assert.equal(G.modelOf(ace.actor).weapons.find(w=>w.id==="EF_HypeBazooka_ACE").shotCount,3);
});
test("owned Gundam+B parts is independently selectable and passes authoritative formation validation",()=>{
  const id="RX_78_2_BPart",prefab=G.catalog.prefabs.find(p=>p.id===id);
  const entry={unitId:id,kitId:prefab.weaponKits[0].id};
  assert.equal(prefab.formOnly,false);
  assert.deepEqual(G.validateFormation([entry],99999),[entry]);
  const plan=G.planFormation([entry],99999,{characterFaction:"PMC",ownedStock:{inventory:{[id]:1}},environment:"ground"});
  assert.equal(Object.keys(plan.reasons).length,0);
  const context=vm.createContext({Rules:G,I18n:{language:"zh"}});
  vm.runInContext(fs.readFileSync("client/unit-catalog.js","utf8")+";globalThis.catalogUI=UnitCatalog;",context);
  assert(context.catalogUI.select("RX_78_2_BPart",{},()=>true).some(p=>p.id===id));
  assert.equal(require("../shared/economy").productionOffer(id,entry.kitId),null);
});
