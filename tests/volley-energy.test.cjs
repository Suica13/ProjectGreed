const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules");
test("native bazooka and beam rifle volleys undo the historical forced two-shot override", () => {
  for (const id of ["RGM_79__bazooka", "MS_14A__beam_rifle", "RX_79_G__beam_rifle"]) {
    const w = G.models[id].weapons[0];
    assert.equal(w.shotCount, 1);
    assert.equal(w.shotCount, w.nativeTiming.projectiles);
  }
  const cannon = G.models.RGC_80__machine_gun.weapons.find((w) => w.id === "Common_Cannon");
  assert.equal(cannon.shotCount, 1);
  assert.equal(cannon.damage, 8000);
});
test("native EN costs include free secondary weapons, fixed volley costs and per-emission ship costs", () => {
  const m = G.models.RGM_79__machine_gun;
  assert.equal(m.weapons[0].en, 20);
  assert.equal(m.weapons.find((w) => w.type === "melee").en, 0);
  assert.equal(m.weapons.find((w) => w.id === "Common_DoubleVulcan_MS").en, 0);
  const ship = G.models.SalamisClass__standard.weapons.find(
    (w) => w.id === "SalamisClass_Turret_BeamCannon",
  );
  assert.equal(ship.en, 240);
  assert.equal(ship.nativeTiming.energyPerEmission, 40);
  for (const p of G.catalog.prefabs)
    for (const w of Object.values(p.weapons))
      assert.equal(w.en, w.nativeTiming.energy, p.id + "/" + w.name);
});
test("native full-strength melee stages have no artificial half-damage second hit", () => {
  const w = G.models.RGM_79L__beam_gun.weapons.find((w) => w.type === "melee");
  assert.equal(w.shotCount, 2);
  assert.equal(w.damage, 10000);
  assert.deepEqual(
    w.attack.strikes.map((s) => s.damageMultiplier),
    [1, 1],
  );
});
test("native Panzerfaust restores its original one-projectile payload without repeated balance boosts", () => {
  const w = G.models.MS_06F2__machine_gun.weapons.find((w) => w.id === "ZN_Panzerfaust");
  assert.equal(w.shotCount, 1);
  assert.equal(w.damage, 6500);
  assert.equal(w.hit, w.sourceHit);
});
