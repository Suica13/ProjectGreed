const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const { fixture, run } = require("../tools/performance-unit-ai.cjs");

test("AI search remains read-only and repeated searches give the same orders", () => {
  const game = fixture(),
    before = JSON.stringify(game);
  const first = G.aiChoice(game, game.units[0]),
    second = G.aiChoice(game, game.units[0]);
  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(game), before);
  assert.deepEqual([first.x, first.y, first.target], [8, 5, "enemy-0"]);
});

test("carrier exits share one tactical evaluation and preserve the preferred squad exit", () => {
  const report = run();
  assert(report.launch.groupedExits >= 4);
  assert.equal(report.launch.tacticBuilds, 1);
  assert.deepEqual([report.launch.choice.x, report.launch.choice.y], [9, 7]);
  assert(report.launch.choice.squadTarget);
  console.log("UNIT_AI_PROFILE", JSON.stringify(report));
});
