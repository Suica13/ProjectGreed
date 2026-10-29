const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
const neutral = (changes = {}) => ({
  stats: {
    shooting: 100,
    melee: 100,
    defense: 100,
    speed: 100,
    accuracy: 100,
    reaction: 100,
    leadership: 100,
    awakening: 50,
    ...changes,
  },
});
function fixture() {
  const entry = { unitId: "Type61", kitId: "standard" };
  const game = G.create(false, 12, [[entry], [entry]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
    fogMode: "disabled",
  });
  game.tiles.forEach((row) => row.fill("plain"));
  const [a, b] = game.units;
  Object.assign(a, { x: 5, y: 5, pilot: neutral() });
  Object.assign(b, { x: 7, y: 5, pilot: neutral() });
  const weapon = {
    ...G.modelOf(a).weapons[0],
    hit: 60,
    sourceHit: 60,
    hitScale: 1,
    damageComponents: { shell: 1000 },
    shotCount: 1,
  };
  weapon.attack = {
    ...weapon.attack,
    strikes: [
      {
        ...weapon.attack.strikes[0],
        accuracy: 60,
        damageMultiplier: 1,
        damageComponents: { shell: 1000 },
      },
    ],
  };
  return { game, a, b, weapon };
}
function provider(game, kind, team, x, y, leadership = 100) {
  const id = kind === "attack" ? "MS_08TX" : kind === "defense" ? "RX_79_G" : "MS_06S";
  const model = Object.values(G.models).find((model) => model.prefabId === id);
  const actor = {
    id: "provider-" + game.units.length,
    model: model.prefabId + "__" + model.kitId,
    team,
    ownerSeat: team,
    x,
    y,
    hp: model.hp,
    pilot: neutral({ leadership }),
  };
  game.units.push(actor);
  return actor;
}
const near = (actual, expected) =>
  assert(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);
test("native ownership of all three command skills is adapted and current kits retain it", () => {
  const cases = { MS_08TX: "cmdAtk", RX_79_G: "cmdDef", MS_06S: "cmdCom" };
  for (const [id, kind] of Object.entries(cases))
    for (const model of Object.values(G.models).filter((model) => model.prefabId === id))
      assert(
        model.commandAuras.some((aura) => aura.type === kind),
        model.kitId,
      );
  assert(!G.models.Type61__standard.commandAuras?.length);
});
test("command radius and power scale in complete 25-point leadership steps", () => {
  const f = fixture(),
    source = provider(f.game, "communication", 0, 5, 8);
  for (const [leadership, radius, power] of [
    [100, 3, 0.1],
    [124, 3, 0.1],
    [125, 4, 0.11],
    [150, 5, 0.12],
    [75, 2, 0.09],
  ]) {
    source.pilot = neutral({ leadership });
    const aura = G.commandAura(source);
    assert.equal(aura.radius, radius);
    near(aura.effect, power);
  }
});
test("auras include self and allies, take strongest of each type and exclude dead, embarked and enemy providers", () => {
  const { game, a } = fixture(),
    source = provider(game, "attack", 0, 5, 8);
  near(G.commandEffects(game, a).attack, 0.1);
  near(G.commandEffects(game, source).attack, 0.1);
  const stronger = provider(game, "attack", 0, 5, 9, 125);
  near(G.commandEffects(game, a).attack, 0.11);
  stronger.hp = 0;
  near(G.commandEffects(game, a).attack, 0.1);
  source.embarked = { carrierId: a.id };
  assert.equal(G.commandEffects(game, a).attack, 0);
  delete source.embarked;
  source.team = 1;
  assert.equal(G.commandEffects(game, a).attack, 0);
  source.team = 0;
  source.y = 9;
  assert.equal(G.commandEffects(game, a).attack, 0);
});
test("attack and defense command multiply final armor-resolved damage", () => {
  const { game, a, b, weapon } = fixture();
  const base = G.estimate(game, a, b, weapon);
  provider(game, "attack", 0, 5, 8);
  const attack = G.estimate(game, a, b, weapon);
  assert(Math.abs(attack.damage - base.damage * 1.1) <= 1);
  provider(game, "defense", 1, 7, 8);
  const both = G.estimate(game, a, b, weapon);
  assert(Math.abs(both.damage - base.damage * 1.1 * 0.9) <= 1);
  const melee = { ...weapon, type: "melee", damageComponents: { meleeShell: 1000 } };
  const withAuras = G.estimate(game, a, b, melee).damage;
  game.units.splice(2);
  const without = G.estimate(game, a, b, melee).damage;
  assert(Math.abs(withAuras - without * 1.1 * 0.9) <= 1);
});
test("communication applies relative final hit and evasion bonuses", () => {
  const { game, a, b, weapon } = fixture();
  const base = G.estimate(game, a, b, weapon).hit;
  provider(game, "communication", 0, 5, 8);
  const attack = G.estimate(game, a, b, weapon).hit;
  near(attack, base * 1.1);
  provider(game, "communication", 1, 7, 8);
  near(G.estimate(game, a, b, weapon).hit, attack / 1.1);
});
test("100 is neutral and every ten pilot points changes the corresponding final quantity by two and a half percent", () => {
  const f = fixture();
  const base = G.estimate(f.game, f.a, f.b, f.weapon);
  const move = G.modelOf(f.a).move;
  f.a.pilot = neutral({ speed: 110 });
  near(G.modelOf(f.a).move, move * 1.025);
  f.a.pilot = neutral({ shooting: 110 });
  // Both estimates round each hit to 25; allow their combined quantization error.
  assert(Math.abs(G.estimate(f.game, f.a, f.b, f.weapon).damage - base.damage * 1.025) <= 12.5 * 2.025);
  f.a.pilot = neutral();
  f.b.pilot = neutral({ defense: 110 });
  assert(Math.abs(G.estimate(f.game, f.a, f.b, f.weapon).damage - base.damage * 0.975) <= 12.5 * 1.975);
  f.b.pilot = neutral();
  f.a.pilot = neutral({ accuracy: 110 });
  near(G.estimate(f.game, f.a, f.b, f.weapon).hit, base.hit * 1.025);
  f.a.pilot = neutral();
  f.b.pilot = neutral({ reaction: 110 });
  near(G.estimate(f.game, f.a, f.b, f.weapon).hit, base.hit / 1.025);
  const melee = { ...f.weapon, type: "melee", damageComponents: { meleeShell: 1000 } };
  f.b.pilot = neutral();
  const meleeBase = G.estimate(f.game, f.a, f.b, melee).damage;
  f.a.pilot = neutral({ melee: 110 });
  assert(Math.abs(G.estimate(f.game, f.a, f.b, melee).damage - meleeBase * 1.025) <= 12.5 * 2.025);
});

test("unmarked targets retain exactly a 25 percent final hit penalty with command effects", () => {
  const { game, a, b, weapon } = fixture();
  provider(game, "communication", 0, 5, 8);
  provider(game, "communication", 1, 7, 8);
  game.fogMode = "full";
  game.intel = { team: a.team, visibleIds: [b.id], detectedIds: [b.id] };
  const marked = G.estimate(game, a, b, weapon).hit;
  game.intel.detectedIds = [];
  near(G.estimate(game, a, b, weapon).hit, marked * 0.75);
});
