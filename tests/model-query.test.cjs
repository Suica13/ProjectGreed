const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
function fixture() {
  const entry = { unitId: "RGM_79", kitId: "machine_gun" };
  const g = G.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
  const unit = g.units[0];
  unit.brokenParts = { leftArm: true, backpack: true };
  return { g, unit };
}

test("read-only model queries retain live values, isolate virtual actors and separate board contexts", () => {
  const { g, unit } = fixture();
  const space = { ...g, environment: "space", tiles: g.tiles.map((row) => row.map(() => "plain")) };
  const expected = [G.modelOf(unit), G.modelOf(unit, g), G.modelOf(unit, space)];
  const clone = { ...unit, brokenParts: {} };
  const intact = G.modelOf(clone);
  G.withModelQuery(() => {
    const first = G.modelOf(unit);
    assert.equal(G.modelOf(unit), first);
    assert.deepEqual(first, expected[0]);
    assert.deepEqual(G.modelOf(unit, g), expected[1]);
    assert.deepEqual(G.modelOf(unit, space), expected[2]);
    assert.deepEqual(G.modelOf(clone), intact);
    assert.notEqual(G.modelOf(clone), first);
    assert.notEqual(G.modelOf(unit, g), G.modelOf(unit, space));
  });
  unit.brokenParts = {};
  assert.deepEqual(G.modelOf(unit), intact);
  assert.deepEqual(
    G.withModelQuery(() => G.modelOf(unit)),
    intact,
  );
});

test("nested model queries and exceptions restore the caller scope and never leak into commands", () => {
  const { unit } = fixture();
  G.withModelQuery(() => {
    const original = G.modelOf(unit);
    G.withModelQuery(() => {
      assert.notEqual(G.modelOf(unit), original);
      assert.deepEqual(G.modelOf(unit), original);
    });
    assert.equal(G.modelOf(unit), original);
    assert.throws(() =>
      G.withModelQuery(() => {
        G.modelOf(unit);
        throw Error("failed query");
      }),
    );
    assert.equal(G.modelOf(unit), original);
  });
  const damaged = G.modelOf(unit);
  unit.brokenParts = {};
  assert.notEqual(G.modelOf(unit).move, damaged.move);
});
