const test = require("node:test"),
  assert = require("node:assert/strict");
const M = require("../task-editor/model"),
  statuses = require("../task-editor/catalog.cjs");
test("contact exports keep embedded portraits and exclude other contacts", () => {
  const fs = require("node:fs");
  const d = JSON.parse(fs.readFileSync("docs/data/contacts/efsf-1.0.json", "utf8"));
  const other = JSON.parse(fs.readFileSync("docs/data/contacts/anaheim-1.0.json", "utf8"));
  d.contacts.push(other.contacts[0]);
  assert.deepEqual(M.validate(d, statuses), []);
  const output = M.bundle(d, statuses, "efsf");
  assert.equal(output.contacts.length, 1);
  assert.equal(d.contacts.length, 2);
  assert.equal(output.contacts[0].tasks.length, 6);
  const portrait = output.contacts[0].portrait;
  assert.deepEqual(Buffer.from(portrait.dataUrl.split(",")[1], "base64"), fs.readFileSync(portrait.source));
  assert.equal(M.bundle(d, statuses, "anaheim").contacts[0].tasks.length, 0);
  assert.throws(() => M.bundle(d, statuses, "missing"));
  d.contacts[0].portrait.dataUrl = "https://example.com/avatar.svg";
  assert(M.validate(d, statuses).some(e => e.includes("头像")));
});
test("planning data has only version, change markers and free text, independently of runtime missions", () => {
  const d = M.blank(),
    c = d.contacts[0],
    t = M.add(d, c, null);
  d.systemVersion = "方案B-2026.11";
  t.name = "首秀";
  t.text = "任务目标、奖励与对话由策划自由填写。";
  assert.deepEqual(
    statuses.map((s) => s.id),
    ["无需调整", "需要调整", "有变动", "废弃"],
  );
  assert.deepEqual(M.validate(d, statuses), []);
  for (const status of statuses) {
    t.status = status.id;
    assert.deepEqual(M.validate(d, statuses), []);
  }
  const output = M.bundle(d, statuses);
  assert.equal(output.systemVersion, d.systemVersion);
  assert.equal(output.contacts[0].tasks[0].text, t.text);
  assert.equal(output.contacts[0].tasks[0].status, "废弃");
  assert(!("kind" in output.contacts[0].tasks[0]));
  assert(!("gameVersion" in output));
  assert(output.aiGuide.instructions.some((t) => t.includes("无需调整")));
  assert.deepEqual(M.validate(JSON.parse(JSON.stringify(output)), statuses), []);
});
test("tree branches and joins validate, while cycles and missing dependencies are rejected", () => {
  const d = M.blank(),
    c = d.contacts[0],
    a = M.add(d, c, null),
    b = M.add(d, c, a.id),
    x = M.add(d, c, a.id),
    j = M.add(d, c, null);
  j.requires = [b.id, x.id];
  assert.deepEqual(M.validate(d, statuses), []);
  const layout = M.layout(c);
  assert.equal(layout.positions.size, 4);
  assert.notEqual(layout.positions.get(b.id).x, layout.positions.get(x.id).x);
  a.requires = [j.id];
  assert(M.validate(d, statuses).some((e) => e.includes("循环")));
  a.requires = ["missing"];
  assert(M.validate(d, statuses).some((e) => e.includes("不存在")));
  a.requires = [];
  a.status = "进行中";
  assert(M.validate(d, statuses).some((e) => e.includes("标记")));
  a.status = "无需调整";
  d.systemVersion = "";
  assert(M.validate(d, statuses).length);
});
