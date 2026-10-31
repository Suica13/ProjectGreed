/* 扫描项目内 unit.json，先完整校验，再更新目录和网页。不会调用 MOD 导入器。 */
"use strict";
const WeaponStore = require("./weapon-store.cjs");
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const { loadCatalog } = require("./load-catalog.cjs");
const root = path.resolve(__dirname, "..");
const readJSON = (name) => WeaponStore.parse(fs.readFileSync(name, "utf8").replace(/^\uFEFF/, ""));
function discoverUnits(directory, assetsDirectory = path.dirname(directory)) {
  const found = [];
  function walk(current) {
    for (const entry of fs
      .readdirSync(current, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name, "en"))) {
      if (entry.isSymbolicLink()) continue;
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.isFile() && entry.name === "unit.json") {
        let unit;
        try {
          unit = readJSON(target);
        } catch (error) {
          throw Error("Invalid unit JSON: " + target + "\n" + error.message);
        }
        if (unit.enabled !== false)
          found.push(path.relative(assetsDirectory, target).split(path.sep).join("/"));
      }
    }
  }
  walk(directory);
  return found;
}
function nextCatalog(previous, discovered) {
  const found = new Set(discovered);
  const kept = previous.units.filter((reference) => found.has(reference));
  return {
    ...previous,
    units: [...kept, ...discovered.filter((reference) => !kept.includes(reference))],
  };
}
function reloadUnits({ checkOnly = false } = {}) {
  const catalogFile = path.join(root, "assets/unit-catalog.json"),
    original = fs.readFileSync(catalogFile, "utf8");
  const candidate = nextCatalog(
    WeaponStore.parse(original.replace(/^\uFEFF/, "")),
    discoverUnits(path.join(root, "assets/units")),
  );
  if (!candidate.units.length)
    throw Error("No enabled units found. The current catalog was not changed.");
  // 复用服务端的完整校验：ID、套件、数值、贴图、骨骼、动画、弹丸和音效。
  const validated = loadCatalog({ catalogOverride: candidate });
  console.log(
    "Validated " +
      validated.prefabs.length +
      " units / " +
      Object.keys(validated.models).length +
      " weapon kits.",
  );
  for (const prefab of validated.prefabs) console.log("  " + prefab.id + " - " + prefab.name);
  if (checkOnly) return validated;
  try {
    fs.writeFileSync(catalogFile, WeaponStore.stringify(candidate, null, 2) + "\n");
    const result = spawnSync(process.execPath, [path.join(root, "build.cjs")], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) throw Error("Client build failed.");
  } catch (error) {
    fs.writeFileSync(catalogFile, original);
    throw error;
  }
  console.log("Unit catalog and public HTML updated.");
  console.log(
    "Restart this game's server, then refresh the browser. Existing rooms do not hot-reload units.",
  );
  console.log("To refresh the downloadable ZIP, run: npm run package:client");
  return validated;
}
if (require.main === module) {
  try {
    reloadUnits({ checkOnly: process.argv.includes("--check") });
  } catch (error) {
    console.error("Reload failed: " + error.message);
    process.exitCode = 1;
  }
}
module.exports = { discoverUnits, nextCatalog, reloadUnits };
