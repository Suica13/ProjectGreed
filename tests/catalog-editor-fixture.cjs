const fs = require("node:fs"),
  path = require("node:path"),
  os = require("node:os");
const Codec = require("../tools/weapon-store.cjs");
const { loadCatalog } = require("../tools/load-catalog.cjs");
const { createEditorStore } = require("../tools/catalog-editor-store.cjs");
function editorFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "greed-editor-"));
  const source = path.resolve(__dirname, "..");
  const references = require("../assets/unit-catalog.json").units;
  for (const file of [
    "assets/unit-catalog.json",
    "assets/unit-wip.json",
    "assets/weapons.json",
    "shared/editor-adjustments.json",
    "shared/conversion-rules.json",
    "assets/localization/units.json",
    "shared/production-catalog.json",
    "shared/development-tree.json",
    "shared/pilots.json",
    "MS与舰船例外列表.md",
    ...references.map((ref) => "assets/" + ref),
  ]) {
    const target = path.join(root, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(source, file), target);
  }
  const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  const catalog = () => {
    const definitions = read("assets/weapons.json").definitions;
    return loadCatalog({
      catalogOverride: read("assets/unit-catalog.json"),
      adjustmentsOverride: read("shared/editor-adjustments.json"),
      conversionOverride: read("shared/conversion-rules.json"),
      weaponDefinitionsOverride: definitions,
      wipOverride: read("assets/unit-wip.json"),
      unitOverrides: Object.fromEntries(references.map((ref) => [ref, read("assets/" + ref)])),
    });
  };
  return {
    root,
    read,
    catalog,
    store: createEditorStore(root, catalog),
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}
module.exports = { editorFixture };
