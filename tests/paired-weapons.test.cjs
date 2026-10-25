const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  Sequence = require("../shared/weapon-sequence");
function setup(id, weaponId) {
  const m = Object.values(G.models).find(
    (m) => m.prefabId === id && m.weapons.some((w) => w.id === weaponId),
  );
  assert.ok(m, id + "/" + weaponId);
  const u = {
    model: Object.keys(G.models).find((k) => G.models[k] === m),
    hp: m.hp,
    en: m.en,
    brokenParts: {},
  };
  return { u, w: m.weapons.find((w) => w.id === weaponId) };
}
for (const id of ["RX_78NT_1", "RX_78NT_1_FA", "RX_78XX"])
  test(id + " pairs guns simultaneously and retains only the intact hand", () => {
    const { u, w } = setup(id, id === "RX_78XX" ? "EF_75mmMG_Double" : "Common_ArmMG");
    const rounds = id === "RX_78XX" ? 7 : 9,
      energy = id === "RX_78XX" ? 45 : 40;
    assert.equal(w.shotCount, rounds * 2);
    assert.equal(w.en, energy);
    assert.equal(w.pairedChannels.length, 2);
    for (let i = 0; i < w.attack.shots.length; i += 2)
      assert.equal(w.attack.shots[i], w.attack.shots[i + 1]);
    for (const broken of ["leftArm", "rightArm"]) {
      u.brokenParts = { [broken]: true };
      const live = G.availableStrikes(u, w);
      assert.equal(live.length, rounds);
      assert.equal(G.weaponStats(w, u).en, energy / 2);
      assert.ok(live.every((s) => !s.requiredParts.includes(broken)));
      const indices = live.map((s) => w.attack.muzzleIndices[s.shotIndex]);
      assert.equal(new Set(indices).size, 1);
      const mount = w.muzzle.mounts[indices[0]];
      const expected = broken === "leftArm" ? "RightArm" : "LeftArm";
      if (mount.layer)
        assert.equal(
          G.catalog.units.find((a) => a.id === u.model).decals.find((l) => l.name === mount.layer)
            .bone,
          expected,
        );
      else assert.equal(Math.sign(mount.offset.x), broken === "leftArm" ? 1 : -1);
    }
    u.brokenParts = { leftArm: true, rightArm: true };
    assert.equal(G.availableStrikes(u, w).length, 0);
    assert.equal(G.weaponStats(w, u).en, 0);
  });
test("a double barrel on the same arm is not a second hand", () => {
  const { u, w } = setup("FA_78_1", "EF_FA_78_1_BR");
  u.brokenParts = { leftArm: true };
  assert.equal(G.availableStrikes(u, w).length, w.attack.strikes.length);
  u.brokenParts = { rightArm: true };
  assert.equal(G.availableStrikes(u, w).length, 0);
});
test("pairing preserves every actual native payload once and leaves ships modular", () => {
  for (const p of G.catalog.prefabs)
    for (const group of p.pairedWeapons || []) {
      assert.ok(!p.stats.ship);
      const { w } = setup(p.id, group.id);
      let count = 0,
        damage = 0;
      for (const c of group.channels) {
        const raw = Sequence.compile(p.weapons[c.weaponId]);
        for (const s of raw.attack.strikes.filter(
          (s) => raw.attack.muzzleIndices[s.shotIndex] === c.muzzleIndex,
        )) {
          count++;
          damage +=
            Object.values(s.damageComponents || raw.damageComponents).reduce((a, b) => a + b, 0) *
            s.damageMultiplier;
        }
      }
      assert.equal(w.attack.strikes.length, count, p.id + "/" + group.id);
      assert.equal(w.damage, damage, p.id + "/" + group.id);
      const m = Object.values(G.models).find(
        (m) => m.prefabId === p.id && m.weapons.some((w) => w.id === group.id),
      );
      for (const c of group.channels)
        if (c.id !== group.id) assert.ok(!m.weapons.some((w) => w.id === c.id), p.id + "/" + c.id);
    }
});
test("paired start and firing poses contain both arm transforms and match visible muzzle bones", () => {
  const { u, w } = setup("RX_78XX", "EF_75mmMG_Double");
  const art = G.catalog.units.find((a) => a.id === u.model);
  for (const t of w.attack.shots) {
    const pose = Sequence.pose(w, t),
      clip = art.animations[pose.clip];
    assert.ok(clip);
    assert.ok(clip.curves.LeftArm);
    assert.ok(clip.curves.RightArm);
  }
  const layers = art.decals.filter((l) =>
    ["EF_75mmMG_Double", "EF_75mmMG_Double_L"].includes(l.name),
  );
  assert.equal(layers.length, 2);
  assert.ok(layers.every((l) => l.visibleWhen.weaponDisplayIndex === w.displayIndex));
  const raw = G.catalog.prefabs.find((p) => p.id === "RX_78XX").weapons[w.id];
  assert.deepEqual(w.attack.displayStates, Sequence.compile(raw).attack.displayStates);
  assert.deepEqual(layers.map((l) => l.requiredParts).sort(), [["leftArm"], ["rightArm"]]);
});

test("every explicitly paired hand and leg keeps the opposite live channel after limb destruction", () => {
  for (const p of G.catalog.prefabs)
    for (const group of p.pairedWeapons || []) {
      if (!group.channels.every((c) => c.limb)) continue;
      const { u, w } = setup(p.id, group.id);
      for (const limb of new Set(group.channels.map((c) => c.limb))) {
        u.brokenParts = { [limb]: true };
        const expected = w.attack.strikes.filter((s) => !s.requiredParts.includes(limb));
        assert.equal(
          G.availableStrikes(u, w).length,
          expected.length,
          p.id + "/" + group.id + "/" + limb,
        );
        const ids = new Set(expected.map((s) => s.channelId));
        assert.equal(
          G.weaponStats(w, u).en,
          w.pairedChannels.filter((c) => ids.has(c.id)).reduce((n, c) => n + c.en, 0),
        );
      }
    }
});
