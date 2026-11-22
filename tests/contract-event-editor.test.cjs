const test = require("node:test"),
  assert = require("node:assert/strict");
const Model = require("../contract-editor/model.js");
const catalog = require("../contract-editor/catalog.cjs");
const Contract = require("../shared/contract-mode.js");

test("current contract planning includes eight source types and seven special variants without conflating liaison kills", () => {
  const doc = Model.create(catalog, "V138");
  assert.deepEqual(Model.validate(doc), []);
  assert.deepEqual(
    doc.events.filter((e) => e.group === "基础事件").map((e) => e.type),
    Contract.kinds.map((k) => k.type),
  );
  assert.equal(doc.events.filter((e) => e.group === "联络委托变体").length, 7);
  assert.equal(doc.events.find(e=>e.id==='efsf-9').type,'enemybase');
  assert(doc.events.find(e=>e.id==='efsf-7').conditions.includes('敌军联邦'));
  assert(!doc.events.some((e) => e.id === "efsf-1"));
  assert(doc.events.find((e) => e.id === "capture").reinforcements.includes("3个"));
  assert(doc.commonRules.includes("24／27／30／33／36／39"));
});

test("planning JSON round trips versions, markers, custom types and full text without mutating templates", () => {
  const doc = Model.create(catalog, "V138"),
    before = JSON.stringify(catalog);
  doc.systemVersion = "2.5";
  const added = Model.add(doc, doc.events[0]);
  added.type = "escort";
  added.status = "有变动";
  added.notes = "新目标\n</script><script>alert('test')</script>";
  const imported = Model.parse("\uFEFF" + JSON.stringify(doc));
  assert.deepEqual(imported, doc);
  assert.equal(JSON.stringify(catalog), before);
  assert.equal(new Set(doc.events.map((e) => e.id)).size, doc.events.length);
  assert(Model.markdown(imported).includes("事件系统版本：2.5"));
  assert(Model.markdown(imported).includes(added.notes));
  const first = Model.add(doc);
  assert.equal(first.type, "custom");
  assert.deepEqual(Model.validate(doc), []);
});

test("invalid, oversized or wrong-tool files are rejected before replacement", () => {
  const doc = Model.create(catalog, "V138"),
    invalid = Model.clone(doc);
  invalid.events[1].id = invalid.events[0].id;
  assert(Model.validate(invalid).length);
  assert.throws(() => Model.parse(JSON.stringify(invalid)), /重复/);
  invalid.events[1].id = "ok";
  invalid.events[0].status = "completed";
  assert(Model.validate(invalid).length);
  assert.throws(
    () => Model.parse(JSON.stringify({ format: "projectgreed-contact-planning", version: 1 })),
    /合约/,
  );
  assert.throws(() => Model.parse("bad"), /JSON/);
  assert.throws(() => Model.parse(" ".repeat(5 * 1024 * 1024 + 1)), /5MB/);
  invalid.events[0].status = "无需调整";
  invalid.events[0].notes = 10;
  assert(Model.validate(invalid).length);
  assert.deepEqual(Model.validate({ ...doc, events: [] }), []);
});

test("server serves the standalone contract editor with no contract-edit API", async (t) => {
  const { createServer } = require("../server");
  const app = createServer({ port: 0, host: "127.0.0.1" }),
    address = await app.listen();
  t.after(() => app.close());
  const base = "http://127.0.0.1:" + address.port;
  const result = await fetch(base + "/admin/contract-event-editor.html");
  assert.equal(result.status, 200);
  assert((await result.text()).includes("ContractEventEditor"));
  assert.equal((await fetch(base + "/contract-event-editor.html")).status, 404);
  assert.equal(
    (await fetch(base + "/admin/contract-events", { method: "POST", body: "{}" })).status,
    405,
  );
});
