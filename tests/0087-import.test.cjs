const test = require("node:test"),
  assert = require("node:assert/strict");
const D = require("../shared/development.js"),
  G = require("../shared/rules.js");
const tree = require("../shared/development-tree.json"),
  production = require("../shared/production-catalog.json");
const full = (faction) => tree[faction].map((n) => n.id);
const later = ["AEUG", "TITANS", "NEO_ZEON"];
test("0087 BASE requires a whole legacy faction including 0083; forged later research cannot bypass it", () => {
  for (const legacy of ["EFSF", "ZEON"]) {
    const before = { [legacy]: tree[legacy].filter((n) => n.era !== "0083").map((n) => n.id) };
    for (const f of later) before[f] = full(f);
    const locked = D.normalizeResearch(before);
    for (const f of later) {
      assert.deepEqual(locked[f], []);
      assert(D.eraLocked(f, before));
    }
    const complete = { [legacy]: full(legacy) },
      original = JSON.stringify(complete);
    const active = D.normalizeResearch(complete);
    for (const f of later) {
      assert.deepEqual(active[f], ["Tech_" + f + "_0087_BaseTech"]);
      assert(!D.eraLocked(f, complete));
      const first = tree[f][0].unlocks.find((id) => G.catalog.prefabs.some((p) => p.id === id));
      assert(first);
      assert(D.allows(f, first, complete));
      assert(D.allows("PMC", first, complete));
    }
    assert.equal(JSON.stringify(complete), original);
    assert.deepEqual(D.normalizeResearch(active), active);
  }
});
test("old profile balances import with zero 0087 points, without losing legacy progress", () => {
  const result = D.validateProgress({
    points: { EFSF: 123, ZEON: 456 },
    claimed: {},
    researched: { EFSF: full("EFSF") },
  });
  assert.equal(result.points.EFSF, 123);
  for (const f of later) {
    assert.equal(result.points[f], 0);
    assert(result.researched[f].includes("Tech_" + f + "_0087_BaseTech"));
  }
});
test("all three Page_01 entry locks preserve native tech costs and faction unit libraries load", () => {
  for (const f of later) {
    const page = tree[f].filter((n) => n.page === 1);
    assert.equal(page[0].points, 999999);
    assert(page[0].temporaryPointOverride.nativePoints < 999999);
    assert.equal(page[0].temporaryPointOverride.nativePoints, page[0].sourceCosts.points);
    const units = G.catalog.prefabs.filter((p) => p.faction === f);
    assert(units.length > 20);
    for (const p of units) {
      assert(p.tags.includes("0087"));
      assert(p.weaponKits.length);
      assert(production.defaultKits[p.id]);
      if (!p.formOnly && !p.requiredPilotId) assert(production.licenseOffers[p.id], p.id);
    }
  }
});
test("AI keeps 0079 and 0087 main-line columns separate", () => {
  const laterResearch = {
    ["EFSF"]: full("EFSF"),
    AEUG: tree.AEUG.filter((n) => !n.page && n.column <= 3 && n.row === "mid").map((n) => n.id),
  };
  const result = D.aiResearch([{ characterFaction: "AEUG", researched: laterResearch }]);
  for (const f of later) {
    assert(tree[f].filter((n) => !n.page && n.column <= 3).every((n) => result[f].includes(n.id)));
    assert(!tree[f].some((n) => n.page && result[f].includes(n.id)));
  }
});
