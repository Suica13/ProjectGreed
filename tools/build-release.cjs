/* Default user-requested release: HTML, Windows, bundled-Gecko Android and server. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  project = require("../project.json");
function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(command + " failed: " + result.status);
}
run(process.execPath, ["build.cjs"]);
const directory = path.join(root, "build", project.version);
fs.mkdirSync(directory, { recursive: true });
fs.copyFileSync(
  path.join(root, "public/client.html"),
  path.join(directory, `ProjectGreed-${project.version}.html`),
);
require("./build-app-client.cjs").buildAppClient();
run(process.execPath, ["tools/build-apps.cjs", "windows", "--prepared"]);
run(process.execPath, ["tools/build-apps.cjs", "android", "--prepared"]);
run("python", ["tools/package-server.py", "--folder", "--with-client"]);
console.log("Full release: " + directory);
