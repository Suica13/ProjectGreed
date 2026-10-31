const test = require("node:test");
const assert = require("node:assert/strict");
const { compile, archive, roundPrice } = require("../tools/license-catalog.cjs");
const catalog = require("../shared/production-catalog.json");

test("factory deployment licenses divide native batch prices and round each resource to 50", () => {
  assert.equal(roundPrice(125), 150);
  assert.equal(roundPrice(124), 100);
  assert.equal(roundPrice(1), 50);
  assert.equal(roundPrice(0), 0);
  for (const offer of Object.values(catalog.licenseOffers)) {
    assert.equal(offer.money % 50, 0);
    assert.equal(offer.supplies % 50, 0);
    assert(["EFSF", "ZEON"].includes(offer.faction));
    if (offer.sourceType !== "factory") continue;
    const native = catalog.offers[catalog.baseModels[offer.unitId]];
    assert.equal(offer.money, roundPrice(native.money / native.quantity), offer.unitId);
    assert.equal(offer.supplies, roundPrice(native.supplies / native.quantity), offer.unitId);
  }
});

test("archive preserves index-zero batch costs and exact signed per-unit equipment differences", () => {
  const c = {
    defaultKits: { hull: "zero" },
    offers: {
      hull__zero: {
        money: 1000,
        supplies: 800,
        quantity: 3,
        equipmentIndex: 0,
        source: { buildSeconds: 30 },
      },
      hull__extra: {
        money: 1200,
        supplies: 600,
        quantity: 3,
        equipmentIndex: 1,
        source: { buildSeconds: 40 },
      },
    },
  };
  const units = [{ id: "hull", weaponKits: [{ id: "extra" }, { id: "zero" }, { id: "missing" }] }];
  const result = archive(c, units).hull;
  assert.equal(result.baseKitId, "zero");
  assert.deepEqual(result.base, {
    money: 1000,
    supplies: 800,
    quantity: 3,
    source: { buildSeconds: 30 },
  });
  assert.equal(result.kits.zero.moneyDifference, 0);
  assert.equal(result.kits.extra.moneyDifference, 1200 / 3 - 1000 / 3);
  assert.equal(result.kits.extra.suppliesDifference, 600 / 3 - 800 / 3);
  assert.equal(result.kits.extra.batchMoney, 1200);
  assert.equal(result.kits.extra.source.buildSeconds, 40);
  assert.equal(result.kits.missing.available, false);
  for (const [id, entry] of Object.entries(catalog.nativePricing)) {
    assert.equal(entry.baseKitId, catalog.defaultKits[id]);
    for (const [kit, price] of Object.entries(entry.kits)) {
      if (!price.available) continue;
      const raw = catalog.offers[id + "__" + kit];
      assert.equal(price.batchMoney, raw.money);
      assert.equal(price.batchSupplies, raw.supplies);
      assert.equal(price.unitMoney, raw.money / raw.quantity);
    }
  }
});

test("ordinary refit-only hulls buy directly at native refit fees; ACE forms remain automatic", () => {
  const source = {
    id: "source",
    tags: ["EFSF"],
    refits: [
      { unitId: "ordinary", money: 375, supplies: 600 },
      { unitId: "ace", money: 200, supplies: 400 },
      { unitId: "blocked", money: 50, supplies: 50, blocked: true },
    ],
  };
  const units = [
    source,
    ...["ordinary", "ace", "blocked"].map((id) => ({
      id,
      tags: ["EFSF"],
      production: { enabled: false },
      ...(id === "ace" ? { requiredPilotId: "pilot" } : {}),
    })),
  ];
  const result = compile({ offers: {}, baseModels: {} }, units);
  assert.equal(result.ordinary.money, 400);
  assert.equal(result.ordinary.supplies, 600);
  assert.equal(result.ordinary.sourceType, "native-refit");
  assert.equal(result.ace, undefined);
  assert.equal(result.blocked, undefined);
});
