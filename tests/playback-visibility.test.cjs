const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
test("playback retains actors visible before resolution, excludes unseen fire and ground markers, and resets", () => {
  const a = { id: "a", hp: 100, model: "a" },
    b = { id: "b", hp: 100, model: "b" };
  const context = vm.createContext({ game: { units: [a] }, byId: () => ({}), battleView: null });
  vm.runInContext(
    fs.readFileSync("client/map-combat.js", "utf8") + ";globalThis.api=MapCombat",
    context,
  );
  context.api.seed([
    {
      actors: [a, b, { id: "hidden", hp: 100 }, { id: "ground", visualOnly: true, hp: 100 }],
      visibleActorIds: ["a", "b", "ground"],
    },
  ]);
  assert.deepEqual(
    Array.from(context.api.units(), (u) => u.id),
    ["a", "b"],
  );
  assert.equal(context.game.units.length, 1, "presentation must not change authoritative units");
  context.api.reset();
  assert.deepEqual(
    Array.from(context.api.units(), (u) => u.id),
    ["a"],
  );
});
