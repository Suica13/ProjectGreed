"use strict";
const { app, BrowserWindow, Menu, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
// Stable profile directory across application upgrades. Browser saves are imported manually.
app.setPath(
  "userData",
  process.env.PROJECTGREED_TEST_PROFILE || path.join(app.getPath("appData"), "ProjectGreed"),
);
const entry = path.join(__dirname, "..", "public", "client.html");
const entryURL = pathToFileURL(entry).href;
function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    title: "ProjectGreed",
    backgroundColor: "#111827",
    show: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (url.split("#")[0] !== entryURL) event.preventDefault();
  });
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());
  win.loadFile(entry).catch((error) => {
    dialog.showErrorBox("ProjectGreed 启动失败", error.message);
    app.quit();
  });
  return win;
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    const menu = [
      ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
      {
        label: "编辑 / Edit",
        submenu: [
          { role: "undo" },
          { role: "redo" },
          { type: "separator" },
          { role: "cut" },
          { role: "copy" },
          { role: "paste" },
          { role: "selectAll" },
        ],
      },
      {
        label: "视图 / View",
        submenu: [
          { role: "togglefullscreen" },
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          ...(!app.isPackaged ? [{ role: "toggleDevTools" }] : []),
        ],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
    const session = require("electron").session.defaultSession;
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    // Keep the save dialog for profile/replay/log Blob downloads.
    session.on("will-download", (_event, item) => {
      item.setSaveDialogOptions({
        title: "保存 / Save",
        defaultPath: path.join(app.getPath("downloads"), path.basename(item.getFilename())),
      });
    });
    createWindow();
    app.on("activate", () => {
      if (!BrowserWindow.getAllWindows().length) createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
