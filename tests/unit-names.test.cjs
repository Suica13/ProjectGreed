const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const entry = { unitId: "Type61", kitId: "standard" };
test("unit names stay plain while logs identify each player's original formation position", () => {
  const entries = [{ ...entry, customName: "Old[A12]" }, { ...entry }];
  const clean = G.validateFormation(entries);
  assert(clean.every((e) => e.customName === undefined));
  const game = G.create(false, 123, [clean, [entry]]);
  assert.deepEqual(game, G.create(false, 123, [clean, [entry]]));
  assert.deepEqual(
    game.units.map((u) => u.formationIndex),
    [0, 1, 0],
  );
  for (const u of game.units) {
    assert.equal(G.unitName(u), G.modelOf(u).name);
    assert.equal(u.customName, undefined);
    assert.equal(G.unitLogName(u), G.modelOf(u).name + `[No.${u.formationIndex + 1}]`);
  }
  assert.equal(
    G.unitLogName({
      ...game.units[0],
      formationIndex: undefined,
      id: "0-4-escape-1",
      customName: "Legacy[A99]",
    }),
    G.modelOf(game.units[0]).name + "[No.5]",
  );
});
test("original indices survive deployment filtering and are not renumbered", () => {
  const game = G.create(false, 1, [[entry, entry], [entry]], false, {
    formationIndices: [[2, 7], [4]],
  });
  assert.deepEqual(
    game.units.map((u) => G.unitLogName(u).match(/\[No\.\d+\]/)[0]),
    ["[No.3]", "[No.8]", "[No.5]"],
  );
  const mixed = G.create(
    false,
    1,
    [[{ unitId: "RGM_79", kitId: "machine_gun" }, entry], [entry]],
    false,
    { seatFormationRules: [{ licenses: { Type61: true } }, { licenses: { Type61: true } }] },
  );
  assert.equal(mixed.units[0].formationIndex, 1);
  assert.match(G.unitLogName(mixed.units[0]), /\[No\.2\]$/);
});
test("AI formations no longer generate random display identifiers", () => {
  const army = G.randomFormation(1234);
  assert.deepEqual(army, G.randomFormation(1234));
  assert(army.every((e) => e.customName === undefined));
});
test("legacy names are discarded and malformed saved name fields remain rejected", () => {
  for (const customName of ["", " \n\t ", "Old[A12]"])
    assert.deepEqual(G.validateFormation([{ ...entry, customName }]), [entry]);
  for (const customName of [null, {}, 42, "x".repeat(25)])
    assert.throws(() => G.validateFormation([{ ...entry, customName }]), /单位名称/);
});
