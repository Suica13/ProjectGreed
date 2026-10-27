/* Developer source store. Public matches never accept these edits as game actions. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const projectRoot = path.resolve(__dirname, "..");
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
const parse = (file) => JSON.parse(read(file));
const editableUnitKeys = ["name", "code", "stats", "weapons", "weaponKits"];
function atomicWrite(file, text) {
  const temporary = file + "." + crypto.randomUUID() + ".tmp";
  try {
    fs.writeFileSync(temporary, text, { flag: "wx" });
    fs.renameSync(temporary, file);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}
function createSourceStore({
  root = projectRoot,
  validateUnit = (reference, unit) =>
    require("./load-catalog.cjs").loadCatalog({ unitOverrides: { [reference]: unit } }),
} = {}) {
  const treeFile = path.join(root, "shared/development-tree.json");
  function confined(reference, directory) {
    const file = fs.realpathSync(path.resolve(root, reference));
    const base = fs.realpathSync(path.join(root, directory));
    if (!file.startsWith(base + path.sep)) throw Error("源文件路径无效");
    return file;
  }
  function unitSource(id) {
    const catalog = parse(path.join(root, "assets/unit-catalog.json"));
    for (const reference of catalog.units) {
      const file = confined("assets/" + reference, "assets/units");
      const data = parse(file);
      if (data.id === id) return { file, reference, data };
    }
    throw Error("单位不存在");
  }
  function snapshot(file, data = parse(file)) {
    return { revision: hash(read(file)), data };
  }
  function validateTree(tree) {
    if (!tree || Object.keys(tree).sort().join() !== "EFSF,ZEON")
      throw Error("科技树必须包含 EFSF 和 ZEON");
    for (const [faction, nodes] of Object.entries(tree)) {
      if (!Array.isArray(nodes) || !nodes.length || nodes.length > 500)
        throw Error("科技节点数量无效");
      const ids = new Set(nodes.map((node) => node?.id));
      if (ids.size !== nodes.length || !ids.has("Tech_" + faction + "_0079_BaseTech"))
        throw Error("节点 ID 重复或缺少基础科技");
      const cells = new Set();
      for (const node of nodes) {
        if (
          !node ||
          typeof node.id !== "string" ||
          !/^[\w-]+$/.test(node.id) ||
          typeof node.name !== "string" ||
          !node.name.trim() ||
          typeof node.description !== "string" ||
          !Number.isSafeInteger(node.points) ||
          node.points < 0 ||
          ["money", "supplies"].some(
            (key) => !Number.isSafeInteger(node[key] ?? 0) || (node[key] ?? 0) < 0,
          ) ||
          !["top", "mid", "bot"].includes(node.row) ||
          !Number.isInteger(node.column) ||
          node.column < 1 ||
          node.column > 1000 ||
          !Array.isArray(node.requires) ||
          node.requires.some((id) => !ids.has(id)) ||
          new Set(node.requires).size !== node.requires.length ||
          !Array.isArray(node.unlocks) ||
          node.unlocks.some((id) => typeof id !== "string" || !/^[\w-]+$/.test(id)) ||
          typeof node.icon !== "string" ||
          !/^assets\/tech-icons\/[\w-]+\.png$/.test(node.icon)
        )
          throw Error("科技节点数据无效：" + node?.id);
        confined(node.icon, "assets/tech-icons");
        const cell = node.row + ":" + node.column;
        if (cells.has(cell)) throw Error("科技节点位置重叠：" + node.id);
        cells.add(cell);
      }
      const visited = new Set(),
        active = new Set(),
        byId = new Map(nodes.map((node) => [node.id, node]));
      function visit(id) {
        if (active.has(id)) throw Error("科技前置关系存在循环");
        if (visited.has(id)) return;
        active.add(id);
        byId.get(id).requires.forEach(visit);
        active.delete(id);
        visited.add(id);
      }
      nodes.forEach((node) => visit(node.id));
      if (byId.get("Tech_" + faction + "_0079_BaseTech").requires.length)
        throw Error("基础科技不能设置前置科技");
    }
  }
  function save(file, revision, data, validate) {
    if (hash(read(file)) !== revision) throw Error("源文件已改变，请取消编辑后重新打开");
    validate(); // Validate the candidate in memory before replacing any source file.
    const text = JSON.stringify(data, null, 2) + "\n";
    atomicWrite(file, text);
    return { revision: hash(text) };
  }
  return {
    unit(id) {
      const { file, data } = unitSource(id);
      return snapshot(file, Object.fromEntries(editableUnitKeys.map((key) => [key, data[key]])));
    },
    saveUnit({ id, revision, data }) {
      const source = unitSource(id);
      if (!data || Object.keys(data).sort().join() !== [...editableUnitKeys].sort().join())
        throw Error("只能编辑单位属性、武器和套件");
      const next = { ...source.data, ...data };
      return save(source.file, revision, next, () => validateUnit(source.reference, next));
    },
    tree: () => snapshot(treeFile),
    saveTree: ({ revision, data }) => save(treeFile, revision, data, () => validateTree(data)),
    validateTree,
    importIcon(png) {
      if (typeof png !== "string" || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(png))
        throw Error("请选择 PNG 图标");
      const bytes = Buffer.from(png.split(",")[1], "base64");
      if (
        bytes.length > 512000 ||
        bytes.length < 24 ||
        !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      )
        throw Error("PNG 图标无效或超过500KB");
      const reference = "assets/tech-icons/custom_" + hash(bytes).slice(0, 24) + ".png";
      const target = path.join(root, reference);
      if (!fs.existsSync(target)) fs.writeFileSync(target, bytes, { flag: "wx" });
      return reference;
    },
  };
}
function rebuildProject() {
  return new Promise((resolve, reject) =>
    execFile(
      process.execPath,
      [path.join(projectRoot, "tools/reload-units.cjs")],
      { cwd: projectRoot, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => (error ? reject(Error(stderr || error.message)) : resolve(stdout)),
    ),
  );
}
function createDeveloperAPI({
  rooms,
  onReload,
  store = createSourceStore(),
  rebuild = rebuildProject,
}) {
  const token = crypto.randomBytes(32).toString("hex");
  let busy = false;
  const reply = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(body));
  };
  const handle = async (req, res, url) => {
    const host = req.headers.host || "";
    if (
      !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress) ||
      !/^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/.test(host) ||
      (req.headers.origin && req.headers.origin !== "http://" + host)
    ) {
      reply(res, 403, { error: "请在服务器本机通过 localhost 或 127.0.0.1 打开开发者版" });
      return;
    }
    try {
      const resource = url.pathname.slice("/api/developer/".length);
      if (req.method === "GET" && resource === "session") {
        reply(res, 200, { token });
        return;
      }
      if (req.headers["x-developer-token"] !== token) {
        reply(res, 403, { error: "开发会话无效" });
        return;
      }
      if (busy) throw Error("正在重载，请稍后再试");
      if (req.method === "GET" && resource === "unit") {
        reply(res, 200, store.unit(url.searchParams.get("id")));
        return;
      }
      if (req.method === "GET" && resource === "tree") {
        reply(res, 200, store.tree());
        return;
      }
      if (req.method !== "POST") {
        reply(res, 405, { error: "请求方法无效" });
        return;
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) throw Error("编辑数据过大");
        chunks.push(chunk);
      }
      if (busy) throw Error("正在重载，请稍后再试");
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      if (resource === "unit") reply(res, 200, store.saveUnit(body));
      else if (resource === "tree") reply(res, 200, store.saveTree(body));
      else if (resource === "icon") reply(res, 200, { icon: store.importIcon(body.png) });
      else if (resource === "reload") {
        if (rooms.size) throw Error("请先退出所有联机房间再重载属性");
        busy = true;
        try {
          store.validateTree(store.tree().data);
          await rebuild();
          onReload();
          reply(res, 200, { ok: true });
        } finally {
          busy = false;
        }
      } else reply(res, 404, { error: "未知开发操作" });
    } catch (error) {
      reply(res, 400, { error: error.message });
    }
  };
  handle.busy = () => busy;
  return handle;
}
module.exports = { createSourceStore, createDeveloperAPI };
