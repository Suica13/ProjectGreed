/* The native editions keep the existing synchronous save contract. A commit returns
 * only after an atomic native file replacement; gameplay never races a background save. */
(function (root) {
  "use strict";
  function createStorage(bridge) {
    const read = (value) => {
      const result = typeof value === "string" ? JSON.parse(value) : value;
      if (!result?.ok) throw Error(result?.error || "无法读取应用存档");
      return result;
    };
    const initial = read(bridge.read());
    let revision = initial.revision;
    if (
      !Number.isSafeInteger(revision) ||
      revision < 0 ||
      !initial.values ||
      Array.isArray(initial.values)
    )
      throw Error("应用存档格式无效");
    let values = new Map(Object.entries(initial.values));
    if ([...values.values()].some((value) => typeof value !== "string"))
      throw Error("应用存档格式无效");
    function batch(entries) {
      const next = new Map(values);
      for (const [key, value] of entries) {
        if (value === null) next.delete(String(key));
        else next.set(String(key), String(value));
      }
      if (next.size === values.size && [...next].every(([k, v]) => values.get(k) === v)) return;
      const result = read(
        bridge.commit(
          JSON.stringify({
            revision,
            ...(initial.epoch ? { epoch: initial.epoch } : {}),
            values: Object.fromEntries(next),
          }),
        ),
      );
      if (!Number.isSafeInteger(result.revision) || result.revision !== revision + 1)
        throw Error("应用存档版本确认失败，请重启客户端");
      // Both disk and its revision are confirmed before updating the in-memory view.
      values = next;
      revision = result.revision;
    }
    const api = {};
    for (const [name, fn] of Object.entries({
      key: (index) => [...values.keys()][Number(index)] ?? null,
      getItem: (key) => values.get(String(key)) ?? null,
      setItem: (key, value) => batch([[String(key), String(value)]]),
      removeItem: (key) => batch([[String(key), null]]),
      clear: () => batch([...values.keys()].map((key) => [key, null])),
    }))
      Object.defineProperty(api, name, { value: fn, configurable: true });
    Object.defineProperty(api, "length", { get: () => values.size, configurable: true });
    const storage = new Proxy(api, {
      get: (target, key) => (key in target ? target[key] : values.get(key)),
      set: (_, key, value) => {
        batch([[String(key), String(value)]]);
        return true;
      },
      deleteProperty: (_, key) => {
        batch([[String(key), null]]);
        return true;
      },
      ownKeys: () => [...values.keys()],
      getOwnPropertyDescriptor: (target, key) =>
        Reflect.getOwnPropertyDescriptor(target, key) ||
        (values.has(key)
          ? { value: values.get(key), enumerable: true, configurable: true, writable: true }
          : undefined),
    });
    return { storage, batch, recovered: initial.recovered === true };
  }
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { createStorage };
    return;
  }
  function fatal(error) {
    // Never silently create a browser-backed or empty replacement profile after a native read failure.
    Object.defineProperty(root, "localStorage", {
      configurable: true,
      get() {
        throw error;
      },
    });
    const show = () => {
      const panel = document.createElement("div");
      panel.style.cssText =
        "position:fixed;inset:0;z-index:2147483647;background:#152430;color:#eee;padding:32px;font:16px sans-serif;white-space:pre-wrap;overflow:auto";
      panel.textContent =
        "应用存档未能打开，已停止加载以保护原数据。\n请关闭客户端后重试，或恢复应用数据目录中的备份。\n\n" +
        error.message;
      if (root.ProjectGreedAndroid?.chooseStorageFolder) {
        const button = document.createElement("button");
        button.textContent = "重新选择存档文件夹";
        button.style.cssText = "display:block;margin-top:24px;padding:12px";
        button.onclick = () => root.ProjectGreedAndroid.chooseStorageFolder();
        panel.append(button);
      }
      document.body.append(panel);
    };
    document.readyState === "loading"
      ? document.addEventListener("DOMContentLoaded", show)
      : show();
  }
  try {
    let bridge;
    if (root.ProjectGreedAndroid) {
      const host = root.ProjectGreedAndroid;
      bridge = {
        read: () => host.read(),
        commit: (value) => host.commit(value),
        exportFile: (name, mime, data) => host.exportFile(name, mime, data),
        exit: () => host.exit(),
      };
    } else if (root.chrome?.webview?.hostObjects) {
      const host = root.chrome.webview.hostObjects.sync.projectGreed;
      bridge = {
        read: () => host.Read(),
        commit: (value) => host.Commit(value),
        exportFile: (name, mime, data) =>
          root.chrome.webview.postMessage({ action: "export", name, mime, data }),
        exit: () => root.chrome.webview.postMessage({ action: "exit" }),
      };
    } else throw Error("未找到原生客户端接口，请从 ProjectGreed 程序启动。");
    const area = createStorage(bridge);
    if (!root.ProjectGreedAndroid)
      document.addEventListener(
        "keydown",
        (event) => {
          if (event.key === "F11") {
            event.preventDefault();
            root.chrome.webview.postMessage({ action: "fullscreen" });
          }
        },
        true,
      );
    Object.defineProperty(root, "localStorage", { value: area.storage, configurable: true });
    root.AppRuntime = Object.freeze({
      native: true,
      ready: true,
      edition: "NativeJSON",
      replaceItems: area.batch,
      requestBack: async () => {
        const dialog = document.querySelector("dialog[open]");
        if (dialog) {
          if (dialog.dispatchEvent(new Event("cancel", { cancelable: true }))) dialog.close();
          return;
        }
        const confirmed =
          typeof GameDialog !== "undefined"
            ? await GameDialog.confirm("退出客户端将断开当前连接，是否退出？", {
                title: "退出客户端",
              })
            : root.confirm("退出客户端？");
        if (confirmed) bridge.exit();
      },
    });
    // Native document pickers handle imports. Intercept download links for exports,
    // because Android WebView does not provide browser-style Blob downloads.
    const isExportLink = (link) =>
      link?.hasAttribute("download") && /^(blob:|data:)/.test(link.href);
    async function exportLink(link) {
      try {
        const response = await fetch(link.href),
          blob = await response.blob();
        if (blob.size > 64 * 1024 * 1024) throw Error("导出文件超过64 MiB");
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let binary = "";
        for (let i = 0; i < bytes.length; i += 32768)
          binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
        bridge.exportFile(
          link.download || "ProjectGreed.json",
          blob.type || "application/json",
          btoa(binary),
        );
      } catch (error) {
        root.alert("导出失败：" + error.message);
      }
    }
    // Programmatic exports use detached anchors, which do not bubble to document.
    const anchorClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (isExportLink(this)) {
        void exportLink(this);
        return;
      }
      return anchorClick.call(this);
    };
    document.addEventListener(
      "click",
      (event) => {
        const link = event.target.closest?.("a[download]");
        if (isExportLink(link)) {
          event.preventDefault();
          void exportLink(link);
        }
      },
      true,
    );
    document.addEventListener("DOMContentLoaded", () => {
      const brand = document.querySelector(".shell-brand small");
      if (brand) brand.textContent += " / Native JSON";
      if (root.ProjectGreedAndroid?.sceneChanged) {
        const host = root.ProjectGreedAndroid;
        let ready = typeof assetsReady !== "undefined" && assetsReady,
          last = "";
        const syncScene = () => {
          const scene = document.body.dataset.page || "menu";
          const key = scene + ":" + ready;
          if (key !== last) {
            last = key;
            host.sceneChanged(scene, ready);
          }
          const button = document.getElementById("nativeSaveFolder");
          if (button) button.disabled = scene === "game";
        };
        new MutationObserver(syncScene).observe(document.body, {
          attributes: true,
          attributeFilter: ["data-page"],
        });
        root.addEventListener("game-assets-ready", () => {
          ready = true;
          syncScene();
        });
        const exportButton = document.getElementById("exportProfileSave");
        if (exportButton && host.chooseStorageFolder) {
          const button = document.createElement("button");
          button.id = "nativeSaveFolder";
          button.type = "button";
          button.className = exportButton.className;
          button.textContent = "选择存档文件夹";
          button.onclick = () => host.chooseStorageFolder();
          exportButton.parentElement.append(button);
        }
        syncScene();
      }
      if (area.recovered) root.alert("主存档未能读取，已从上次备份恢复；原文件已保留。");
    });
  } catch (error) {
    fatal(error);
  }
})(globalThis);
