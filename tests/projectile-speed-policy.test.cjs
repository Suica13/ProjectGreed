const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules"), Auto = require("../shared/automatic-fire"),
  Classes = require("../shared/weapon-classes"), Conversion = require("../shared/conversion-rules.cjs");
const fs = require("node:fs"), Codec = require("../tools/weapon-store.cjs");

test("all conventional bullets use retained MOD speed / 10, including cluster fragments", () => {
  let count = 0, fragments = 0, mortar = 0;
  for (const m of Object.values(G.models)) for (const w of m.weapons) {
    if (!w.projectile) continue;
    const kind = Classes.classify(w);
    if (["mortar","irradiation"].includes(kind)) {
      if (kind === "mortar") { assert.equal(w.projectile.speed,w.nativePayload.ProjectileSpeed); mortar++; }
      continue;
    }
    const baseline = w.nativePayload?.ProjectileSpeed > 0 ? w.nativePayload.ProjectileSpeed : w.projectile.nativeSpeed;
    assert.equal(w.projectile.speed,baseline * 0.1,m.prefabId + "/" + w.id);
    if (w.projectile.cluster) {
      assert.equal(w.projectile.cluster.speed,w.projectile.cluster.nativeSpeed * 0.1); fragments++;
    }
    count++;
  }
  assert(count > 1000); assert(fragments > 0); assert(mortar > 20);
});

test("projectile conversion is idempotent and remains adjustable independently of damage", () => {
  const raw = Codec.parse(fs.readFileSync("assets/units/MS_10/unit.json","utf8"));
  const rules = Conversion.read();
  Conversion.globals(raw,rules);
  const first = structuredClone(raw.weapons.ZN_BeamBazooka);
  Conversion.globals(raw,rules);
  assert.deepEqual(raw.weapons.ZN_BeamBazooka,first);
  rules.weapons.projectileSpeed = 0.2;
  Conversion.globals(raw,rules);
  assert.equal(raw.weapons.ZN_BeamBazooka.projectile.speed,11);
  assert.deepEqual(raw.weapons.ZN_BeamBazooka.damageComponents,first.damageComponents);
});

test("authoritative flight time slows by ten without changing mortar/beam timing", () => {
  const game = G.create(false,1,[[{unitId:"RGM_79",kitId:"machine_gun"}],[{unitId:"RGM_79",kitId:"machine_gun"}]],false);
  const [a,b] = game.units; Object.assign(a,{x:3,y:3});Object.assign(b,{x:7,y:3});
  const w = G.modelOf(a).weapons[0];
  assert(Math.abs(Auto.flight(G,a,b,w) / Auto.flight(G,a,b,{...w,projectile:{...w.projectile,speed:w.projectile.nativeSpeed}}) - 10) < 1e-8);
});

test("every beam bazooka preserves native yellow cannon bullet and both impact layers", () => {
  let count = 0;
  for (const m of Object.values(G.models)) for (const w of m.weapons)
    if (Classes.classify(w) === "beam_bazooka") {
      assert.deepEqual(w.hitEffects,["Beam_Exp_1_Yellow","Beam_Hit_2_Yellow"]);
      assert.equal(w.projectile.texture,"../../projectiles/Beam_3_Yellow.png");
      assert.equal(w.projectile.forwardOffset,-15);
      assert.equal(w.projectile.speed,w.nativePayload.ProjectileSpeed * 0.1);
      count++;
    }
  assert.equal(count,5);
});
