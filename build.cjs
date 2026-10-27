"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
// HTML 解析器会把字符串里的 </script> 也当作脚本结束符。
const inlineScript = (source) => source.replace(/<\/script/gi, "<\\/script");
let html = read("client/template.html").replace(
  "__BATTLE_HUD_CSS__",
  () => read("client/battle-hud.css") + "\n" + read("client/mobile-layout.css"),
);
html = html.replace("__UNIT_SENSORS__", () => inlineScript(read("shared/unit-sensors.js")));
const project = JSON.parse(read("project.json"));
const developmentTree = JSON.parse(read("shared/development-tree.json"));
const pilotData = JSON.parse(read("shared/pilots.json"));
for (const pilot of [...pilotData.named, ...pilotData.portraits]) {
  if (!/^assets\/pilots\/[\w-]+\.png$/.test(pilot.icon))
    throw Error("Invalid pilot icon: " + pilot.id);
  pilot.icon =
    "data:image/png;base64," + fs.readFileSync(path.join(root, pilot.icon)).toString("base64");
}
for (const nodes of Object.values(developmentTree))
  for (const node of nodes) {
    if (!/^assets\/tech-icons\/[\w-]+\.png$/.test(node.icon))
      throw Error("Invalid technology icon: " + node.id);
    node.icon =
      "data:image/png;base64," + fs.readFileSync(path.join(root, node.icon)).toString("base64");
  }
const clientConfig = JSON.parse(read("client/config.json"));
if (typeof clientConfig.defaultServerAddress !== "string")
  throw Error(
    "client/config.json: defaultServerAddress must be a string (empty means manual input)",
  );
if (
  !Array.isArray(clientConfig.presetServers) ||
  clientConfig.presetServers.length !== 2 ||
  new Set(clientConfig.presetServers.map((server) => server.id)).size !== 2 ||
  clientConfig.presetServers.some(
    (server) =>
      !/^[a-z][a-z0-9_-]*$/.test(server.id) ||
      typeof server.name !== "string" ||
      !server.name.trim() ||
      typeof server.address !== "string" ||
      !server.address.trim(),
  )
)
  throw Error("client/config.json: exactly two valid named presetServers are required");
html = html
  .replaceAll("__PROJECT_NAME__", project.name)
  .replaceAll("__PROJECT_VERSION__", project.version)
  .replace("__PROJECT_META__", json(project))
  .replace("__DEVELOPMENT_TREE__", json(developmentTree))
  .replace("__PRODUCTION_CATALOG__", json(JSON.parse(read("shared/production-catalog.json"))))
  .replace("__PILOT_DATA__", json(pilotData))
  .replace("__CLIENT_CONFIG__", json(clientConfig));
html = html.replace(
  "__UI_LOCALES__",
  json({
    en: JSON.parse(read("client/locales/en.json")),
    ja: JSON.parse(read("client/locales/ja.json")),
  }),
);
for (const [key, file] of [
  ["DATA", null],
  ["I18N", "client/i18n.js"],
  ["DIALOG", "client/dialog.js"],
  ["FORMATION", "client/formation.js"],
  ["UNIT_CATALOG", "client/unit-catalog.js"],
  ["WEAPON_INFO", "client/weapon-info.js"],
  ["PILOT_REWARDS", "client/pilot-rewards.js"],
  ["PROFILE_SAVE", "client/profile-save.js"],
  ["DEVELOPMENT_UI", "client/development.js"],
  ["PRODUCTION_UI", "client/production.js"],
  ["KIT_SHOP", "client/kit-shop.js"],
  ["ECONOMY", "shared/economy.js"],
  ["BATTLE_ECONOMY", "shared/battle-economy.js"],
  ["UNIT_PARTS", "shared/unit-parts.js"],
  ["UNIT_SKILLS", "shared/unit-skills.js"],
  ["UNIT_HANGARS", "shared/hangars.js"],
  ["PILOTS", "shared/pilots.js"],
  ["DEVELOPMENT", "shared/development.js"],
  ["HANGAR_UI", "client/hangar-ui.js"],
  ["CORE", "shared/rules.js"],
  ["WEAPON_SEQUENCE", "shared/weapon-sequence.js"],
  ["RENDERER", "client/renderer.js"],
  ["SPRITE_EFFECTS", "client/sprite-effects.js"],
  ["BATTLE_SCENE", "client/battle-scene.js"],
  ["BATTLE_WINDOW", "client/battle-window.js"],
  ["WEAPON_EFFECTS", "client/weapon-effects.js"],
  ["CLIENT_SETTINGS", "client/settings.js"],
  ["WEAPON_AUDIO", "client/weapon-audio.js"],
  ["GAME_AUDIO", "client/game-audio.js"],
  ["MUSIC", "client/music.js"],
  ["SKILL_CONTROLS", "client/skill-controls.js"],
  ["APP", "client/app.js"],
  ["BATTLE_HUD", "client/battle-hud.js"],
  ["BATTLE_PROMPTS", "client/battle-prompts.js"],
  ["STARTUP_LOADING", "client/startup-loading.js"],
  ["UNIT_IDENTITY", "client/unit-identity.js"],
  ["TURN_FLOW", "client/turn-flow.js"],
  ["MAP_CAMERA", "client/map-camera.js"],
  ["PLAYER_PROFILE", "client/player-profile.js"],
  ["CHAT_CHANNELS", "shared/chat-channels.js"],
  ["CHAT", "client/chat.js"],
  ["MATCH_RESULTS", "client/match-results.js"],
  ["ATTACK_PLANS", "shared/attack-plans.js"],
  ["MATCH_RECORDS", "shared/match-records.js"],
  ["REPLAY_PLAYER", "client/replay-player.js"],
  ["ROOM_ENGINE", "shared/room-engine.js"],
  ["PLANNING_UI", "client/planning-ui.js"],
  ["MAP_COMBAT", "client/map-combat.js"],
  ["COMBAT_PLAYBACK", "client/combat-playback.js"],
  ["NETWORK", "client/network.js"],
  ["LOCAL_ROOM", "client/local-room.js"],
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
      `<style data-developer-only>${read("client/source-editor.css")}</style><script id="source-editor" data-developer-only>${inlineScript(read("client/source-editor.js"))}</script></body>`,
  );
fs.mkdirSync(path.join(root, "public"), { recursive: true });
for (const [name, content] of [
  ["client.html", release],
  ["developer.html", developer],
])
  fs.writeFileSync(path.join(root, "public", name), content);
fs.rmSync(path.join(root, "public/index.html"), { force: true });
console.log(
  "Built release:",
  Buffer.byteLength(release),
  "bytes; developer:",
  Buffer.byteLength(developer),
  "bytes",
);
