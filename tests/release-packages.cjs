"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto"),
  assert = require("node:assert/strict"),
  WebSocket = require("ws");
const root = path.resolve(__dirname, ".."),
  project = require("../project.json"),
  base = path.join(root, "build", project.version);
function digest(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
async function main() {
  const html = path.join(base, `ProjectGreed-${project.version}.html`);
  assert.equal(digest(html), digest(path.join(root, "public/client.html")));
  for (const platform of ["windows-x64", "android-gecko"]) {
    const dir = path.join(base, `ProjectGreed-${project.version}-${platform}`),
      manifest = JSON.parse(fs.readFileSync(path.join(dir, "distribution-manifest.json")));
    assert.equal(manifest.version, project.version);
    for (const f of manifest.files) {
      const file = path.join(dir, f.path);
      assert.equal(fs.statSync(file).size, f.bytes, f.path);
      assert.equal(digest(file), f.sha256, f.path);
    }
    console.log(platform + ": manifest hashes verified (" + manifest.files.length + " files)");
  }
  const serverDir = path.join(base, `ProjectGreed-${project.version}-server-client-win32-x64`),
    manifest = JSON.parse(fs.readFileSync(path.join(serverDir, "manifest.json")));
  assert.equal(manifest.project.version, project.version);
  for (const [file, hash] of Object.entries(manifest.files))
    assert.equal(digest(path.join(serverDir, file)), hash, file);
  assert(!fs.existsSync(path.join(serverDir, "server-data")));
  const app = require(path.join(serverDir, "server.js")).createServer({
    host: "127.0.0.1",
    port: 0,
  });
  let ws;
  try {
    const address = await app.listen(),
      url = "http://127.0.0.1:" + address.port;
    const health = await (await fetch(url + "/health")).json();
    assert.equal(health.version, project.version);
    const page = await (await fetch(url)).text();
    assert(page.includes(project.version));
    assert(page.includes("/client-assets/"));
    ws = new WebSocket(url.replace("http:", "ws:") + "/ws");
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    const state = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error("Packaged WebSocket hello timeout")), 5000);
      ws.on("message", (bytes) => {
        const m = JSON.parse(bytes);
        if (m.type === "error") {
          clearTimeout(timeout);
          reject(Error(m.message));
        }
        if (m.type === "state") {
          clearTimeout(timeout);
          resolve(m);
        }
      });
      ws.send(
        JSON.stringify({
          type: "hello",
          version: project.version,
          mode: "create",
          room: "RELEASECHECK",
          roomMode: "battlefield",
          characterFaction: "PMC",
          name: "ReleaseCheck",
          licenses: { Type61: true },
          inventory: { Type61: 2 },
          kits: {},
        }),
      );
    });
    assert.equal(state.settings.mode, "battlefield");
    assert.equal(state.you.seat, 2);
    assert(
      state.members.find((m) => m.seat === 0)?.bot && state.members.find((m) => m.seat === 1)?.bot,
    );
    assert.equal(state.game.seed, undefined);
    const rules = require(path.join(serverDir,"shared/rules.js"));
    const mission = rules.getMap("mission_white_base");
    assert.equal(mission.playersPerTeam,5);
    assert.equal(mission.mission.costLimit,1200);
    assert.equal(mission.mission.unitLimit,12);
    assert.equal(mission.mission.rewards.inventory.RX_77_2,2);
    require(path.join(serverDir,"shared/mission-mode.js")).validate(mission.mission,mission,rules);
    console.log(
      "server: hashes, HTTP asset expansion, /health and real WebSocket battlefield room passed",
    );
  } finally {
    if (ws) ws.terminate();
    await app.close();
  }
  console.log("Release packages verified: " + base);
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
