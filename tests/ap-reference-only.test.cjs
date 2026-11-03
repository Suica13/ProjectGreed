const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const Conversion = require("../shared/conversion-rules.cjs");
const Records = require("../shared/match-records.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");
const Classes = require("../shared/weapon-classes.js");
function fixture() {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const game = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  game.tiles.forEach(row => row.fill("plain"));
  const [a,b] = game.units;
  Object.assign(a,{x:5,y:5,en:10000}); Object.assign(b,{x:6,y:5,en:10000});
  return {game,a,b};
}
test("AP reference data exists without AP conversion settings, budgets or runtime balances",()=>{
  const config = Conversion.read();
  assert(!("machineGunAP" in config.weapons));
  assert(!("ap" in config.weapons)); assert(!("ap" in config.units));
  for(const group of Object.values(config.weaponClasses)) {
    assert(!("ap" in group)); assert(!("baseAP" in group));
  }
  for(const name of ["actionPoints","actionBudget","counterActionBudget","actionCost","attackBudget","fireAPCost","fireAPBudget"])
    assert.equal(G[name],undefined,name);
  const {game,a,b}=fixture();
  assert(Number.isInteger(G.modelOf(a).actionPoints));
  assert(G.modelOf(a).weapons.every(w=>Number.isInteger(w.actionCost)));
  assert(game.units.every(u=>!("actionPoints" in u)));
  const plan=G.firePlan(game,a,b);
  assert(plan.weapons.length>0); assert(!("ap" in plan)); assert(!("budget" in plan));
  const room={game,plans:[],planSequence:0};
  const order=createAttackPlanner(G).plan(room,a,b,[],0);
  assert(!("apCost" in order)); assert(!("actionCost" in order));
  assert(!("actionCost" in a.plan));
  G.end(game); G.end(game);
  assert(game.units.every(u=>!("actionPoints" in u)));
});
test("reference AP cannot change firing and pilot mobility changes only movement",()=>{
  const {game,a,b}=fixture();
  const original=G.firePlan(game,a,b).weapons.map(w=>w.id);
  const model=G.models[a.model], saved=model.weapons.map(w=>w.actionCost);
  try {
    model.weapons.forEach(w=>w.actionCost=99999);
    assert.deepEqual(G.firePlan(game,a,b).weapons.map(w=>w.id),original);
  } finally {model.weapons.forEach((w,i)=>w.actionCost=saved[i]);}
  const pilot=G.pilots.createCustom("custom-ap-reference","Reference");
  a.pilot=pilot;
  const before=G.modelOf(a);
  a.pilot={...pilot,stats:{...pilot.stats,speed:180}};
  const after=G.modelOf(a);
  assert(after.move>before.move);
  assert.equal(after.actionPoints,before.actionPoints);
  assert(!("actionPointsMultiplier" in G.pilots.modifiers(a,model)));
});
test("AP-only debuffs are absent while armor-piercing channels and ship traits remain",()=>{
  for(const prefab of G.catalog.prefabs) assert(!(prefab.skills||[]).some(s=>s.type==="emp"));
  const weapons=Object.values(G.models).flatMap(m=>m.weapons);
  assert(weapons.every(w=>!("onHitAPLoss" in w)));
  assert(weapons.some(w=>w.damageComponents?.beamAP>0));
  assert(weapons.some(w=>w.damageComponents?.shellAP>0));
  assert(weapons.some(w=>Classes.shipCannon(w,w.shipWeapon)));
});
test("battle save round-trip accepts new units without a remaining-AP field",()=>{
  const {game}=fixture();
  const settings={...G.defaultRoomSettings(),mapId:game.mapId};
  const room={game,settings,seats:Array(G.getMap(game.mapId).spawns.length).fill(null)};
  const saved=Records.createSave(G,room);
  const restored=Records.validateSave(G,saved);
  assert.equal(restored.game.units.length,game.units.length);
  assert(restored.game.units.every(u=>!("actionPoints" in u)));
});
