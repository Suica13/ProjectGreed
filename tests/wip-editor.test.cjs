const test = require("node:test"),
  assert = require("node:assert/strict");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
test("WIP editor supports exact IDs and series patterns with reversible flags and audited affected units", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  let data = f.store.getWip();
  data.units = [...data.policy.units, "RX_78_2", "Apsaras*"];
  const result = f.store.saveWip(data);
  const disabled = f.catalog().prefabs.filter((u) => u.wip);
  assert(disabled.some((u) => u.id === "RX_78_2"));
  assert(disabled.filter((u) => u.id.startsWith("Apsaras")).length >= 3);
  const record = f.read(result.auditLog);
  assert.equal(record.operation, "wip-list");
  assert(
    record.units.some(
      (u) => u.id === "RX_78_2" && u.changes.some((c) => c.path === "/wip" && c.after === true),
    ),
  );
  data = f.store.getWip();
  data.units = data.policy.units.filter((id) => id !== "RX_78_2" && id !== "Apsaras*");
  f.store.saveWip(data);
  assert(!f.catalog().prefabs.find((u) => u.id === "RX_78_2").wip);
  assert.deepEqual(f.read("assets/unit-wip.json").units, data.units);
});
test("WIP editor rejects invalid, duplicate, unknown and stale entries without changing files", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const before = f.store.revision();
  for (const units of [["../RX_78_2"], ["RX_78_2", "RX_78_2"], ["DoesNotExist"], ["*"]])
    assert.throws(() => f.store.saveWip({ revision: before, units }));
  assert.equal(f.store.revision(), before);
  const d = f.store.getWip();
  f.store.saveWip({ revision: d.revision, units: ["RX_78_2"] });
  assert.throws(() => f.store.saveWip({ revision: d.revision, units: [] }), /其他编辑/);
});
