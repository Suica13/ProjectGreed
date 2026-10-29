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
      script(read("shared/map-document.js") + "\n" + read("shared/tilemap-view.js")),
    )
    .replace("__EDITOR_JS__", () => script(read("map-editor/editor.js")));
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public/map-editor.html"), html);
  console.log("Built map-editor.html: " + Buffer.byteLength(html) + " bytes");
}
module.exports = { buildMapEditor };
if (require.main === module) buildMapEditor();
