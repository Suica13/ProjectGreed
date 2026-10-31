/* Credentials and loaded source data exist only in memory, never browser storage. */
window.CATALOG_DEVELOPER_MODE = true;
document.documentElement.classList.add("catalog-developer");
(() => {
  const form = document.getElementById("editorLogin"),
    address = document.getElementById("editorServerAddress"),
    key = document.getElementById("editorAccessKey"),
    status = document.getElementById("editorLoginStatus"),
    progressBar = document.getElementById("editorDownloadProgress"),
    confirm = document.getElementById("confirmEditorLogin");
  address.value = /^https?:$/.test(location.protocol) ? location.origin : "http://127.0.0.1:1314";
  form.onsubmit = async (event) => {
    event.preventDefault();
    confirm.disabled = true;
    progressBar.hidden = false;
    progressBar.removeAttribute("value");
    try {
      const value = address.value.trim(),
        url = new URL(value.includes("://") ? value : "http://" + value);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
        throw Error("请输入HTTP或HTTPS编辑服务器地址。");
      if (!url.port && !value.includes("://") && !/:\d+$/.test(value)) url.port = "1314";
      const base = url.origin;
      if (location.protocol === "https:" && url.protocol === "http:")
        throw Error("HTTPS页面不能连接HTTP编辑服务。请独立打开developer.html，或直接打开编辑服务器提供的HTTP页面。");
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
        throw Error(`无法连接编辑服务器：${base}。请确认编辑服务监听服务器网卡IP而非127.0.0.1，并已放行或转发对应TCP端口；编辑端口不能与游戏端口相同。`);
      }
      let session;
      try {
        session = await response.json();
      } catch {
        throw Error("此地址未提供编辑接口，请检查是否误填了游戏服务端口。");
      }
      if (!response.ok) throw Error(session.error || "验证失败。");
      if (!session.token || session.protocol !== 2)
        throw Error("编辑服务版本不匹配，请更新并重启编辑服务。");
      if (session.dataOnlyVersion !== 1 || !session.incrementalCatalog)
        throw Error("编辑后台仍是旧版。请关闭服务器CMD，重新运行start_developer.bat，再刷新本页面。");
      key.value = "";
      status.textContent = "正在下载编辑数据（不含图片和动画）…";
      const bootstrap = await fetch(base + "/api/editor/bootstrap", {
        headers: { "X-Editor-Token": session.token },
        signal: AbortSignal.timeout(180000),
      });
      if (!bootstrap.ok) throw Error((await bootstrap.json()).error || "加载数据失败。");
      const total = Number(bootstrap.headers.get("X-Editor-JSON-Bytes"));
      if (total > 0) progressBar.value = 0;
      const reader = bootstrap.body?.getReader();
      if (reader) {
        const chunks = [];
        let received = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;
          if (total > 0) progressBar.value = Math.min(100, received / total * 100);
          const progress = total > 0 ? ` ${Math.min(100, Math.floor(received / total * 100))}%` : "";
          status.textContent = `正在下载编辑数据${progress} · 已接收 ${(received / 1048576).toFixed(1)} MB（不含图片和动画）`;
        }
        progressBar.value = 100;
        status.textContent = "数据下载完成，正在初始化编辑界面…";
        await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
        window.catalogBootstrap = JSON.parse(await new Blob(chunks).text());
      } else {
        window.catalogBootstrap = await bootstrap.json();
        progressBar.value = 100;
      }
      window.editorConnection = { base, token: session.token };
      const script = document.createElement("script");
      script.textContent = document.getElementById("catalogRuntime").textContent;
      let runtimeError = null;
      const onRuntimeError = (event) => { runtimeError = event.error || Error(event.message); };
      window.addEventListener("error", onRuntimeError);
      try {
        document.body.append(script);
      } finally {
        window.removeEventListener("error", onRuntimeError);
      }
      if (runtimeError || !window.catalogEditorReady)
        throw Error("编辑界面初始化失败：" + (runtimeError?.message || "界面未完成启动") + "。请刷新后使用最新版developer.html重试。");
      document.getElementById("editorLoginScreen").hidden = true;
    } catch (error) {
      progressBar.hidden = true;
      status.textContent = ["TimeoutError", "AbortError"].includes(error.name)
        ? "编辑数据下载超时，请重试；服务器HTTP 200并不表示浏览器已经接收完整数据。"
        : error.message;
    } finally {
      confirm.disabled = false;
    }
  };
})();
