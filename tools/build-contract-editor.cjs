"use strict";
const fs = require("node:fs"), path = require("node:path");
function buildContractEditor(root = path.resolve(__dirname, "..")) {
  const read = file => fs.readFileSync(path.join(root, file), "utf8");
  const version = JSON.parse(read("project.json")).version;
  const catalog = require("../contract-editor/catalog.cjs");
  const Model = require("../contract-editor/model.js");
  const errors = Model.validate(Model.create(catalog, version));
  if (errors.length) throw Error(errors.join("\n"));
  const inline = value => value.replace(/<\/script/gi, "<\\/script");
  const data = { version, catalog, kinds: require("../shared/contract-mode.js").kinds };
  const html = read("contract-editor/editor.html")
    .replace("__VERSION__", () => version)
    .replace("__CSS__", () => read("contract-editor/editor.css"))
    .replace("__DATA__", () => inline("const EDITOR_DATA = " + JSON.stringify(data) + ";"))
    .replace("__JS__", () => inline(read("contract-editor/model.js") + "\n" + read("contract-editor/editor.js")));
  const output = path.join(root, "admin/contract-event-editor.html");
  const release = path.join(root, "build", version, "admin/contract-event-editor.html");
  for (const file of [output, release]) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, html);
  }
  console.log("Built admin/contract-event-editor.html: " + Buffer.byteLength(html) + " bytes");
  return { output, release };
}
module.exports = { buildContractEditor };
if (require.main === module) buildContractEditor();
