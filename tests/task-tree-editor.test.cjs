const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const M = require("../task-editor/model.js"),
  types = require("../task-editor/catalog.cjs");
test("editor exposes every runtime condition, action, victory and contract objective type", () => {
  const source = fs.readFileSync("shared/mission-mode.js", "utf8");
  for (const [category, pattern] of [
    ["condition", /!\[\s*"start",([\s\S]*?)\]\.includes\(w.type\)/],
    ["action", /!\[\s*"spawn",([\s\S]*?)\]\.includes\(a.type\)/],
    ["victory", /!\[("all_enemies"[^\]]+)\]\.includes\(m.victory/],
  ]) {
    const match = source.match(pattern);
    assert(match, category);
    const expected = [...match[0].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    assert.deepEqual(
      types
        .filter((t) => t.category === category)
        .map((t) => t.type)
        .sort(),
      expected.sort(),
    );
  }
  assert.deepEqual(
    types.filter((t) => t.category === "contract").map((t) => t.type),
    require("../shared/contract-mode").kinds.map((k) => k.type),
  );
});
test("tree validates ancestry, parameters, duplicates and cycles; layout separates branches", () => {
  const d = M.blank(),
    root = M.add(d, types[0]),
    a = M.add(d, types[0], root.id),
    b = M.add(d, types[0], root.id);
  assert.deepEqual(M.validate(d, types), []);
  const layout = M.layout(d);
  assert(layout.positions.get(a.id).x < layout.positions.get(b.id).x);
  assert(layout.positions.get(root.id).y < layout.positions.get(a.id).y);
  root.parent = a.id;
  assert(M.validate(d, types).some((e) => e.includes("循环")));
  root.parent = null;
  b.id = a.id;
  assert(M.validate(d, types).some((e) => e.includes("重复")));
  b.id = "node_3";
  const spawn = M.add(
    d,
    types.find((t) => t.id === "action.spawn"),
    root.id,
  );
  spawn.parameters.actors = "invalid";
  assert(M.validate(d, types).some((e) => e.includes("文本列表")));
});
test("all shipped mission maps import into lossless AI design references", () => {
  for (const name of fs.readdirSync("assets/maps/missions").filter((n) => n.endsWith(".json"))) {
    const map = JSON.parse(fs.readFileSync(path.join("assets/maps/missions", name), "utf8"));
    if (!map.mission) continue;
    const doc = M.fromMap(map, types);
    assert.deepEqual(M.validate(doc, types), [], name);
    assert.deepEqual(doc.sourceMap, map);
    assert.equal(
      doc.nodes.filter((n) => n.kind.startsWith("action.")).length,
      map.mission.events.reduce((n, e) => n + e.actions.length, 0),
    );
    const before = JSON.stringify(map);
    doc.nodes[0].title = "修改树";
    assert.equal(JSON.stringify(map), before);
    const bundle = M.bundle(doc, types, "V138");
    assert.equal(bundle.reference.availableTypes.length, types.length);
    assert(bundle.reference.instructions.some((v) => v.includes("MissionMode.validate")));
    assert.equal(M.layout(doc).positions.size, doc.nodes.length);
  }
});
