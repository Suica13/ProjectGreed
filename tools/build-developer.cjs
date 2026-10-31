/* Tiny standalone login shell; authenticated backend supplies all live catalog data. */
const fs = require("node:fs"),
  path = require("node:path");
function buildDeveloper(root) {
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const inline = (source) => source.replace(/<\/script/gi, "<\\/script");
  const template = read("client/template.html");
  let css = [...template.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
    .map((match) => match[1])
    .join("\n");
  for (const [key, file] of Object.entries({
    BATTLE_HUD_CSS: "client/battle-hud.css",
    MENU_SHELL_CSS: "client/menu-shell.css",
    BLUE_THEME_CSS: "client/blue-theme.css",
    LANDSCAPE_VIEWPORT_CSS: "client/landscape-viewport.css",
  }))
    css = css.replaceAll("__" + key + "__", read(file));
  css += "\n" + read("client/catalog-developer.css");
  const preview = template.slice(
    template.indexOf('      <div id="formationUnitDetail"'),
    template.indexOf('      <div id="customPilotPanel"'),
  );
  const start = template.indexOf('    <section id="encyclopediaScreen"'),
    end = template.indexOf("</section>", start) + "</section>".length;
  if (start < 0 || end < start || !preview.includes("formationDetailTitle"))
    throw Error("Missing shared catalog markup");
  const runtime =
    [
      "shared/asset-pool.js",
      "client/catalog-runtime.js",
      "client/i18n.js",
      "client/dialog.js",
      "shared/weapon-classes.js",
      "shared/weapon-sequence.js",
      "shared/unit-parts.js",
      "shared/catalog-editor-schema.js",
      "client/weapon-info.js",
      "client/renderer.js",
      "client/skill-controls.js",
      "client/unit-catalog.js",
      "client/unit-preview.js",
      "client/catalog-preview.js",
      "client/encyclopedia.js",
      "client/catalog-developer.js",
    ]
      .map(read)
      .join("\n") + "\nI18n.bindCatalog(ART); I18n.start(); delete window.catalogBootstrap;";
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ProjectGreed 配置编辑</title><style>${css}</style></head><body>
<section id="editorLoginScreen"><form id="editorLogin"><h1>配置编辑</h1><label>编辑服务器IP／地址<input id="editorServerAddress" type="text" required autocomplete="off" placeholder="http://192.168.1.10:1314"></label><label>密钥<input id="editorAccessKey" type="password" required autocomplete="off"></label><p id="editorLoginStatus" role="status">输入服务器地址和密钥后连接。</p><button id="confirmEditorLogin" type="submit">确认</button></form></section>
${template.slice(start, end)}\n${preview}
<script type="text/plain" id="catalogRuntime">${inline(runtime)}</script><script>${inline(read("client/catalog-login.js"))}</script></body></html>`;
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  const target = path.join(root, "public/developer.html");
  fs.writeFileSync(target, html);
  fs.rmSync(target + ".br", { force: true });
  fs.rmSync(target + ".gz", { force: true });
  console.log(
    "Built developer.html: " +
      Buffer.byteLength(html) +
      " bytes (data loaded after authentication)",
  );
}
module.exports = { buildDeveloper };
