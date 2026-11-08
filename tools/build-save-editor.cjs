"use strict";
const fs = require("node:fs"),
  path = require("node:path");
function buildSaveEditor(root = path.resolve(__dirname, "..")) {
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const catalog = require("./load-catalog.cjs").loadCatalog({ embedAssets: false });
  // Save validation needs model statistics, forms, aliases and hangars, not weapons or rendering graphs.
  const metadata = ({
    weapons,
    layers,
    materials,
    animations,
    skeleton,
    presentation,
    source,
    conversionBase,
    ...rest
  }) => rest;
  const art = {
    models: Object.fromEntries(
      Object.entries(catalog.models).map(([id, model]) => [id, metadata(model)]),
    ),
    prefabs: catalog.prefabs.map(metadata),
    formation: catalog.formation,
    map: catalog.map,
    maps: {},
    defaultMap: catalog.defaultMap,
  };
  const headers = {
    ART: art,
    PILOT_DATA: JSON.parse(read("shared/pilots.json")),
    DEVELOPMENT_TREE: JSON.parse(read("shared/development-tree.json")),
    STARTER_PROFILE: JSON.parse(read("shared/starter-profile.json")),
    PRODUCTION_CATALOG: require("../shared/production-data.cjs"),
    AI_UNIT_BANS: JSON.parse(read("shared/ai-unit-bans.json")),
  };
  const modules = [
    "shared/save-codec.js",
    "client/profile-storage.js",
    "client/profile-identity.js",
    "shared/profile-migrations.js",
    "shared/weapon-classes.js",
    "shared/weapon-sequence.js",
    "shared/unit-parts.js",
    "shared/unit-skills.js",
    "shared/hangars.js",
    "shared/pilots.js",
    "shared/economy.js",
    "shared/development.js",
    "shared/battlefield-climate.js",
    "shared/unit-sensors.js",
    "shared/ai-tactics.js",
    "shared/battlefield-mode.js",
    "shared/campaign-battlefield.js",
    "shared/automatic-fire.js",
    "shared/rules.js",
  ];
  const compressed = require("node:zlib")
    .gzipSync(Buffer.from(JSON.stringify(headers)), { level: 9 })
    .toString("base64");
  const inflate = require("esbuild").buildSync({
    stdin: { contents: 'export { gunzipSync } from "fflate";', resolveDir: root },
    bundle: true,
    write: false,
    format: "iife",
    globalName: "EditorInflate",
    minify: true,
  }).outputFiles[0].text;
  const source = `/*! ${read("node_modules/fflate/LICENSE")} */
${inflate}
(() => {\nconst memory = new Map();
    const localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,String(v)), removeItem: k => memory.delete(k) };
    const editorCatalog = JSON.parse(new TextDecoder().decode(EditorInflate.gunzipSync(Uint8Array.from(atob("${compressed}"), c => c.charCodeAt(0)))));
    ${Object.keys(headers)
      .map((key) => "const " + key + "=editorCatalog." + key + ";")
      .join("\n")}
    ${modules.map(read).join("\n;\n")}
    const Rules = Tactics;
    ${read("client/profile-save-core.js")}
    ${read("save-editor/editor.js")}
  })();`;
  const html = read("save-editor/editor.html")
    .replace("__STYLE__", () => read("save-editor/editor.css"))
    .replace("__SCRIPT__", () => source.replace(/<\/script/gi, "<\\/script"));
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public/save-editor.html"), html);
  console.log("Built save-editor.html: " + Buffer.byteLength(html) + " bytes");
}
module.exports = { buildSaveEditor };
if (require.main === module) buildSaveEditor();
