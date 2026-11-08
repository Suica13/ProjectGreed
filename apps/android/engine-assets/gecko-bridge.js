/* Private loopback bridge. Saving remains synchronous and confirms native disk writes. */
(function () {
  "use strict";
  const script = document.currentScript;
  const token = script.dataset.token;
  const base = new URL("./", script.src);
  function call(method, args) {
    const request = new XMLHttpRequest();
    request.open("POST", new URL("call/" + method, base), false);
    request.setRequestHeader("Content-Type", "application/json");
    request.setRequestHeader("X-ProjectGreed-Token", token);
    request.send(JSON.stringify(args));
    if (request.status !== 200) throw Error("原生存档接口不可用，请重新打开客户端。");
    return request.responseText;
  }
  window.ProjectGreedAndroid = Object.freeze({
    archive: async (value) => {
      const response = await fetch(new URL("call/archive", base), { method: "POST",
        headers: { "Content-Type": "application/json", "X-ProjectGreed-Token": token }, body: JSON.stringify([value]) });
      if (!response.ok) throw Error("原生记录接口不可用");
      return response.text();
    },
    read: () => call("read", []),
    commit: (value) => call("commit", [value]),
    compatibilityResult: (value) => call("compatibilityResult", [value]),
    sceneChanged: (scene, ready) => call("sceneChanged", [scene, ready]),
    openStorageFolder: () => call("openStorageFolder", []),
    chooseStorageFolder: () => call("chooseStorageFolder", []),
    exportFile: (name, mime, data) => call("exportFile", [name, mime, data]),
    exit: () => call("exit", []),
  });
  const stream = new EventSource(new URL("events", base));
  stream.onmessage = (event) => {
    const message = JSON.parse(event.data);
    switch (message.name) {
      case "freeze":
        document.documentElement.inert = message.value;
        break;
      case "back":
        if (window.AppRuntime) void AppRuntime.requestBack();
        break;
      case "background":
        window.dispatchEvent(new Event("app-background"));
        break;
      case "foreground":
        window.dispatchEvent(new Event("app-foreground"));
        window.dispatchEvent(new Event("focus"));
        document.dispatchEvent(new Event("visibilitychange"));
        break;
    }
  };
  window.addEventListener("pagehide", () => stream.close(), { once: true });
})();
