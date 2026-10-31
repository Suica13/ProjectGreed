const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");

function fixture(id = "RX_78_2") {
  const m = Object.values(G.models).find(m => m.prefabId === id && m.weapons.some(w => w.pilotRequirements?.length));
  const g = G.create(false, 1, [[{unitId:id,kitId:m.kitId}], [{unitId:"RGM_79",kitId:"machine_gun"}]], false,
    {costLimit:99999,unitCostLimit:99999});
  g.tiles.forEach(row => row.fill("plain"));
  g.fogMode = "disabled";
  const [u,target] = g.units;
  Object.assign(u, {x:10,y:10,en:100000,actionPoints:99,pilot:{stats:Object.fromEntries(Object.keys(G.pilots.baseStats()).map(key => [key,200]))}});
  Object.assign(target, {x:11,y:10,hp:1000000,shield:0});
  return {g,u,target,w:m.weapons.find(w => w.pilotRequirements?.length)};
}

test("duplicate gated weapons cannot be queued for attacks, counters or separate targets", () => {
  const {g,u,target,w}=fixture();
  assert(G.canUse(u,w));
  assert.throws(() => G.attackQueue(g,u,target,[w,w]), /每回合只能使用一次/);
  assert.throws(() => G.counterQueue(g,u,target,[w,w]), /每回合只能使用一次/);
  const other={...target,id:"other",x:10,y:11};g.units.push(other);
  assert.throws(() => G.counterPlan(g,u,[{targetId:target.id,weaponIds:[w.id]},{targetId:other.id,weaponIds:[w.id]}]), /每回合只能使用一次/);
  const planner=createAttackPlanner(G,()=>"id"),room={game:g};planner.reset(room);
  planner.plan(room,u,target,[w],0);
  assert.throws(() => planner.plan(room,u,other,[w],0), /每回合只能使用一次/);
  planner.cancel(room,u);
  assert(G.canUse(u,w));
  assert.doesNotThrow(() => planner.plan(room,u,other,[w],0));
});

test("an entire salvo executes once, then blocks reuse until the next phase; snapshots preserve usage", () => {
  for(const id of ["RX_78_2","MAN_08"]) {
    const {g,u,target,w}=fixture(id);
    const events=G.fight(g,u,target,w,"evade",null,false);
    assert.equal(events[0].strikes.length,G.availableStrikes(u,w,target).length);
    assert.equal(u.pilotWeaponTurnUses[w.id],1);
    assert(!G.canUse(u,w));
    assert(!G.canUse(JSON.parse(JSON.stringify(u)),w));
    assert(!G.canCounter(g,u,target,w));
    G.end(g);
    assert(G.canUse(u,w));
  }
});

test("HADES conversion preserves spent pilot-weapon uses", () => {
  const {g,u,w}=fixture("RX_80PR");
  G.recordPilotWeaponUse(u,w);
  G.useSkill(g,u,"HADES",u.x,u.y);
  assert.equal(u.pilotWeaponTurnUses[w.id],1);
});
