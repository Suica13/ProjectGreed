const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const Pilots = require("../shared/pilots.js");

test("command units roll a default officer and only accept qualified named pilots", () => {
  const command = Object.values(G.models).find(
    (model) => Pilots.commandUnit(model) && model.faction === "EFSF",
  );
  assert.ok(command);
  assert.equal(G.unitSize(command), "large");
  const pilot = Pilots.roll(null, 42, 0, 0, command);
  assert.equal(pilot.name, "联邦默认指挥官");
  assert.ok(pilot.stats.leadership >= 90 && pilot.stats.leadership <= 110);
  assert.ok(pilot.stats.speed >= 81 && pilot.stats.speed <= 99);
  const officer = Pilots.catalog.named.find((entry) => entry.faction === "EFSF" && entry.commander);
  const ordinary = Pilots.catalog.named.find(
    (entry) => entry.faction === "EFSF" && !entry.commander,
  );
  assert.equal(Pilots.validate(officer.id, command), officer.id);
  assert.throws(() => Pilots.validate(ordinary.id, command), /指挥官/);
  const stats = { ...pilot.stats, leadership: 110, speed: 200 };
  const commandSpeed = Pilots.modifiers({ pilot: { stats } }, command).move;
  const ordinarySpeed = Pilots.modifiers(
    { pilot: { stats } },
    { ...command, unitTags: ["MS"], sourceStats: { nativeTags: ["MS"] } },
  ).move;
  // V27 separates command auras from personal movement attributes.
  assert.equal(commandSpeed, ordinarySpeed);
  assert.equal(commandSpeed, 1.5);
});

test("small, medium and large tags select the matching damage and hit modifiers", () => {
  const formation = [{ unitId: "RGM_79", kitId: "machine_gun" }];
  const game = G.create(false, 1, [formation, formation]);
  const [attacker, target] = game.units;
  attacker.x = 2;
  attacker.y = 4;
  target.x = 4;
  target.y = 4;
  const model = G.models[target.model];
  const originalTags = [...model.unitTags];
  const base = G.modelOf(attacker).weapons[0];
  const weapon = {
    ...base,
    hit: 40,
    antiSize: {
      small: { damage: 0.5, accuracy: 0.5 },
      large: { damage: 2, accuracy: 2 },
    },
  };
  try {
    const values = {};
    for (const [size, tag] of [
      ["small", "SmallUnit"],
      ["medium", "MediumUnit"],
      ["large", "LargeUnit"],
    ]) {
      model.unitTags.splice(0, model.unitTags.length, tag);
      assert.equal(G.unitSize(G.modelOf(target)), size);
      values[size] = G.estimate(game, attacker, target, weapon);
    }
    assert.ok(values.small.damage < values.medium.damage);
    assert.ok(values.medium.damage < values.large.damage);
    assert.ok(values.small.hit < values.medium.hit);
    assert.ok(values.medium.hit < values.large.hit);
  } finally {
    model.unitTags.splice(0, model.unitTags.length, ...originalTags);
  }
});

test("helicopter rotor decals draw after the hull",()=>{
 for(const id of ["EF_Heli","ZN_Heli"]){
  const prefab=require("../assets/units/"+id+"/unit.json");
  const hull=prefab.layers.findIndex(layer=>layer.name==="Body");
  assert(hull>=0);
  for(let index=0;index<prefab.layers.length;index++)if(prefab.layers[index].rotationSpeed)assert(index>hull,id);
 }
});
