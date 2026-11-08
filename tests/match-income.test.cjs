"use strict";
const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { rewardTotals } = require("../shared/battle-economy.js");
test("match income combines all payout kinds and allocated technology without reapplying multipliers", () => {
  const awards = [
    ["kill", 500, 600],
    ["assist", 250, 300],
    ["capture", 750, 1500],
    ["base_damage", 1000, 2000],
    ["facility", 400, 800],
    ["result", 3750, 7500],
    ["loss", 0, 0],
    ["deployment", 0, 0],
  ].map(([kind, money, supplies], index) => ({
    id: "receipt-" + index,
    matchId: "current",
    kind,
    money,
    supplies,
  }));
  const tech = ["EFSF", "ZEON"].map((faction, index) => ({
    id: "tech-" + index,
    matchId: "current",
    faction,
    points: index ? 60 : 600,
  }));
  assert.deepEqual(rewardTotals(awards, tech, "current"), {
    money: 6650,
    supplies: 12700,
    technology: 660,
  });
  assert.equal(awards.length, 8);
  assert.equal(tech.length, 2);
});
test("snapshot totals reject duplicate and other-match receipts and never produce NaN for stock-only awards", () => {
  const award = { id: "same", matchId: "current", money: 250, supplies: 500 };
  const tech = { id: "same", matchId: "current", points: 100 };
  assert.deepEqual(
    rewardTotals(
      [
        award,
        award,
        { ...award, matchId: "old", money: 99999 },
        { id: "stock", stockLost: { inventory: { Type61: 1 } } },
      ],
      [tech, tech, { ...tech, matchId: "old", points: 99999 }],
      "current",
    ),
    { money: 250, supplies: 500, technology: 100 },
  );
  assert.deepEqual(rewardTotals(), { money: 0, supplies: 0, technology: 0 });
});
test("quick rewards are summed as credited, with no second 10 percent reduction", () => {
  assert.deepEqual(
    rewardTotals([{ id: "quick", money: 250, supplies: 500 }], [{ id: "quick-tech", points: 66 }]),
    { money: 250, supplies: 500, technology: 66 },
  );
});
