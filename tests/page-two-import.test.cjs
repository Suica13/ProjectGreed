const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const G = require("../shared/rules.js");
const D = require("../shared/development.js");
const manifest = require("../tools/0079-page-two-manifest.json");
const early = new Set(require("../tools/0079-page-one-manifest.json").map((row) => row.id));
const tree = require("../shared/development-tree.json");
const production = require("../shared/production-catalog.json");

test("both second pages expose all source combat units and retain cross-page prerequisites", () => {
  assert.equal(manifest.length, 117);
  for (const faction of ["EFSF", "ZEON"]) {
    const nodes = tree[faction].filter((node) => node.page === 1);
    assert.equal(nodes.length, 10);
    assert(
      nodes.some((node) =>
        node.requires.some((id) => tree[faction].find((item) => item.id === id)?.page === 0),
      ),
    );
    for (const node of nodes) {
      assert.equal(node.money, node.sourceCosts.money * 2);
      assert.equal(node.supplies, node.sourceCosts.supplies * 2);
      assert(Number.isFinite(node.sourceCosts.researchSeconds));
      assert(!D.unlockedTech(faction).includes(node.id));
    }
  }
  for (const row of manifest) {
    const prefab = G.catalog.prefabs.find((p) => p.id === row.id);
    assert(prefab, row.id);
    assert(!prefab.formOnly, row.id);
    assert(prefab.weaponKits.some((kit) => G.models[row.id + "__" + kit.id]));
    for (const id of row.tech)
      assert(
        Object.values(tree)
          .flat()
          .find((n) => n.id === id)
          .unlocks.includes(row.id),
      );
  }
});

test("early and late eras remain distinct, with Stardust and GP units classified as 0083", () => {
  for (const row of manifest) {
    const prefab = G.catalog.prefabs.find((p) => p.id === row.id);
    const expected = early.has(row.id)
      ? "0079E"
      : row.tech.some((id) => /_(OperationStardust|GPProject)$/.test(id))
        ? "0083"
        : "0079L";
    assert(prefab.tags.includes(expected), row.id);
    assert.equal(prefab.tags.filter((tag) => /^\d{4}(?:[EL])?$/.test(tag)).length, 1);
  }
  assert(G.eras.includes("0079E") && G.eras.includes("0079L") && G.eras.includes("0083"));
  assert.deepEqual(G.validateTagRestrictions({ bannedEras: ["0079"] }).bannedEras, [
    "0079E",
    "0079L",
  ]);
  assert.equal(
    G.restrictionReason(G.models.RGM_79__machine_gun, { bannedEras: ["0079"] }),
    "not_allowed",
  );
});

test("GP02 can be fielded by either faction only after that faction develops it", () => {
  const prefab = G.catalog.prefabs.find((p) => p.id === "RX_78GP02A");
  const model = G.models[prefab.id + "__" + prefab.weaponKits[0].id];
  for (const faction of ["EFSF", "ZEON"]) {
    const researched = D.normalizeResearch({ [faction]: tree[faction].map((node) => node.id) });
    assert.equal(G.restrictionReason(model, { characterFaction: faction, researched }), null);
    assert.equal(G.restrictionReason(model, { characterFaction: faction }), "not_developed");
    const offer = production.offers[production.baseModels[prefab.id]];
    assert(offer.availableFactions.includes(faction));
  }
});

test("every second-page unit has a source-backed factory offer and no invalid EN weapon is playable", () => {
  for (const row of manifest) {
    const offer = production.offers[production.baseModels[row.id]];
    assert(offer && offer.quantity >= 1, row.id);
    assert(offer.source.file.includes("Factory/UnitList"));
    assert(offer.source.outputs.some((output) => output.unitId === row.id));
    assert(offer.money >= 0 && offer.supplies >= 0);
    for (const model of Object.values(G.models).filter((model) => model.prefabId === row.id))
      for (const weapon of model.weapons) assert(weapon.en <= model.en, row.id + "/" + weapon.id);
  }
});

test("shared clips use original animation names and retain unit-specific curves without hash filenames", () => {
  const refs = new Set();
  for (const prefab of G.catalog.prefabs) {
    const base = path.resolve("assets/units", prefab.id);
    for (const [clip, reference] of Object.entries(prefab.animations)) {
      const file = path.resolve(base, reference);
      const stem = path.basename(file, ".json");
      assert(stem === clip || stem.startsWith(clip + "__"), prefab.id + "/" + clip);
      assert(!/^shared_[a-f\d]+$/.test(stem));
      assert(fs.existsSync(file));
      refs.add(file);
    }
  }
  assert(refs.size < 120, "shared clips should not grow with the number of units");
});

test("space Pale Rider HADES is a linked conversion form with inherited late-era classification", () => {
  const prefab = G.catalog.prefabs.find((p) => p.id === "RX_80PR_SpaceType");
  const skill = prefab.skills.find((skill) => skill.type === "overdrive");
  assert(skill);
  const form = G.catalog.prefabs.find((p) => p.id === skill.formUnitId);
  assert(form.formOnly && form.tags.includes("0079L"));
  for (const kit of prefab.weaponKits)
    assert(form.weaponKits.some((target) => target.id === skill.formKits[kit.id]));
});
