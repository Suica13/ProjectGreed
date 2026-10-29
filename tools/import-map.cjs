/* Validate before replacing a map or its catalog registration. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path");
const M = require("../shared/map-document.js"),
  { loadCatalog } = require("./load-catalog.cjs");
function importMap(filename, { checkOnly = false } = {}) {
  const root = path.resolve(__dirname, ".."),
    input = path.resolve(filename);
  if (fs.statSync(input).size > 64 * 1024 * 1024) throw Error("地图文件不得超过64MB。");
  const doc = M.importMap(JSON.parse(fs.readFileSync(input, "utf8").replace(/^\uFEFF/, "")));
  const catalogFile = path.join(root, "assets/unit-catalog.json");
  const catalog = JSON.parse(fs.readFileSync(catalogFile, "utf8"));
  const issues = M.gameIssues(doc, catalog.formation.maxUnits);
  if (issues.length) throw Error(issues.join("\n"));
  const map = M.compile(doc),
    reference = "maps/" + doc.id + ".json";
  if (!catalog.maps.includes(reference)) catalog.maps.push(reference);
  loadCatalog({ catalogOverride: catalog, mapOverrides: { [reference]: map } });
  if (!checkOnly) {
    const target = path.join(root, "assets", reference),
      temporary = target + ".tmp";
    fs.writeFileSync(temporary, JSON.stringify(map, null, 2) + "\n");
    fs.renameSync(temporary, target);
    fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + "\n");
  }
  return { id: map.id, checkOnly };
}
module.exports = { importMap };
if (require.main === module) {
  try {
    const file = process.argv.slice(2).find((a) => a !== "--check");
    if (!file) throw Error("用法：npm run maps:import -- 地图.json [--check]");
    const result = importMap(file, { checkOnly: process.argv.includes("--check") });
    console.log(
      result.checkOnly
        ? "地图校验通过：" + result.id
        : "已注册地图：" + result.id + "。请构建客户端并重启服务端。",
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
