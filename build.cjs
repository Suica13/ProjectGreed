"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  root = __dirname;
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const zlib = require("node:zlib");
const json = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
// HTML 解析器会把字符串里的 </script> 也当作脚本结束符。
const inlineScript = (source) => source.replace(/<\/script/gi, "<\\/script");
if (process.argv.includes("--developer")) {
  require("./tools/build-developer.cjs").buildDeveloper(root);
  process.exit(0);
}
let html = read("client/template.html").replace(
  "__BATTLE_HUD_CSS__",
  () => read("client/battle-hud.css") + "\n" + read("client/mobile-layout.css"),
);
html = html.replace("__LANDSCAPE_VIEWPORT__", () => inlineScript(read("client/landscape-viewport.js")));
html = html.replace("__BATTLEFIELD_CLIMATE__", () => inlineScript(read("shared/battlefield-climate.js")));
html = html.replace("__UNIT_SENSORS__", () => inlineScript(read("shared/unit-sensors.js")));
const project = JSON.parse(read("project.json"));
const developmentTree = JSON.parse(read("shared/development-tree.json"));
const pilotData = require("./tools/display-localization.cjs")
  .createLocalizer()
  .pilotCatalog(JSON.parse(read("shared/pilots.json")));
for (const pilot of [
  ...pilotData.named,
  ...pilotData.portraits,
  ...(pilotData.aces || []),
  ...(pilotData.customSkills || []),
  ...(pilotData.aces || []).flatMap((p) => p.skills).filter((s) => s.icon),
]) {
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
  clientConfig.presetServers.length < 1 ||
  new Set(clientConfig.presetServers.map((server) => server.id)).size !== clientConfig.presetServers.length ||
  clientConfig.presetServers.some(
    (server) =>
      !/^[a-z][a-z0-9_-]*$/.test(server.id) ||
      typeof server.name !== "string" ||
      !server.name.trim() ||
      typeof server.address !== "string" ||
      !server.address.trim(),
  )
)
  throw Error("client/config.json: at least one valid named presetServer with a unique ID is required");
html = html
  .replaceAll("__PROJECT_NAME__", project.name)
  .replaceAll("__PROJECT_VERSION__", project.version)
  .replace("__PROJECT_META__", json(project))
  .replace("__DEVELOPMENT_TREE__", json(developmentTree))
  .replace("__STARTER_PROFILE__", json(require("./shared/starter-profile.json")))
  .replace("__PRODUCTION_CATALOG__", json(require("./shared/production-data.cjs")))
  .replace("__AI_UNIT_BANS__", json(require("./shared/ai-unit-bans.json")))
  .replace("__PILOT_DATA__", json(pilotData))
  .replace("__CLIENT_CONFIG__", json(clientConfig));
html = html.replace(
  "__UI_LOCALES__",
  json({
    en: JSON.parse(read("client/locales/en.json")),
    ja: JSON.parse(read("client/locales/ja.json")),
  }),
);
function clientCatalogData() {
  const catalog = require("./tools/load-catalog.cjs").loadCatalog({ embedMusic: true });
  require("./tools/export-combat-rules.cjs").writeReport(catalog);
  return JSON.stringify(require("./shared/asset-pool.js").pack(catalog)).replace(/</g, "\\u003c");
}
for (const [key, file] of [
  ["TILEMAP_VIEW", "shared/tilemap-view.js"],
  ["TILEMAP_RENDERER", "client/tilemap-renderer.js"],
  ["MENU_SHELL", "client/menu-shell.js"],
  ["DATA", null],
  ["I18N", "client/i18n.js"],
  ["ASSET_POOL", "shared/asset-pool.js"],
  ["DIALOG", "client/dialog.js"],
  ["FORMATION", "client/formation.js"],
  ["UNIT_PREVIEW", "client/unit-preview.js"],
  ["UNIT_CATALOG", "client/unit-catalog.js"],
  ["WEAPON_INFO", "client/weapon-info.js"],
  ["PILOT_REWARDS", "client/pilot-rewards.js"],
  ["REWARD_NOTIFICATIONS", "client/reward-notifications.js"],
  ["PROFILE_SAVE", "client/profile-save.js"],
  ["PROFILE_STORAGE", "client/profile-storage.js"],
  ["PROFILE_IDENTITY", "client/profile-identity.js"],
  ["SERVER_ACTIVITIES", "client/server-activities.js"],
  ["DEVELOPMENT_UI", "client/development.js"],
  ["PRODUCTION_UI", "client/production.js"],
  ["ENCYCLOPEDIA", "client/encyclopedia.js"],
  ["IRRADIATION_FX", "client/irradiation-fx.js"],
  ["SPECIAL_TRANSFORMS", "client/special-transforms.js"],
  ["PROFILE_MIGRATIONS", "shared/profile-migrations.js"],
  ["ECONOMY", "shared/economy.js"],
  ["BATTLE_ECONOMY", "shared/battle-economy.js"],
  ["UNIT_PARTS", "shared/unit-parts.js"],
  ["UNIT_SKILLS", "shared/unit-skills.js"],
  ["UNIT_HANGARS", "shared/hangars.js"],
  ["PILOTS", "shared/pilots.js"],
  ["DEVELOPMENT", "shared/development.js"],
  ["HANGAR_UI", "client/hangar-ui.js"],
  ["SFS_UI", "client/sfs-ui.js"],
  ["AI_TACTICS", "shared/ai-tactics.js"],
  ["CAMPAIGN_BATTLEFIELD", "shared/campaign-battlefield.js"],
  ["AUTOMATIC_FIRE", "shared/automatic-fire.js"],
  ["CORE", "shared/rules.js"],
  ["WEAPON_SEQUENCE", "shared/weapon-sequence.js"],
  ["WEAPON_CLASSES", "shared/weapon-classes.js"],
  ["MAP_SHADOW_LIGHTING", "client/map-shadow-lighting.js"],
  ["RENDERER", "client/renderer.js"],
  ["SPRITE_EFFECTS", "client/sprite-effects.js"],
  ["DIALOGUE_RANGE", "shared/dialogue-range.js"],
  ["BATTLE_DIALOGUE", "client/battle-dialogue.js"],
  ["DIALOGUE_AUDIO", "client/dialogue-audio.js"],
  ["BATTLEFIELD_WEATHER", "client/battlefield-weather.js"],
  ["BATTLE_SCENE", "client/battle-scene.js"],
  ["BATTLE_WINDOW", "client/battle-window.js"],
  ["WEAPON_EFFECTS", "client/weapon-effects.js"],
  ["CLIENT_SETTINGS", "client/settings.js"],
  ["WEAPON_AUDIO", "client/weapon-audio.js"],
  ["GAME_AUDIO", "client/game-audio.js"],
  ["MUSIC", "client/music.js"],
  ["SKILL_CONTROLS", "client/skill-controls.js"],
  ["APP", "client/app.js"],
  ["BATTLE_ASSETS", "client/battle-assets.js"],
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
  ["MOVEMENT_TIMING", "shared/movement-timing.js"],
  ["CAMPAIGN_PILOTS", "shared/campaign-pilots.js"],
  ["CAMPAIGN_RULES", "shared/campaign.js"],
  ["CAMPAIGN_ROOM", "shared/campaign-room.js"],
  ["ROOM_ENGINE", "shared/room-engine.js"],
  ["PLANNING_UI", "client/planning-ui.js"],
  ["MAP_COMBAT", "client/map-combat.js"],
  ["COMBAT_PLAYBACK", "client/combat-playback.js"],
  ["NETWORK", "client/network.js"],
  ["STATE_WIRE", "shared/state-wire.js"],
  ["LOCAL_ROOM", "client/local-room.js"],
  ["LOBBY", "client/lobby.js"],
  ["ROOM", "client/room.js"],
])
  html = html.replace("__" + key + "__", () =>
    key === "DATA"
      ? clientCatalogData()
      : inlineScript(read(file)),
  );
html = html.replace("</body>", () => `<style>${read("client/campaign.css")}</style><script>const CAMPAIGN_WORLD=ART.scenarios.earth_0079_mid.world;${inlineScript(read("client/campaign-workspace.js"))}${inlineScript(read("client/campaign-pilots.js"))}${inlineScript(read("client/campaign-console.js"))}${inlineScript(read("client/campaign.js"))}</script></body>`);
const layout = JSON.parse(read("client/ui-layout.json"));
html = html.replace(
  "</body>",
  () =>
    `<script type="application/json" id="ui-layout-data">${json(layout)}</script><script id="ui-layout-runtime">${inlineScript(read("client/ui-layout.js"))}</script></body>`,
);
html = html
  .replace("__MENU_SHELL_CSS__", () => read("client/menu-shell.css"))
  .replace("__BLUE_THEME_CSS__", () => read("client/blue-theme.css"));
// Fixed virtual game dimensions keep viewport-sized panels inside landscape black bars.
// Use supported vh/vw fallbacks; CSS selects dynamic units only after feature detection.
// Keep feature queries and the unit definitions themselves intact (no recursive variables).
html = html.replace("__LANDSCAPE_VIEWPORT_CSS__", () => read("client/landscape-viewport.css"));
html = html.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_, attrs, css) =>
  `<style${attrs}>${css.replace(/(@supports\s*\([^{}]*\))|(--game-v[hw]\s*:[^;{}]+)|(\d*\.?\d+)(dvh|svh|lvh|vh|dvw|svw|lvw|vw)\b/g,
    (match, support, definition, n, unit) => support || definition ||
      `calc(var(--game-v${unit.endsWith("h") ? "h" : "w"}, 1v${unit.endsWith("h") ? "h" : "w"}) * ${n})`)}</style>`);
// Explicit local-only profile grant. Normal builds never embed personal grants.
const grantFlag = process.argv.indexOf("--local-profile-grant");
if (grantFlag >= 0) {
  const grant = JSON.parse(
    fs.readFileSync(path.resolve(root, process.argv[grantFlag + 1]), "utf8"),
  );
  if (typeof grant.playerName !== "string" || !grant.playerName || !grant.award?.id)
    throw Error("Invalid local profile grant");
  const script = `(() => {
    const grant = ${json(grant)};
    if (localStorage.getItem("projectgreed.playerId") !== grant.playerName) return;
    if (Economy.creditActivity(grant.award)) console.info("Local profile inventory grant saved.");
  })();`;
  html = html.replace(
    "</body>",
    () => `<script id="local-profile-grant">${inlineScript(script)}</script></body>`,
  );
}
const outputs = [["client.html", html]];
fs.mkdirSync(path.join(root, "public"), { recursive: true });
for (const [name, content] of outputs) {
  const target = path.join(root, "public", name);
  fs.writeFileSync(target, content);
  if (process.argv.includes("--compressed")) {
    fs.writeFileSync(target + ".gz", zlib.gzipSync(content, { level: 6 }));
    fs.writeFileSync(
      target + ".br",
      zlib.brotliCompressSync(content, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 4 } }),
    );
  } else {
    // Remove previous generated copies so the default output contains only HTML.
    fs.rmSync(target + ".gz", { force: true });
    fs.rmSync(target + ".br", { force: true });
  }
}
fs.rmSync(path.join(root, "public/index.html"), { force: true });
for (const [name, content] of outputs)
  console.log("Built " + name + ": " + Buffer.byteLength(content) + " bytes");

require("./tools/build-map-editor.cjs").buildMapEditor(root);

require("./tools/build-unit-editor.cjs").buildUnitEditor(root);
