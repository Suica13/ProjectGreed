"use strict";
// Package the single generated client for both native hosts, without copying game logic.
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const root = path.resolve(__dirname, ".."),
  output = path.join(root, "build/app-client/content");
function buildAppClient() {
  fs.mkdirSync(path.join(output, "assets"), { recursive: true });
  const legacy = require("./build-app-legacy.cjs");
  let html = fs.readFileSync(path.join(root, "public/client.html"), "utf8");
  const project = require("../project.json");
  if (!html.includes(JSON.stringify(project))) throw Error("Run npm run build first");
  html = require("../shared/catalog-codec.cjs").expandHTML(html);
  const assets = new Map();
  const extensions = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "audio/ogg": "ogg",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "font/woff2": "woff2",
    "font/woff": "woff",
  };
  html = html.replace(
    /data:([\w.+-]+\/[\w.+-]+);base64,([A-Za-z0-9+/]+={0,2})/g,
    (uri, mime, base64) => {
      if (!extensions[mime] || base64.length < 48) return uri;
      const bytes = Buffer.from(base64, "base64");
      if (bytes.toString("base64") !== base64) return uri;
      const hash = crypto.createHash("sha256").update(bytes).digest("hex");
      const name = `assets/${hash}.${extensions[mime]}`;
      if (!assets.has(name)) {
        fs.writeFileSync(path.join(output, name), bytes);
        assets.set(name, { path: name, bytes: bytes.length, sha256: hash });
      }
      return name;
    },
  );
  html = legacy.prepareLegacy(html, root, output);
  fs.mkdirSync(path.join(output, "scripts"), { recursive: true });
  const scripts = new Set();
  let scriptIndex = 0;
  html = html.replace(
    /<script\s+id="art"\s+type="application\/json">([\s\S]*?)<\/script>/,
    (_, catalog) => {
      const name = "scripts/catalog.js";
      fs.writeFileSync(
        path.join(output, name),
        "globalThis.__PG_PACKED_ART__ = " + catalog.trim() + ";",
      );
      scripts.add(name);
      return `<script src="${name}"></script>`;
    },
  );
  html = html.replace(
    'JSON.parse(document.getElementById("art").textContent)',
    "globalThis.__PG_PACKED_ART__",
  );
  html = html.replace(
    'document.getElementById("art").remove();',
    "delete globalThis.__PG_PACKED_ART__;",
  );

  html = html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (whole, attributes, source) => {
    if (!source.trim() || /\bsrc\s*=|type\s*=\s*["']application\/json/.test(attributes))
      return whole;
    const name = `scripts/client-${String(++scriptIndex).padStart(2, "0")}.js`;
    fs.writeFileSync(path.join(output, name), legacy.transformScript(source));
    scripts.add(name);
    return `<script${attributes} src="${name}"></script>`;
  });
  for (const name of fs.readdirSync(path.join(output, "scripts")))
    if (!scripts.has("scripts/" + name)) fs.unlinkSync(path.join(output, "scripts", name));
  const icon =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><path fill="#152430" d="M0 0h96v96H0z"/><path fill="#78cfff" d="M17 22h27v27H27v25H17zm10 10v7h7v-7zm25-10h28v10H62v32h8V53h-4V43h14v31H52z"/></svg>';
  fs.writeFileSync(path.join(output, "app-icon.svg"), icon);
  const csp =
    "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' http: https: ws: wss: data: blob:; object-src 'none'; frame-src 'none'; base-uri 'self'";
  html = html.replace(
    "<head>",
    `<head>\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n<link rel="icon" href="app-icon.svg"><script src="legacy-compat.js"></script><script src="app-runtime.js"></script>`,
  );
  fs.writeFileSync(path.join(output, "client.html"), html);
  fs.writeFileSync(
    path.join(output, "app-runtime.js"),
    legacy.transformScript(fs.readFileSync(path.join(root, "apps/common/app-runtime.js"), "utf8")),
  );
  for (const name of fs.readdirSync(path.join(output, "assets")))
    if (!assets.has("assets/" + name)) fs.unlinkSync(path.join(output, "assets", name));
  // The Android bootstrap runs an ES5 capability probe before loading game code.
  const compatibility = ["compatibility.html", "webview-compat.js"].map((name) => {
    const bytes = fs.readFileSync(path.join(root, "apps/android", name));
    fs.writeFileSync(path.join(output, name), bytes);
    return { path: name, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
  });
  const manifest = {
    compatibility,
    edition: "ProjectGreed",
    version: project.version,
    assets: [...assets.values()],
    scripts: [...scripts].map((name) => ({
      path: name,
      sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(path.join(output, name)))
        .digest("hex"),
    })),
    clientSha256: crypto.createHash("sha256").update(html).digest("hex"),
  };
  fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(
    `App client: ${Buffer.byteLength(html)} byte HTML, ${assets.size} external assets (${[...assets.values()].reduce((n, a) => n + a.bytes, 0)} bytes)`,
  );
  return manifest;
}
if (require.main === module) buildAppClient();
module.exports = { buildAppClient };
