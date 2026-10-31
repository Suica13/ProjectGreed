const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { loadCatalog } = require("../tools/load-catalog.cjs");

test("data-only catalog keeps editable units and weapons without reading image binaries", () => {
  const original = fs.readFileSync;
  let catalog;
  fs.readFileSync = function (filename, ...args) {
    assert(!/\.(png|jpg|jpeg|webp)$/i.test(String(filename)), "Unexpected image read: " + filename);
    return original.call(this, filename, ...args);
  };
  try { catalog = loadCatalog({ embedAssets: false }); }
  finally { fs.readFileSync = original; }
  assert.deepEqual(catalog.assets, {});
  assert(catalog.prefabs.length > 300);
  assert(Object.values(catalog.models).some((model) => model.weapons.length && model.hp > 0));
});
