const test = require("node:test"),
  assert = require("node:assert/strict");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
const { createEditorStore } = require("../tools/catalog-editor-store.cjs");
test("isolated saves reuse validated unrelated units and refresh without recompiling", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  let calls = 0,
    last;
  const store = createEditorStore(f.root, (options) => {
    calls++;
    last = options;
    return f.catalog(options);
  });
  const before = store.catalog(),
    count = calls,
    draft = { ...store.getUnit("RX_78_2"), id: "RX_78_2" };
  draft.unit.stats.hp += 25;
  const saved = store.saveUnit(draft);
  assert.equal(calls, count + 1);
  assert.deepEqual(last.changedUnits, ["RX_78_2"]);
  const after = store.catalog();
  assert.equal(calls, count + 1);
  const modelId = Object.keys(after.models).find((id) => after.models[id].prefabId === "RX_78_2");
  assert.equal(after.models.RGM_79__machine_gun, before.models.RGM_79__machine_gun);
  assert.notEqual(after.models[modelId], before.models[modelId]);
  assert.deepEqual(saved.affectedUnits, ["RX_78_2"]);
  assert.equal(Object.keys(after.assets).length, 0);
  const retry = { ...store.getUnit("RX_78_2"), id: "RX_78_2" };
  retry.unit.stats.hp = -1;
  assert.throws(() => store.saveUnit(retry));
  assert.equal(store.catalog().models[modelId].hp, after.models[modelId].hp);
});
test("per-weapon AP component and resistance edits persist as additive exceptions", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const Schema = require("../shared/catalog-editor-schema.js");
  const d = { ...f.store.getUnit("RX_78_2"), id: "RX_78_2" },
    w = d.unit.weapons.EF_HypeBazooka;
  Schema.setComponentDamage(w, "shellAP", 500);
  w.armorPiercingIgnore = 0.75;
  f.store.saveUnit(d);
  const saved = f.store.getUnit(d.id).unit.weapons.EF_HypeBazooka;
  assert.equal(saved.damageComponents.shellAP, 500);
  assert.equal(saved.armorPiercingIgnore, 0.75);
  const deltas = f.read("shared/editor-adjustments.json").units.RX_78_2;
  assert.equal(deltas["/weapons/EF_HypeBazooka/armorPiercingIgnore"], 0.25);
  const bad = { ...f.store.getUnit(d.id), id: d.id };
  bad.unit.weapons.EF_HypeBazooka.armorPiercingIgnore = 1.1;
  assert.throws(() => f.store.saveUnit(bad), /穿甲/);
  const rules = f.store.getConversion();
  rules.rules.weapons.armorPiercingIgnore = 0.6;
  f.store.saveConversion(rules);
  assert.equal(f.store.getUnit(d.id).unit.weapons.EF_HypeBazooka.armorPiercingIgnore, 0.85);
  assert.equal(f.store.getWeapon("EF_HypeBazooka__lv2").weapon.armorPiercingIgnore, 0.6);
});

test("external JSON edits invalidate compiled caches and reject stale editor revisions", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const store = createEditorStore(f.root, (options) => f.catalog(options));
  const before = store.catalog(),
    stale = { ...store.getUnit("RX_78_2"), id: "RX_78_2" };
  const fs = require("node:fs"),
    path = require("node:path"),
    file = "assets/units/RGM_79/unit.json";
  const raw = f.read(file);
  raw.stats.hp += 100;
  fs.writeFileSync(path.join(f.root, file), JSON.stringify(raw, null, 2));
  assert.throws(
    () => store.saveUnit(stale),
    (error) => error.status === 409,
  );
  assert.equal(
    store.catalog().models.RGM_79__machine_gun.hp,
    before.models.RGM_79__machine_gun.hp + 100,
  );
});
