const test = require("node:test"),
  assert = require("node:assert/strict"),
  P = require("../shared/pilots.js");
test("PMC and ACE normalize legacy records to four counts and never accumulate COST records", () => {
  for (const original of [
    P.createCustom("custom-record-four", "Four"),
    P.createAce(P.catalog.aces.find((p) => p.price).id),
  ]) {
    const legacy = {
      ...original,
      record: { kills: 4, shipKills: 1, battles: 2, losses: 1, destroyedCost: 500, lostCost: 100 },
    };
    let p = P.custom(legacy);
    assert.deepEqual(p.record, { kills: 4, shipKills: 1, battles: 2, losses: 1 });
    p = P.battleResult(p, "kill", 250, 100, { shipKill: true });
    p = P.battleResult(p, "loss", 500, 0, { requiresRecruitment: false });
    p = P.battleResult(p, "battle", 0, 0);
    assert.deepEqual(p.record, { kills: 5, shipKills: 2, battles: 3, losses: 2 });
    assert.equal(p.experience, original.experience + 100);
    assert.equal(Object.hasOwn(p.record, "destroyedCost"), false);
    assert.equal(Object.hasOwn(p.record, "lostCost"), false);
  }
});
