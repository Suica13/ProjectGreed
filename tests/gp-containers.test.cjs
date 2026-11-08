const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules"), { createAttackPlanner } = require("../shared/attack-plans");
function fixture(key = "EF_GP_03D_MSL_AMS", unitId = "RX_78GP03D") {
  const model = Object.values(G.models).find(m => m.prefabId === unitId && m.weapons.some(w => w.id === key));
  const weapon = model.weapons.find(w => w.id === key);
  const game = G.create(false, 417, [
    [{ unitId, kitId: model.kitId }],
    Array.from({ length: 4 }, () => ({ unitId: "RGM_79", kitId: "machine_gun" })),
  ], false, { fogMode: "disabled", costLimit: 99999, unitCostLimit: 99999 });
  const [a, ...enemies] = game.units;
  G.models.gp_container_attacker = { ...model, weapons: [weapon], partsBreakable: false, modules: [] };
  const target = G.modelOf(enemies[0]);
  G.models.gp_container_target = { ...target, hp: 1000000, partsBreakable: false, modules: [], skills: [], weapons: [],
    shield: { ...target.shield, hp: 0 } };
  Object.assign(a, { model: "gp_container_attacker", x: 3, y: 8, hp: 1000000, en: 5000, shield: 0 });
  enemies.forEach((e,i) => Object.assign(e, { model: "gp_container_target", x: 8, y: 8,
    squadId: "cargo-targets", squadSlot: i, hp: 1000000, shield: 0, en: 0 }));
  game.deployment = null;
  game.tiles.forEach(row => row.fill("plain"));
  const room = { game, matchId: "gp-containers" };
  let id = 0;
  const planner = createAttackPlanner(G, () => "gp-" + ++id);
  planner.reset(room);
  const intent = { attacker: a.id, target: enemies[0].id, weapon: key, weapons: [key],
    targetSquad: enemies.map(e => e.id) };
  return { game, room, a, enemies, weapon, intent, planner, randomId: () => "gp-" + ++id };
}
test("AMS containers fire the native 72+72 missiles, randomize each missile and pay EN once", () => {
  const f = fixture();
  assert.deepEqual([f.weapon.damagePerShot, f.weapon.hit, f.weapon.shotCount, f.weapon.maxUsesPerTurn], [450,75,144,1]);
  const battles = G.resolveAutomatic(f.room, [{ intent: f.intent, response: "defend" }], f.randomId);
  const events = battles.flatMap(b => b.events).filter(e => e.from === f.a.id);
  assert.equal(events.reduce((sum,e)=>sum+e.shotIndices.length,0), 144);
  assert(new Set(events.map(e => e.to)).size > 1, "Every missile draws its own random target");
  assert(events.every(e => e.containerCell.x === 9 && e.containerCell.y === 8));
  assert.equal(new Set(events.map(e => e.containerSalvoId)).size, 1);
  assert.equal(f.a.en, 4750);
  assert.equal(f.a.weaponTurnUses[f.weapon.id], 1);
  assert(!G.canAttack(f.game, f.a, f.enemies[0], f.weapon));
  G.end(f.game); G.end(f.game);
  assert(!f.a.weaponTurnUses?.[f.weapon.id]);
});
test("nuclear container fires exactly three separately timed 3x3 blasts, including diagonals", () => {
  const f = fixture("EF_GP_03D_MSL_ASP");
  assert.deepEqual([f.weapon.damagePerShot,f.weapon.hit,f.weapon.shotCount,f.weapon.slot], [10000,60,3,"skill"]);
  Object.assign(f.enemies[1], { x:9, y:9, squadId:null });
  Object.assign(f.enemies[2], { x:7, y:7, squadId:null });
  Object.assign(f.enemies[3], { x:10, y:8, squadId:null });
  const intent = { ...f.intent, cellBlast:true, impactCell:{x:8,y:8}, blastId:"nuclear-cargo", targetSquad:[f.enemies[0].id] };
  const battles = G.resolveAutomatic(f.room, [{ intent, response:"defend" }], f.randomId);
  const events = battles.flatMap(b => b.events).filter(e => e.from === f.a.id);
  assert.equal(new Set(events.map(e => e.blastId)).size, 3, "Do not suppress all three explosions as one blast");
  assert.equal(new Set(events.map(e => e.impactAt)).size, 3);
  for (const enemy of f.enemies.slice(0,3)) assert.equal(events.filter(e => e.to === enemy.id).length, 3);
  assert(!events.some(e => e.to === f.enemies[3].id));
  assert.equal(f.a.en, 4750);
  assert.equal(f.a.weaponTurnUses[f.weapon.id], 1);
  assert.equal(G.weaponCooldown(f.a, f.weapon), 3);
  assert(!G.canUse(f.a, f.weapon));
  for (const remaining of [2, 1, 0]) {
    G.end(f.game);
    assert.equal(G.weaponCooldown(f.a, f.weapon), remaining + 1, "Enemy turns do not tick the cooldown");
    G.end(f.game);
    assert.equal(G.weaponCooldown(f.a, f.weapon), remaining);
    assert.equal(G.canUse(f.a, f.weapon), remaining === 0);
  }
});
test("GP02A nuclear bombardment is equipped, uses nuclear effects/range and has one lifetime use", () => {
  const f = fixture("EF_RX_78GP02A_Bombing_Nuke", "RX_78GP02A");
  assert.equal(f.weapon.special.type,"nuke");
  assert.equal(f.weapon.hitEffect,"Nuke_Hit_1");
  assert.equal(f.weapon.slot,"skill"); assert.equal(f.weapon.maxUses,1);
  assert(!f.weapon.availability?.hidden);
  assert(G.canAttack(f.game,f.a,f.enemies[0],f.weapon));
  G.spendWeapon(f.a,f.weapon);
  assert.equal(f.a.weaponUses[f.weapon.id],1);
  assert(!G.canAttack(f.game,f.a,f.enemies[0],f.weapon));
});
test("container nuclear ground targeting expands to one salvo, not one salvo per victim", () => {
  const f = fixture("EF_GP_03D_MSL_ASP");
  f.planner.plan(f.room, f.a, f.enemies[0], f.weapon, 0);
  f.planner.prepare(f.room);
  const request = f.room.reactions.find(r => !r.supportOnly);
  assert.equal(request.attacks.length, 1);
  assert.equal(request.attacks[0].cellBlast, true);
});
test("empty nuclear targets still emit three blasts and consume one turn use", () => {
  const f = fixture("EF_GP_03D_MSL_ASP");
  f.enemies.forEach(e=>Object.assign(e,{x:15,y:15}));
  const target = G.groundTarget(f.game,f.a,8,8);
  f.planner.plan(f.room,f.a,target,f.weapon,0);
  f.planner.prepare(f.room);
  const battles=f.planner.resolve(f.room),events=battles.flatMap(b=>b.events);
  assert.equal(events.length,3);assert(events.every(e=>e.empty));
  assert.equal(new Set(events.map(e=>e.blastId)).size,3);
  assert.equal(f.a.en,4750);assert.equal(f.a.weaponTurnUses[f.weapon.id],1);
});
