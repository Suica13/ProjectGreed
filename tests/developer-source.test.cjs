"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createSourceStore, createDeveloperAPI } = require("../tools/developer-api.cjs");
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "greed-editor-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const directory of ["assets/units/test", "assets/tech-icons", "shared"])
    fs.mkdirSync(path.join(root, directory), { recursive: true });
  const unit = {
    id: "test",
    name: "Test",
    code: "T",
    source: "original.ini",
    stats: { hp: 100 },
    weapons: {},
    weaponKits: [],
  };
  fs.writeFileSync(
    path.join(root, "assets/unit-catalog.json"),
    JSON.stringify({ units: ["units/test/unit.json"] }),
  );
  const unitPath = path.join(root, "assets/units/test/unit.json");
  fs.writeFileSync(unitPath, JSON.stringify(unit));
  fs.writeFileSync(path.join(root, "assets/tech-icons/test.png"), "fixture");
  const tree = Object.fromEntries(
    ["EFSF", "ZEON"].map((faction) => [
      faction,
      [
        {
          id: `Tech_${faction}_0079_BaseTech`,
          name: "Base",
          description: "",
          points: 0,
          row: "mid",
          column: 1,
          icon: "assets/tech-icons/test.png",
          requires: [],
          unlocks: ["test"],
        },
      ],
    ]),
  );
  fs.writeFileSync(path.join(root, "shared/development-tree.json"), JSON.stringify(tree));
  const store = createSourceStore({
    root,
    validateUnit(reference, value) {
      assert.equal(reference, "units/test/unit.json");
      if (!(value.stats.hp > 0)) throw Error("invalid HP");
    },
  });
  return { store, root, unitPath };
}
test("unit source saves preserve source fields, reject stale edits and never overwrite invalid data", (t) => {
  const { store, unitPath } = fixture(t);
  const original = fs.readFileSync(unitPath, "utf8");
  const draft = store.unit("test");
  draft.data.stats.hp = -1;
  assert.throws(() => store.saveUnit({ id: "test", ...draft }), /invalid HP/);
  assert.equal(fs.readFileSync(unitPath, "utf8"), original);
  draft.data.stats.hp = 200;
  store.saveUnit({ id: "test", ...draft });
  assert.equal(JSON.parse(fs.readFileSync(unitPath)).stats.hp, 200);
  assert.equal(JSON.parse(fs.readFileSync(unitPath)).source, "original.ini");
  assert.throws(() => store.saveUnit({ id: "test", ...draft }), /源文件已改变/);
  assert.throws(() => store.unit("../../server.js"), /不存在/);
  const current = store.unit("test");
  current.data.source = "changed";
  assert.throws(() => store.saveUnit({ id: "test", ...current }), /只能编辑/);
});
test("technology editing persists new nodes and unlocks, rejects cycles and protects starter nodes", (t) => {
  const { store } = fixture(t);
  const draft = store.tree();
  draft.data.EFSF.push({
    ...draft.data.EFSF[0],
    id: "custom_tech",
    name: "新科技",
    points: 250,
    column: 2,
    requires: [draft.data.EFSF[0].id],
    unlocks: ["another_unit"],
  });
  store.saveTree(draft);
  assert.equal(store.tree().data.EFSF[1].points, 250);
  const invalid = store.tree();
  invalid.data.EFSF[1].requires = ["custom_tech"];
  assert.throws(() => store.saveTree(invalid), /循环/);
  assert.deepEqual(store.tree().data.EFSF[1].requires, ["Tech_EFSF_0079_BaseTech"]);
  invalid.data.EFSF.shift();
  assert.throws(() => store.saveTree(invalid), /缺少基础科技/);
  const pathEscape = store.tree();
  pathEscape.data.EFSF[0].icon = "../server.js";
  assert.throws(() => store.saveTree(pathEscape), /无效/);
});
test("candidate unit validation uses the shared catalog loader without changing source", () => {
  const { loadCatalog } = require("../tools/load-catalog.cjs");
  const source = fs.readFileSync(path.resolve("assets/units/RGM_79/unit.json"), "utf8");
  const unit = JSON.parse(source);
  unit.stats.hp = -1;
  assert.throws(() => loadCatalog({ unitOverrides: { "units/RGM_79/unit.json": unit } }));
  assert.equal(fs.readFileSync(path.resolve("assets/units/RGM_79/unit.json"), "utf8"), source);
});
test("local developer API rejects foreign origins, missing tokens and reloads during rooms or another rebuild", async (t) => {
  const { store } = fixture(t);
  const rooms = new Map();
  let finishBuild,
    reloaded = 0;
  const handle = createDeveloperAPI({
    store,
    rooms,
    onReload: () => reloaded++,
    rebuild: () =>
      new Promise((resolve) => {
        finishBuild = resolve;
      }),
  });
  const server = http.createServer(
    (req, res) => void handle(req, res, new URL(req.url, "http://localhost")),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = "http://127.0.0.1:" + server.address().port + "/api/developer/";
  assert.equal(
    (await fetch(base + "session", { headers: { Origin: "https://foreign.invalid" } })).status,
    403,
  );
  assert.equal((await fetch(base + "tree")).status, 403);
  const { token } = await (await fetch(base + "session")).json();
  const post = (resource, body = {}) =>
    fetch(base + resource, {
      method: "POST",
      headers: { "X-Developer-Token": token },
      body: JSON.stringify(body),
    });
  rooms.set("room", {});
  assert.match((await (await post("reload")).json()).error, /房间/);
  rooms.clear();
  const pending = post("reload");
  await new Promise((resolve) => {
    const poll = () => (handle.busy() ? resolve() : setTimeout(poll, 5));
    poll();
  });
  assert.equal(handle.busy(), true);
  assert.match((await (await post("tree", store.tree())).json()).error, /正在重载/);
  finishBuild();
  assert.equal((await pending).status, 200);
  assert.equal(reloaded, 1);
  assert.equal(handle.busy(), false);
});
