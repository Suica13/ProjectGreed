"use strict";
const { spawn } = require("node:child_process");
const { loadConfig } = require("../server.js");
const url = "http://127.0.0.1:" + loadConfig().port + "/admin/activities.html";
console.log("请先启动服务器。活动管理：" + url);
const command =
  process.platform === "win32"
    ? "explorer.exe"
    : process.platform === "darwin"
      ? "open"
      : "xdg-open";
const child = spawn(command, [url], { detached: true, stdio: "ignore", windowsHide: true });
child.on("error", () => console.log("请在浏览器中打开上述地址。"));
child.unref();
