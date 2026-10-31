/* One-click local editor launcher. Reuses only this workspace's existing service. */
"use strict";
const fs = require("node:fs"),
  path = require("node:path"),
  crypto = require("node:crypto");
const { resolveEditorHost } = require("./developer-host.cjs");
const { spawn, spawnSync, execFile } = require("node:child_process");
async function ensureDeveloper({
  root = path.resolve(__dirname, ".."),
  port = 1314,
  host = "127.0.0.1",
  open = true,
} = {}) {
  root = path.resolve(root);
  host = resolveEditorHost(host);
  const base = "http://" + host + ":" + port,
    workspaceId = crypto.createHash("sha256").update(root.toLowerCase()).digest("hex");
  const probe = async () => {
    let response;
    try {
      response = await fetch(base + "/api/editor/session", { signal: AbortSignal.timeout(1500) });
    } catch (error) {
      if (error.cause?.code === "ECONNREFUSED" || error.name === "TimeoutError") return false;
      throw Error("无法检查编辑端口：" + error.message);
    }
    let value;
    try {
      value = await response.json();
    } catch {
      throw Error("端口" + port + "已被其他程序占用。");
    }
    if (
      !response.ok ||
      value.service !== "ProjectGreedCatalogEditor" ||
      value.workspaceId !== workspaceId
    )
      throw Error("端口" + port + "已被其他程序或工程占用，请关闭该服务后重试。");
    if (value.protocol !== 2) throw Error("旧版编辑服务仍在运行，请先关闭旧服务，再启动新版。");
    return true;
  };
  let running = await probe();
  if (!fs.existsSync(path.join(root, "public/developer.html"))) {
    const result = spawnSync(process.execPath, [path.join(root, "build.cjs"), "--developer"], {
      cwd: root,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.status !== 0) throw Error("开发者页面构建失败。");
  }
  if (!running) {
    const temporary = path.join(root, "tmp");
    fs.mkdirSync(temporary, { recursive: true });
    const log = fs.openSync(path.join(temporary, "developer-service.log"), "a");
    try {
      const child = spawn(
        process.execPath,
        [path.join(root, "tools/developer-server.cjs"), String(port)],
        { cwd: root, detached: true, windowsHide: true, stdio: ["ignore", log, log] },
      );
      await new Promise((resolve, reject) => {
        child.once("spawn", resolve);
        child.once("error", reject);
      });
      child.unref();
      fs.writeFileSync(path.join(temporary, "developer-service.pid"), String(child.pid));
    } finally {
      fs.closeSync(log);
    }
    for (let attempt = 0; attempt < 50 && !running; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      running = await probe();
    }
    if (!running) throw Error("编辑服务启动失败，请查看 tmp/developer-service.log。");
  }
  const url = base + "/developer.html";
  if (open) {
    const command =
      process.platform === "win32"
        ? ["powershell.exe", ["-NoProfile", "-Command", "Start-Process -FilePath '" + url + "'"]]
        : process.platform === "darwin"
          ? ["open", [url]]
          : ["xdg-open", [url]];
    await new Promise((resolve, reject) =>
      execFile(command[0], command[1], { windowsHide: true }, (error) =>
        error ? reject(error) : resolve(),
      ),
    );
  }
  return url;
}
if (require.main === module) {
  const configFile = path.resolve(__dirname, "../developer-config.json");
  const config = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, "utf8")) : {};
  ensureDeveloper({
    host: config.host || "127.0.0.1",
    port: config.port || 1314,
    open: !process.argv.includes("--no-open"),
  })
    .then((url) => console.log("本地编辑服务已就绪：" + url))
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
module.exports = { ensureDeveloper };
