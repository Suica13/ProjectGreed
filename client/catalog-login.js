/* Credentials and loaded source data exist only in memory, never browser storage. */
window.CATALOG_DEVELOPER_MODE = true;
document.documentElement.classList.add("catalog-developer");
(() => {
  const form = document.getElementById("editorLogin"),
    address = document.getElementById("editorServerAddress"),
    key = document.getElementById("editorAccessKey"),
    status = document.getElementById("editorLoginStatus"),
    confirm = document.getElementById("confirmEditorLogin");
  address.value = /^https?:$/.test(location.protocol) ? location.origin : "http://127.0.0.1:1314";
  form.onsubmit = async (event) => {
    event.preventDefault();
    confirm.disabled = true;
    try {
      const value = address.value.trim(),
        url = new URL(value.includes("://") ? value : "http://" + value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw Error("请输入HTTP或HTTPS编辑服务器地址。");
      if (!url.port && !value.includes("://") && !/:\d+$/.test(value)) url.port = "1314";
      const base = url.origin;
      status.textContent = "正在验证密钥…";
      let response;
      try {
        response = await fetch(base + "/api/editor/session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: key.value }),
          signal: AbortSignal.timeout(10000),
        });
      } catch {
        throw Error("无法连接编辑服务器，请检查IP、端口和服务是否启动。");
      }
      const session = await response.json();
      if (!response.ok) throw Error(session.error || "验证失败。");
      if (!session.token || session.protocol !== 2)
        throw Error("编辑服务版本不匹配，请更新并重启编辑服务。");
      key.value = "";
      status.textContent = "正在加载服务器单位与素材…";
      const bootstrap = await fetch(base + "/api/editor/bootstrap", {
        headers: { "X-Editor-Token": session.token },
        signal: AbortSignal.timeout(120000),
      });
      if (!bootstrap.ok) throw Error((await bootstrap.json()).error || "加载数据失败。");
      window.catalogBootstrap = await bootstrap.json();
      window.editorConnection = { base, token: session.token };
      const script = document.createElement("script");
      script.textContent = document.getElementById("catalogRuntime").textContent;
      document.body.append(script);
      document.getElementById("editorLoginScreen").hidden = true;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      confirm.disabled = false;
    }
  };
})();
