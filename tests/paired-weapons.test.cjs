const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const Sequence = require("../shared/weapon-sequence");

test("all combined dual-hand groups retain their intact side after either arm breaks",()=>{
  let checked=0;
  for(const prefab of G.catalog.prefabs) for(const group of prefab.pairedWeapons || []) {
    if(!prefab.stats.partsBreakable || group.fireMode!=="simultaneous" ||
      !group.channels.some(c=>c.limb==="leftArm") || !group.channels.some(c=>c.limb==="rightArm")) continue;
    const {u,w}=setup(prefab.id,group.id);
    Object.assign(u,{id:"paired-test",x:5,y:5,en:100000,shield:100000,
      pilot:{stats:Object.fromEntries(Object.keys(G.pilots.baseStats()).map(key=>[key,200]))}});
    for(const broken of ["leftArm","rightArm"]) {
      u.brokenParts={[broken]:true};
      assert(G.canUse(u,w),prefab.id+":"+group.id+":"+broken);
      assert(G.availableStrikes(u,w).every(s=>!s.requiredParts.includes(broken)));
      const energy=w.pairedChannels.filter(c=>!c.requiredParts.includes(broken)).reduce((sum,c)=>sum+c.en,0);
      assert.equal(G.weaponStats(w,u).en,energy);
    }
    u.brokenParts={leftArm:true,rightArm:true};assert(!G.canUse(u,w));checked++;
  }
  assert(checked>5);
});
function setup(id, weaponId) {
  const [key, m] = Object.entries(G.models).find(
    ([, m]) => m.prefabId === id && m.weapons.some((w) => w.id === weaponId),
  );
  return {
    m,
    u: { model: key, hp: m.hp, en: m.en, brokenParts: {} },
    w: m.weapons.find((w) => w.id === weaponId),
  };
}
for (const p of G.catalog.prefabs)
  for (const group of p.pairedWeapons || []) {
    test(
      p.id + "/" + group.id + " preserves native payload across selectable physical channels",
      () => {
        const { m } = setup(p.id, group.id);
        const weapons =
          group.fireMode === "independent"
            ? [...new Set(group.channels.map((c) => c.limb))].map((limb) =>
                m.weapons.find((w) => w.id === group.channels.find((c) => c.limb === limb).id),
              )
            : [m.weapons.find((w) => w.id === group.id)];
        let count = 0,
          damage = 0,
          energy = 0;
        for (const c of group.channels) {
          const raw = Sequence.compile(p.weapons[c.weaponId]);
          const shots = raw.attack.strikes.filter(
            (s) => raw.attack.muzzleIndices[s.shotIndex] === c.muzzleIndex,
          );
          count += shots.length;
          energy += (raw.en * shots.length) / raw.attack.strikes.length;
          damage += shots.reduce(
            (n, s) =>
              n +
              Object.values(s.damageComponents || raw.damageComponents).reduce((a, b) => a + b, 0) *
                s.damageMultiplier,
            0,
          );
        }
        assert.equal(
          weapons.reduce((n, w) => n + w.shotCount, 0),
          count,
        );
        assert.equal(
          weapons.reduce((n, w) => n + w.damage, 0),
          damage,
        );
        assert.equal(
          weapons.reduce((n, w) => n + w.en, 0),
          energy,
        );
        assert.ok(!p.stats.ship);
        if (group.fireMode === "independent") {
          assert.equal(weapons.length, 2);
          assert.notEqual(weapons[0].id, weapons[1].id);
          for (const w of weapons) {
            const { u } = setup(p.id, w.id),
              limb = w.requiredParts.find((p) => p.endsWith("Arm"));
            assert.ok(limb);
            assert.ok(w.attack.strikes.every((s) => s.requiredParts.includes(limb)));
            assert.equal(G.availableStrikes(u, w).length, w.shotCount);
            u.brokenParts[limb === "leftArm" ? "rightArm" : "leftArm"] = true;
            assert.equal(G.availableStrikes(u, w).length, w.shotCount);
            assert.equal(G.weaponStats(w, u).en, w.en);
            u.brokenParts[limb] = true;
            assert.equal(G.availableStrikes(u, w).length, 0);
            assert.equal(G.weaponStats(w, u).en, 0);
            assert.equal(w.actionCost, p.weapons[group.id].actionCost);
          }
        }
      },
    );
  }
for (const id of ["RX_78NT_1", "RX_78NT_1_FA"])
  test(id + " fires one arm per action with its own animation and energy", () => {
    const root = id === "RX_78XX" ? "EF_75mmMG_Double" : "Common_ArmMG";
    for (const suffix of ["", "_L"]) {
      const { u, w } = setup(id, root + suffix);
      assert.equal(w.shotCount, id === "RX_78XX" ? 7 : 9);
      assert.equal(w.en, id === "RX_78XX" ? 22.5 : 20);
      assert.equal(w.muzzle.mounts.length, 1);
      const art = G.catalog.units.find((a) => a.id === u.model);
      for (const t of w.attack.shots) {
        const pose = Sequence.pose(w, t),
          clip = art.animations[pose.clip];
        assert.ok(clip.curves[suffix ? "LeftArm" : "RightArm"]);
        assert.ok(!clip.curves[suffix ? "RightArm" : "LeftArm"]);
      }
      assert.deepEqual(
        w.attack.displayStates,
        Sequence.compile(G.catalog.prefabs.find((p) => p.id === id).weapons[w.id]).attack
          .displayStates,
      );
    }
  });
test("a double barrel on the same arm remains one weapon", () => {
  const { u, w } = setup("FA_78_1", "EF_FA_78_1_BR");
  u.brokenParts.leftArm = true;
  assert.equal(G.availableStrikes(u, w).length, w.shotCount);
  u.brokenParts.rightArm = true;
  assert.equal(G.availableStrikes(u, w).length, 0);
});
for (const id of ["RX_77_2", "RX_77_3", "RX_77_3D"])
  test(id + " mortar depends on backpack and survives arm destruction", () => {
    const m = Object.values(G.models).find(
      (m) => m.prefabId === id && m.weapons.some((w) => w.id.includes("Mortar")),
    );
    const { u, w } = setup(id, m.weapons.find((w) => w.id.includes("Mortar")).id);
    assert.deepEqual(w.requiredParts, ["backpack"]);
    u.brokenParts = { leftArm: true, rightArm: true };
    assert.equal(G.availableStrikes(u, w).length, w.shotCount);
    u.brokenParts = { backpack: true };
    assert.equal(G.availableStrikes(u, w).length, 0);
  });

test("Pixy fires both 75mm guns together, retaining per-arm damage and energy when broken", () => {
  const { u, w } = setup("RX_78XX", "EF_75mmMG_Double");
  assert.equal(w.shotCount, 14);
  assert.equal(w.en, 45);
  assert.equal(w.muzzle.mounts.length, 2);
  for (let i = 0; i < w.attack.shots.length; i += 2)
    assert.equal(w.attack.shots[i], w.attack.shots[i + 1]);
  u.brokenParts.leftArm = true;
  assert.equal(G.availableStrikes(u, w).length, 7);
  assert.equal(G.weaponStats(w, u).en, 22.5);
});
