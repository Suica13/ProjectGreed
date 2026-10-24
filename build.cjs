"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
// HTML 解析器会把字符串里的 </script> 也当作脚本结束符。
const inlineScript = (source) => source.replace(/<\/script/gi, "<\\/script");
let html = read("client/template.html");
const project = JSON.parse(read("project.json"));
const clientConfig = JSON.parse(read("client/config.json"));
if (
  typeof clientConfig.defaultServerAddress !== "string" ||
  !clientConfig.defaultServerAddress.trim()
)
  throw Error("client/config.json: defaultServerAddress must be a non-empty server address");
html = html
  .replaceAll("__PROJECT_NAME__", project.name)
  .replaceAll("__PROJECT_VERSION__", project.version)
  .replace("__PROJECT_META__", json(project))
  .replace("__CLIENT_CONFIG__", json(clientConfig));
for (const [key, file] of [
  ["DATA", null],
  ["FORMATION", "client/formation.js"],
  ["CORE", "shared/rules.js"],
  ["WEAPON_SEQUENCE", "shared/weapon-sequence.js"],
  ["RENDERER", "client/renderer.js"],
  ["SPRITE_EFFECTS", "client/sprite-effects.js"],
  ["BATTLE_SCENE", "client/battle-scene.js"],
  ["BATTLE_WINDOW", "client/battle-window.js"],
  ["WEAPON_EFFECTS", "client/weapon-effects.js"],
  ["WEAPON_AUDIO", "client/weapon-audio.js"],
  ["MUSIC", "client/music.js"],
  ["APP", "client/app.js"],
  ["TURN_FLOW", "client/turn-flow.js"],
  ["MAP_CAMERA", "client/map-camera.js"],
  ["NETWORK", "client/network.js"],
  ["LOBBY", "client/lobby.js"],
  ["ROOM", "client/room.js"],
])
  html = html.replace("__" + key + "__", () =>
    key === "DATA"
      ? JSON.stringify(
          require("./tools/load-catalog.cjs").loadCatalog({ embedMusic: true }),
        ).replace(/</g, "\\u003c")
      : inlineScript(read(file)),
  );
const layout = JSON.parse(read("client/ui-layout.json"));
html = html.replace(
  "</body>",
  () =>
    `<script type="application/json" id="ui-layout-data">${json(layout)}</script><script id="ui-layout-runtime">${inlineScript(read("client/ui-layout.js"))}</script></body>`,
);
const release = html;
const developer = release
  .replace(
    `<title>${project.name} ${project.version}</title>`,
    `<title>${project.name} ${project.version} · 开发者版</title>`,
  )
  .replace(
    "</body>",
    () =>
      `<style id="ui-editor-css" data-developer-only>${read("client/ui-editor.css")}</style><template id="ui-editor-template" data-developer-only>${read("client/ui-editor-panel.html")}</template><script type="application/json" id="ui-release-template" data-developer-only>${json(release)}</script><script type="application/json" id="ui-preview-source" data-developer-only>${json(read("client/ui-preview.js"))}</script><script id="ui-layout-editor" data-developer-only>${inlineScript(read("client/ui-editor.js"))}</script></body>`,
  );
fs.mkdirSync(path.join(root, "public"), { recursive: true });
for (const [name, content] of [
  ["index.html", release],
  ["client.html", release],
  ["developer.html", developer],
])
  fs.writeFileSync(path.join(root, "public", name), content);
console.log(
  "Built release:",
  Buffer.byteLength(release),
  "bytes; developer:",
  Buffer.byteLength(developer),
  "bytes",
);
