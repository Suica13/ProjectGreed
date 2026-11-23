const test = require("node:test");
const assert = require("node:assert/strict");
const P = require("../shared/pilots");
const T = require("../shared/pilot-talents");
const G = require("../shared/rules");
const fresh = (id = "custom-talent-test") => P.createCustom(id, "测试", P.catalog.portraits[0].id);
function pair() {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 123, [[entry], [entry]], false, { fogMode: "disabled" });
  g.tiles.forEach((row) => row.fill("plain"));
  const [a, b] = g.units;
  Object.assign(a, { x: 2, y: 3, pilot: null });
  Object.assign(b, { x: 4, y: 3, pilot: null });
  return { g, a, b, w: { ...G.modelOf(a).weapons[0], hitScale: 0.4 } };
}
const assign = (unit, ids) =>
  (unit.pilot = { ...fresh(), talents: ids, talentSlotsUnlocked: ids.length });
test("level four and the first two reincarnations grant at most three persistent talents", () => {
  assert.equal(T.catalog.length, 45);
  let p = fresh();
  assert.equal(p.talents.length, 0);
  assert.equal(p.talentSlotsUnlocked, 0);
  assert.deepEqual(P.custom(p).talents, p.talents);
  const old = { ...p, level: 3, experience: 100000 };
  delete old.talents;
  delete old.talentSlotsUnlocked;
  p = P.upgrade(old);
  assert.equal(p.level, 4);
  assert.equal(p.talents.length, 1);
  const first = [...p.talents];
  assert.deepEqual(P.demote(p).talents, first);
  p = P.custom({ ...p, level: 6 });
  assert.deepEqual(p.talents, first);
  for (let rebirth = 1; rebirth <= 4; rebirth++) {
    const before = [...p.talents];
    p = P.reincarnate(P.custom({ ...p, level: P.maxLevel(p) }));
    assert.equal(p.level, 0);
    assert.equal(p.talents.length, Math.min(3, rebirth + 1));
    assert.deepEqual(p.talents.slice(0, before.length), before);
    assert.equal(new Set(p.talents).size, p.talents.length);
    assert.deepEqual(P.custom(JSON.parse(JSON.stringify(p))).talents, p.talents);
  }
  const legacy = { ...old, level: 0, reincarnations: 1 };
  assert.equal(P.custom(legacy).talents.length, 2);
  assert.equal(P.custom({ ...legacy, reincarnations: 2 }).talents.length, 3);
  assert.equal(P.custom({ ...old, level: 6 }).talents.length, 1);
  assert.equal(P.custom({ ...old, level: 0 }).talents.length, 0);
  const previousSave = { ...fresh(), talents: ["pt01", "pt02"], talentSlotsUnlocked: 2 };
  assert.deepEqual(P.custom(previousSave).talents, previousSave.talents);
  assert.throws(() => T.normalize(["pt01", "pt02", "pt03", "pt04"]));
  assert.throws(() => P.custom({ ...fresh(), talentSlotsUnlocked: 4 }));
  assert.throws(() => T.normalize(["pt01", "pt01"]));
  assert.throws(() => T.normalize(["bad"]));
  assert.deepEqual(T.of({ ace: true, talents: ["pt01"] }), []);
});
test('old custom pilots reroll once into the positive/tradeoff pool and retain their other data',()=>{
 for(const ids of [['pt05'],['pt24','pt48'],['pt49','pt50','pt01'],['pt01','pt02']]){
  const previous={...fresh('custom-legacy-'+ids.join('-')),talents:ids,talentSlotsUnlocked:ids.length,
   record:{kills:13,shipKills:2,battles:7,losses:1},personality:'custom',background:'keep this'};
  delete previous.talentPoolVersion;
  const migrated=P.custom(previous);
  assert.equal(migrated.talents.length,ids.length);
  assert.equal(migrated.talentPoolVersion,T.poolVersion);
  assert(migrated.talents.every(id=>T.catalog.some(t=>t.id===id)));
  assert.equal(new Set(migrated.talents).size,ids.length);
  for(const key of ['id','name','level','experience','stats','record','points','personality','background','portraitId'])
   assert.deepEqual(migrated[key],previous[key]);
  assert.deepEqual(P.custom(JSON.parse(JSON.stringify(migrated))).talents,migrated.talents);
  assert.deepEqual(P.custom(previous).talents,migrated.talents,'retrying a migration is stable');
  assert.deepEqual(migrated.talents,T.fill({...previous,talents:[]},ids.length),'all legacy rolls use the new pool');
 }
 assert.throws(()=>P.custom({...fresh(),talents:['unknown']}));
 const data=require('../shared/pilot-talents.json');
 assert(!data.some(t=>['pt05','pt24','pt48','pt49','pt50'].includes(t.id)));
});

test("all active talent effects have valid numeric values and known activation conditions", () => {
  const contexts = [
    {},
    {
      unit: { hp: 10 },
      maxHP: 100,
      target: { hp: 10 },
      targetMaxHP: 100,
      attack: true,
      isCounter: true,
      defender: true,
      response: "defend",
      weapon: { type: "melee" },
      distance: 1,
      squadCount: 3,
      night: true,
      environment: "ground",
    },
    {
      unit: { hp: 80 },
      maxHP: 100,
      target: { hp: 80 },
      targetMaxHP: 100,
      defender: true,
      response: "evade",
      weapon: { type: "ranged", category: "cannon" },
      distance: 5,
      squadCount: 1,
      environment: "space",
    },
    ...["missile", "sniper", "bazooka"].map((category) => ({
      weapon: { type: "ranged", category },
      environment: "water",
    })),
  ];
  for (const t of T.catalog) {
    const p = { custom: true, talents: [t.id] };
    assert(
      contexts.some((c) => Object.keys(T.effects(p, c)).length),
      t.name,
    );
    for (const value of Object.values(t.effects)) assert(Number.isFinite(value));
  }
});
test("aura gate, role defaults, native override, fixed range and strongest wins", () => {
  const { g, a, b } = pair();
  b.team = a.team;
  b.x = 3;
  assign(a, []);
  a.pilot.stats.leadership = 100;
  assert.equal(G.commandAura(a).active, false);
  a.pilot.stats.leadership = 101;
  assert.equal(G.commandAura(a).active, true);
  assert.equal(G.commandAura(a).radius, 2);
  assert.deepEqual(G.commandKinds({ combatRole: "support" }), [{ type: "cmdCom" }]);
  assert.deepEqual(G.commandKinds({ combatRole: "general" }), [{ type: "cmdDef" }]);
  assert.deepEqual(G.commandKinds({ combatRole: "raid" }), [{ type: "cmdAtk" }]);
  assert.deepEqual(G.commandKinds({ combatRole: "normal", commandAuras: [{ type: "cmdAtk" }] }), [
    { type: "cmdAtk" },
  ]);
  const first = G.commandEffects(g, b);
  g.units.push({
    ...a,
    id: "copy",
    pilot: { ...a.pilot, stats: { ...a.pilot.stats, leadership: 150 } },
  });
  const next = G.commandEffects(g, b);
  const kind = Object.keys(first).find((key) => first[key] > 0);
  assert.equal(first[kind], 0.1);
  assert(Math.abs(next[kind] - 0.15) < 1e-8);
});
test("talents change actual forecast, contextual effects and EN without repeated application", () => {
  const { g, a, b, w } = pair();
  assign(a, []);
  assign(b, []);
  const base = G.estimate(g, a, b, w);
  a.pilot.talents = ["pt04"];
  assert(G.estimate(g, a, b, w).damage > base.damage);
  a.pilot.talents = ["pt02"];
  assert(G.estimate(g, a, b, w).hit > base.hit);
  a.pilot.talents = ["pt21"];
  assert.equal(G.estimate(g, a, b, w).damage, base.damage);
  assert(G.estimate(g, a, b, w, "counter", true).damage > base.damage);
  a.pilot.talents = [];
  b.pilot.talents = ["pt06"];
  assert(G.estimate(g, a, b, w).damage < base.damage);
  a.pilot.talents = ["pt10"];
  const energy = { ...w, en: 100 };
  const once = G.weaponStats(energy, a);
  assert.equal(once.en, 95);
  assert.equal(G.weaponStats(once, a).en, 95);
  a.pilot.talents = ["pt48"];
  assert.equal(G.weaponStats(once, a).en, 100, 'retired negative talent no longer penalizes EN');
});
