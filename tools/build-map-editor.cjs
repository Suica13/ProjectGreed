"use strict";
const fs = require("node:fs"),
  path = require("node:path");
function buildMapEditor(root = path.resolve(__dirname, "..")) {
  const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
  const script = (source) => source.replace(/<\/script/gi, "<\\/script");
  const version = JSON.parse(read("project.json")).version;
  const html = read("map-editor/editor.html")
    .replace("__VERSION__", () => version)
    .replace("__EDITOR_CSS__", () => read("map-editor/editor.css"))
    .replace("__MAP_DOCUMENT__", () =>
      script("globalThis.ProjectGreedMapAssets = " + JSON.stringify(Object.fromEntries(JSON.parse(read("assets/maps/biomes/catalog.json")).biomes.map(id => ["asset:biome-"+id,"data:image/png;base64,"+fs.readFileSync(path.join(root,"assets/maps/biomes",id,"tiles.png")).toString("base64")]).concat([["asset:encounter-pixel-props-v1","data:image/png;base64,"+fs.readFileSync(path.join(root,"assets/maps/tilesets/encounter-pixel-props-v1.png")).toString("base64")]]))) + ";\n" + read("shared/technology-eras.js") + "\n" + read("shared/mission-mode.js") + "\n" + read("shared/map-document.js") + "\n" + read("shared/biome-tiles.js") + "\n" + read("shared/tilemap-view.js")),
    )
    .replace("__EDITOR_JS__", () => script("const MapEditorUnits = " + JSON.stringify(JSON.parse(read("assets/unit-catalog.json")).units.map(file => { const u = JSON.parse(read("assets/" + file)); return {id:u.id,name:u.name,kits:(u.weaponKits || []).map(k=>({id:k.id,name:k.name}))}; })) + ";\n" + "const MAP_EDITOR_LOCALES = " + JSON.stringify(JSON.parse(read("map-editor/locales.json"))) + ";\n" + read("map-editor/i18n.js") + "\n" + read("map-editor/authoring.js") + "\n" + read("map-editor/editor.js") + "\nconst MissionEditorData = " + JSON.stringify({sample:JSON.parse(read("assets/maps/missions/white_base.json")),pilots:JSON.parse(read("shared/pilots.json")).aces.map(p=>({id:p.id,name:p.name,icon:p.icon})),portraits:Object.fromEntries(JSON.parse(read("shared/pilots.json")).aces.map(p=>[p.icon,"data:image/png;base64,"+fs.readFileSync(path.join(root,p.icon)).toString("base64")]))}) + ";\n" + read("map-editor/mission-editor.js")));
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public/map-editor.html"), html);
  console.log("Built map-editor.html: " + Buffer.byteLength(html) + " bytes");
}
module.exports = { buildMapEditor };
if (require.main === module) buildMapEditor();
