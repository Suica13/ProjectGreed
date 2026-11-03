const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  Sequence = require("../shared/weapon-sequence");
function duel(channel, ignore = 0.5) {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" },
    g = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  g.tiles.forEach((row) => row.fill("plain"));
  const [a, b] = g.units,
    base = G.models[a.model];
  const model = {
    ...base,
    hp: 1000000,
    attackBonuses: { shooting: 0, melee: 0, beam: 0, shell: 0 },
    defenses: Object.fromEntries(
      ["beam", "shell", "melee", "dp", "sp"].map((k) => [k, { percent: 60, flat: 100 }]),
    ),
    shield: {
      ...base.shield,
      hp: 100000,
      blockChance: 1,
      coverage: 1,
      defenses: Object.fromEntries(
        ["beam", "shell", "melee", "dp", "sp"].map((k) => [k, { percent: 60, flat: 100 }]),
      ),
    },
  };
  G.models.armor_test = model;
  for (const [i, u] of g.units.entries())
    Object.assign(u, {
      model: "armor_test",
      x: 5 + i,
      y: 5,
      hp: 1000000,
      en: 100000,
      shield: 0,
      pilot: { stats: G.pilots.baseStats() },
    });
  const weapon = Sequence.compile({
    ...base.weapons[0],
    id: "ap-test",
    type: channel.startsWith("melee") ? "melee" : "beam",
    en: 0,
    min: 1,
    max: 10,
    hit: 10000,
    sourceHit: 10000,
    damagePerShot: 1000,
    damageComponents: { [channel]: 1000 },
    armorPiercingIgnore: ignore,
    requiredParts: [],
    antiSize: {},
    targetModifiers: {},
    attack: { startAnimation: null, steps: [{ delay: 0, shots: 1 }] },
  });
  return { g, a, b, weapon, cleanup: () => delete G.models.armor_test };
}
test("all native and mixed melee armor-piercing channels ignore half matching resistance", () => {
  for (const channel of ["beamAP", "shellAP", "meleeAP", "meleeBeamAP", "meleeShellAP"]) {
    const f = duel(channel);
    try {
      assert.equal(G.estimate(f.g, f.a, f.b, f.weapon).damage, 625, channel);
    } finally {
      f.cleanup();
    }
  }
  const f = duel("beam");
  try {
    assert.equal(G.estimate(f.g, f.a, f.b, f.weapon).damage, 350);
  } finally {
    f.cleanup();
  }
});
test("per-weapon armor-piercing override changes resistance, without bypassing shield or final damage reduction", () => {
  for (const [ignore, expected] of [
    [0, 350],
    [0.5, 625],
    [1, 900],
  ]) {
    const f = duel("beamAP", ignore);
    try {
      assert.equal(G.estimate(f.g, f.a, f.b, f.weapon).damage, expected);
      f.b.shield = 100000;
      const blocked = G.estimate(f.g, f.a, f.b, f.weapon);
      assert.equal(blocked.blockedDamage, 0);
      assert(blocked.shieldDamage > 0);
      const event = G.fight(f.g, f.a, f.b, f.weapon, "defend", null, false)[0];
      assert.equal(event.damage, 0);
      assert(event.shieldDamage > 0);
    } finally {
      f.cleanup();
    }
  }
});
test("converted native penetration adds an effective AP component against armor", () => {
  const f = duel("beam");
  try {
    const Conversion = require("../shared/conversion-rules.cjs"),
      raw = {
        ...f.weapon,
        weaponClass: "other",
        conversionMultipliers: undefined,
        damageComponents: { beam: 1000 },
        damagePerShot: 1000,
        nativePayload: { ProjectileAttackTimes: 2, ProjectileAttackTimesDamageModifier: 0.5 },
        attack: { startAnimation: null, steps: [{ delay: 0, shots: 1 }] },
      };
    const rules = Conversion.read();
    rules.weapons.damage = 1;
    Conversion.globals({ id: "converted", stats: {}, weapons: { test: raw } }, rules);
    const converted = Sequence.compile(raw);
    assert.equal(converted.damageComponents.beamAP, 300);
    assert(
      G.estimate(f.g, f.a, f.b, converted).damage > G.estimate(f.g, f.a, f.b, f.weapon).damage,
    );
  } finally {
    f.cleanup();
  }
});
test("native psycommu weapons preserve their AP share within the normalized salvo total", () => {
  const weapons = Object.values(G.models)
    .filter((m) => m.prefabId === "MAN_03")
    .flatMap((m) => m.weapons);
  const bit = weapons.find((w) => w.remote);
  assert(bit.damageComponents.beamAP > 0);
  assert(
    bit.attack.strikes.every((s) =>
      Object.keys(s.damageComponents || bit.damageComponents).some((k) => k.endsWith("AP")),
    ),
  );
});
