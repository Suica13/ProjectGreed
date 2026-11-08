/* Incremental records live outside profile/localStorage. Native and browser backends share
 * an append-at-offset contract, making retries and reconnects safe for long matches. */
window.LocalRecords = (() => {
  const settingsKey = "projectgreed.local-records.settings",
    defaults = { autoLog: true, autoReplay: false, limit: 10 };
  let preferences = { ...defaults };
  try {
    const saved = JSON.parse(localStorage.getItem(settingsKey));
    if (saved)
      preferences = {
        autoLog: saved.autoLog !== false,
        autoReplay: saved.autoReplay === true,
        limit: Math.max(1, Math.min(100, Math.floor(saved.limit) || 10)),
      };
  } catch {}
  const encoder = new TextEncoder();
  let database,
    folder,
    loaded = false,
    queue = Promise.resolve(),
    latest = null,
    timer = null,
    lastError = "",
    replayDone = new Set();
  const encode = (bytes) => {
    let s = "";
    for (let i = 0; i < bytes.length; i += 16384)
      s += String.fromCharCode(...bytes.subarray(i, i + 16384));
    return btoa(s);
  };
  const decode = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  function db() {
    if (!database)
      database = new Promise((resolve, reject) => {
        const q = indexedDB.open("projectgreed.local-records.v1", 1);
        q.onupgradeneeded = () => {
          q.result.createObjectStore("meta", { keyPath: "id" });
          q.result.createObjectStore("chunks", { keyPath: ["id", "offset"] });
          q.result.createObjectStore("config");
        };
        q.onsuccess = () => resolve(q.result);
        q.onerror = () => reject(q.error);
      });
    return database;
  }
  const value = (q) =>
    new Promise((resolve, reject) => {
      q.onsuccess = () => resolve(q.result);
      q.onerror = () => reject(q.error);
    });
  async function loadFolder() {
    if (loaded) return;
    const d = await db();
    folder = await value(d.transaction("config").objectStore("config").get("folder"));
    loaded = true;
  }
  async function fileRequest(q) {
    if ((await folder.queryPermission({ mode: "readwrite" })) !== "granted")
      throw Error("记录文件夹需要重新授权，请在设置中点击选择记录文件夹。");
    const dir = await folder.getDirectoryHandle("records", { create: true });
    async function readMeta(id) {
      try {
        return JSON.parse(
          await (await (await dir.getFileHandle(id + ".meta.json")).getFile()).text(),
        );
      } catch (e) {
        if (e.name === "NotFoundError") return null;
        throw e;
      }
    }
    if (q.op === "list") {
      const items = [];
      for await (const [name, h] of dir.entries())
        if (name.endsWith(".meta.json")) items.push(JSON.parse(await (await h.getFile()).text()));
      return { items };
    }
    const old = await readMeta(q.id),
      name = q.id + (q.kind === "replay" ? ".replay.greed" : ".log.txt");
    if (q.op === "write") {
      if ((old?.bytes || 0) !== q.offset) throw Error("本地记录写入位置不一致");
      const bytes = decode(q.data),
        h = await dir.getFileHandle(name, { create: true }),
        w = await h.createWritable({ keepExistingData: true });
      try {
        await w.truncate(q.offset);
        await w.seek(q.offset);
        await w.write(bytes);
        await w.close();
      } catch (e) {
        await w.abort().catch(() => {});
        throw e;
      }
      const meta = {
        ...q.meta,
        id: q.id,
        kind: q.kind,
        bytes: q.offset + bytes.length,
        updatedAt: Date.now(),
      };
      const index = await (
        await dir.getFileHandle(q.id + ".meta.json", { create: true })
      ).createWritable();
      await index.write(JSON.stringify(meta));
      await index.close();
      return { meta };
    }
    if (q.op === "read") {
      if (!old) throw Error("记录不存在");
      const f = await (await dir.getFileHandle(name)).getFile();
      return {
        data: encode(new Uint8Array(await f.slice(q.offset, q.offset + 262144).arrayBuffer())),
      };
    }
    if (q.op === "remove") {
      await dir.removeEntry(name).catch((e) => {
        if (e.name !== "NotFoundError") throw e;
      });
      await dir.removeEntry(q.id + ".meta.json");
      return {};
    }
    throw Error("未知记录操作");
  }
  async function browserRequest(q) {
    const d = await db(),
      writing = ["write", "remove"].includes(q.op),
      tx = d.transaction(["meta", "chunks"], writing ? "readwrite" : "readonly"),
      meta = tx.objectStore("meta"),
      chunks = tx.objectStore("chunks");
    const done = new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error || Error("记录事务已取消"));
      tx.onerror = () => reject(tx.error);
    });
    let result;
    if (q.op === "list") result = { items: await value(meta.getAll()) };
    else if (q.op === "write") {
      const old = await value(meta.get(q.id));
      if ((old?.bytes || 0) !== q.offset) {
        tx.abort();
        await done.catch(() => {});
        throw Error("本地记录写入位置不一致");
      }
      const bytes = decode(q.data),
        entry = {
          ...q.meta,
          id: q.id,
          kind: q.kind,
          bytes: q.offset + bytes.length,
          updatedAt: Date.now(),
        };
      chunks.put({ id: q.id, offset: q.offset, bytes });
      meta.put(entry);
      result = { meta: entry };
    } else if (q.op === "read") {
      const part = await value(chunks.get([q.id, q.offset]));
      result = { data: part ? encode(part.bytes) : "" };
    } else if (q.op === "remove") {
      chunks.delete(IDBKeyRange.bound([q.id, 0], [q.id, Number.MAX_SAFE_INTEGER]));
      meta.delete(q.id);
      result = {};
    } else throw Error("未知记录操作");
    await done;
    return result;
  }
  async function request(q) {
    if (window.ProjectGreedArchive) {
      const result = JSON.parse(await ProjectGreedArchive.request(JSON.stringify(q)));
      if (!result.ok) throw Error(result.error || "记录文件保存失败");
      return result;
    }
    await loadFolder();
    return folder ? fileRequest(q) : browserRequest(q);
  }
  async function list() {
    return (await request({ op: "list" })).items.sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async function prune() {
    const items = await list(),
      matches = [...new Set(items.map((m) => m.matchId))],
      keep = new Set(matches.slice(0, preferences.limit));
    for (const m of items)
      if (!keep.has(m.matchId)) await request({ op: "remove", id: m.id, kind: m.kind });
  }
  function enqueue(run) {
    queue = queue
      .catch(() => {})
      .then(run)
      .catch((error) => {
        if (lastError !== error.message) {
          lastError = error.message;
          note("本地对局记录保存失败：" + error.message);
        }
      });
    return queue;
  }
  function context(s) {
    const perspective = s.logExport?.perspective || "team:" + Rules.seatTeam(s.you?.seat ?? 0),
      matchId = s.matchId;
    return {
      matchId,
      id:
        String(matchId)
          .replace(/[^a-zA-Z0-9_-]/g, "_")
          .slice(0, 75) +
        "_" +
        perspective.replace(":", "_"),
      perspective,
      title:
        (Rules.getMap(s.settings.mapId).name || s.settings.mapId) +
        " · " +
        new Date().toLocaleString(),
      createdAt: Date.now(),
    };
  }
  async function append(id, kind, bytes, meta, offset) {
    for (let p = 0; p < bytes.length; p += 262144) {
      const part = bytes.subarray(p, p + 262144);
      await request({
        op: "write",
        id,
        kind,
        offset,
        data: encode(part),
        meta: { ...meta, complete: p + 262144 >= bytes.length && meta.complete },
      });
      offset += part.length;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return offset;
  }
  async function saveLog(s) {
    const c = context(s),
      id = c.id + "_log",
      old = (await list()).find((m) => m.id === id),
      lines = s.log || [],
      count = old?.count || 0;
    if (lines.length <= count) return;
    const fresh = lines.slice(0, lines.length - count).reverse();
    let offset = old?.bytes || 0,
      saved = count,
      batch = [],
      size = 0;
    async function commit() {
      if (!batch.length) return;
      const bytes = encoder.encode(batch.join("\n") + "\n");
      saved += batch.length;
      offset = await append(
        id,
        "log",
        bytes,
        { ...c, ...old, count: saved, complete: s.phase === "finished" && saved === lines.length },
        offset,
      );
      batch = [];
      size = 0;
    }
    for (const line of fresh) {
      const bytes = encoder.encode(line + "\n");
      if (size + bytes.length > 200000) await commit();
      batch.push(line);
      size += bytes.length;
    }
    await commit();
    await prune();
  }
  async function saveReplay(s) {
    if (replayDone.has(s.matchId)) return;
    replayDone.add(s.matchId);
    try {
      const c = context(s),
        id = c.id + "_replay",
        old = (await list()).find((m) => m.id === id);
      if (old?.complete) return;
      if (old) await request({ op: "remove", id, kind: "replay" });
      const result = await ReplayPlayer.request("record_export", { matchId: s.matchId });
      if (result.record.id && result.record.id !== s.matchId)
        throw Error("导出的回放所属对局已更新");
      await append(
        id,
        "replay",
        encoder.encode(JSON.stringify(result.record)),
        { ...c, complete: true },
        0,
      );
      await prune();
    } catch (error) {
      replayDone.delete(s.matchId);
      throw error;
    }
  }
  function receive(s) {
    if (window.ReplayPlayer?.active) return;
    if (!s.matchId || (!s.started && s.phase !== "finished")) {
      void flush();
      latest = null;
      return;
    }
    latest = s;
    if (preferences.autoLog && !timer)
      timer = setTimeout(() => {
        timer = null;
        const current = latest;
        enqueue(() => saveLog(current));
      }, 1200);
    if (preferences.autoReplay && s.phase === "finished") {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      enqueue(async () => {
        if (preferences.autoLog) await saveLog(s);
        await saveReplay(s);
      });
    }
  }
  function flush() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (latest && preferences.autoLog) {
      const snapshot = latest;
      return enqueue(() => saveLog(snapshot));
    }
    return queue;
  }
  async function download(meta) {
    const parts = [];
    for (let offset = 0; offset < meta.bytes;) {
      const bytes = decode(
        (await request({ op: "read", id: meta.id, kind: meta.kind, offset })).data,
      );
      if (!bytes.length) throw Error("记录内容不完整");
      parts.push(bytes);
      offset += bytes.length;
    }
    const a = document.createElement("a"),
      url = URL.createObjectURL(
        new Blob(parts, {
          type: meta.kind === "log" ? "text/plain;charset=utf-8" : "application/json",
        }),
      );
    a.href = url;
    a.download = "ProjectGreed-" + meta.id + (meta.kind === "log" ? ".log.txt" : ".replay.greed");
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const controls = element("fieldset", "local-record-settings"),
    legend = element("legend", "", "本地对局记录"),
    status = element("p", "muted");
  controls.append(legend);
  for (const [key, label] of [
    ["autoLog", "自动生成 LOG"],
    ["autoReplay", "自动生成回放"],
  ]) {
    const row = element("label", "settings-toggle", label),
      input = document.createElement("input");
    input.type = "checkbox";
    input.checked = preferences[key];
    input.id = "localRecords-" + key;
    input.onchange = () => {
      preferences[key] = input.checked;
      persist();
    };
    row.append(input);
    controls.append(row);
  }
  const row = element("label", "", "最多保留对局数 "),
    limit = document.createElement("input");
  limit.type = "number";
  limit.min = "1";
  limit.max = "100";
  limit.value = preferences.limit;
  limit.style.width = "5em";
  limit.id = "localRecords-limit";
  limit.onchange = () => {
    preferences.limit = Math.max(1, Math.min(100, Math.floor(+limit.value) || 10));
    limit.value = preferences.limit;
    persist();
    enqueue(prune);
  };
  row.append(limit);
  controls.append(row, status);
  const show = element("button", "", "查看本地记录");
  show.type = "button";
  show.id = "openLocalRecords";
  show.onclick = () => open().catch((e) => note(e.message));
  controls.append(show);
  const pick = element("button", "", "选择记录文件夹");
  pick.type = "button";
  pick.hidden = !!window.ProjectGreedArchive || !window.showDirectoryPicker;
  pick.onclick = async () => {
    try {
      const selected = await showDirectoryPicker({ mode: "readwrite" });
      await selected.requestPermission({ mode: "readwrite" });
      const d = await db();
      await value(
        d.transaction("config", "readwrite").objectStore("config").put(selected, "folder"),
      );
      folder = selected;
      loaded = true;
      status.textContent = "记录位置：" + selected.name + "/records";
    } catch (e) {
      if (e.name !== "AbortError") note(e.message);
    }
  };
  controls.append(pick);
  status.textContent = window.ProjectGreedArchive
    ? "记录位置：本地 records 文件夹"
    : "记录位置：浏览器 IndexedDB（清理网站数据会删除记录）";
  byId("closeClientSettings").before(controls);
  if (!window.ProjectGreedArchive)
    loadFolder()
      .then(() => {
        if (folder) status.textContent = "记录位置：" + folder.name + "/records";
      })
      .catch(() => {});
  function persist() {
    try {
      localStorage.setItem(settingsKey, JSON.stringify(preferences));
    } catch (e) {
      note(e.message);
    }
  }
  async function open() {
    await flush();
    let dialog = byId("localRecordsDialog");
    if (!dialog) {
      dialog = element("dialog", "game-dialog");
      dialog.id = "localRecordsDialog";
      document.body.append(dialog);
    }
    dialog.replaceChildren(element("h3", "", "本地对局记录"));
    const close = element("button", "", "关闭");
    close.onclick = () => dialog.close();
    dialog.append(close);
    const items = await list();
    if (!items.length) dialog.append(element("p", "", "暂无本地记录"));
    for (const m of items) {
      const row = element("div", "local-record-row"),
        b = element("button", "", m.kind === "log" ? "导出 LOG" : "导出回放");
      b.onclick = () => download(m).catch((e) => note(e.message));
      row.append(element("span", "", m.title + " · " + (m.bytes / 1024).toFixed(1) + " KiB"), b);
      dialog.append(row);
    }
    dialog.showModal();
  }
  window.addEventListener("pagehide", flush);
  window.addEventListener("app-background", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) void flush();
  });
  return { receive, flush, list, open, preferences, request };
})();
