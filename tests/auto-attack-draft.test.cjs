const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  vm = require("node:vm");
test("target-first UI always previews automatic weapons without mutating units", () => {
  const a = { id: "a", team: 0, hp: 100, actionPoints: 0 },
    b = { id: "b", team: 1, hp: 100 },
    c = { id: "c", team: 1, hp: 100 };
  const weapon = { id: "gun", slot: "main" };
  const ctx = {
    game: { round: 1, team: 0 },
    session: 1,
    mode: "",
    weaponId: null,
    squadSingleMove: false,
    squadCombatMode: "melee",
    update() {},
    GameAudio: { play() {} },
    getUnit: (id) => [a, b, c].find((u) => u.id === id),
    Rules: {
      automaticQueue: () => [weapon, weapon],
      automaticSquadQueue: () => [weapon, weapon],
      squadMembers: (game, unit) => [unit],
      automaticWeapons: () => [weapon],
      attackOrders: () => [],
    },
  };
  vm.createContext(ctx);
  const source = fs.readFileSync("client/planning-ui.js", "utf8");
  vm.runInContext(
    source.slice(source.indexOf("const AttackControls =")) + "\nthis.controls=AttackControls;",
    ctx,
  );
  const api = ctx.controls,
    original = JSON.stringify(a);
  assert(api.choose(a, b));
  assert.equal(api.draft(a).weapons.length, 2);
  assert.equal(JSON.stringify(a), original);
  api.choose(a, c);
  assert.equal(api.draft(a).targetId, c.id);
  assert.equal(api.mapDraft(a).length, 1);
  assert.equal(api.toggleAutoAttack, undefined);
});
