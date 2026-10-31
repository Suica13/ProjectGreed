const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  path = require("node:path");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
const { createDeveloperServer } = require("../tools/developer-server.cjs");
const { exceptionFile } = require("../tools/editor-audit.cjs");

const logs = (root) => {
  const directory = path.join(root, "server-data/editor-changes");
  return fs.existsSync(directory)
    ? fs
        .readdirSync(directory, { recursive: true })
        .filter((file) => file.endsWith(".json"))
        .map((file) => JSON.parse(fs.readFileSync(path.join(directory, file), "utf8")))
    : [];
};
const editableUnit = (f, id = "RX_78_2") => ({ ...f.store.getUnit(id), id });

test("unit edits log exact field and price changes and preserve the curated exception table", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const document = fs.readFileSync(path.join(f.root, exceptionFile), "utf8");
  const draft = editableUnit(f),
    hp = draft.unit.stats.hp;
  draft.unit.stats.hp += 500;
  draft.price = { money: 700, supplies: 900 };
  const result = f.store.saveUnit(draft, {
    ip: "::ffff:203.0.113.20",
    sessionId: "non-secret-session",
  });
  const record = f.read(result.auditLog);
  assert.equal(record.source.ip, "203.0.113.20");
  assert.equal(record.beforeRevision, draft.revision);
  assert.equal(record.afterRevision, result.revision);
  assert.equal(record.operation, "unit");
  const fields = record.units.find((unit) => unit.id === draft.id).changes;
  assert(
    fields.some(
      (field) => field.path === "/stats/hp" && field.before === hp && field.after === hp + 500,
    ),
  );
  assert(fields.some((field) => field.path === "/deploymentLicense/money" && field.after === 700));
  const table = fs.readFileSync(path.join(f.root, exceptionFile), "utf8");
  assert(table.startsWith(document.split("<!-- catalog-editor-exceptions:start -->")[0]));
  assert(table.includes(result.auditLog));
  assert(table.includes("203.0.113.20"));
  assert(table.includes("RX_78_2"));
  assert.equal(logs(f.root).length, 1);
});

test("common-template edits log all affected units including additive unit exceptions", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const first = editableUnit(f);
  first.unit.weapons.EF_HypeBazooka.hit = 93;
  f.store.saveUnit(first);
  const ref = f.read("assets/units/RX_78_2/unit.json").weapons.EF_HypeBazooka.ref;
  const before = f.catalog();
  const common = f.store.getWeapon(ref);
  common.weapon.hit = 77;
  const result = f.store.saveWeapon(common, { ip: "198.51.100.2" });
  const record = f.read(result.auditLog),
    after = f.catalog();
  assert.equal(record.operation, "weapon-template");
  assert.equal(record.target.id, ref);
  assert(record.units.some((unit) => unit.id === first.id));
  const affected = before.prefabs
    .filter((unit) => {
      const next = after.prefabs.find((value) => value.id === unit.id);
      return Object.entries(unit.weapons).some(
        ([id, weapon]) => weapon.hit !== next.weapons[id]?.hit,
      );
    })
    .map((unit) => unit.id)
    .sort();
  assert(affected.length > 0);
  assert.deepEqual(record.units.map((unit) => unit.id).sort(), affected);
  assert(fs.readFileSync(path.join(f.root, exceptionFile), "utf8").includes(result.auditLog));
});

test("repeated no-op saves create no audit entries and newest changes appear first", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const first = editableUnit(f);
  first.unit.stats.hp += 500;
  const a = f.store.saveUnit(first);
  const unchanged = f.store.getWeapon("EF_HypeBazooka__lv2");
  assert.equal(f.store.saveWeapon(unchanged).noChanges, true);
  assert.equal(logs(f.root).length, 1);
  const next = editableUnit(f);
  next.unit.stats.hp += 500;
  const b = f.store.saveUnit(next);
  const table = fs.readFileSync(path.join(f.root, exceptionFile), "utf8");
  assert(table.indexOf(b.auditLog) < table.indexOf(a.auditLog));
  assert.equal(logs(f.root).length, 2);
});

test("invalid edits and audit write failures restore JSON and do not register exceptions", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const document = fs.readFileSync(path.join(f.root, exceptionFile), "utf8"),
    revision = f.store.revision();
  const invalid = editableUnit(f);
  invalid.unit.stats.hp = -1;
  assert.throws(() => f.store.saveUnit(invalid));
  assert.equal(logs(f.root).length, 0);
  assert.equal(f.store.revision(), revision);
  fs.mkdirSync(path.join(f.root, "server-data"));
  fs.writeFileSync(
    path.join(f.root, "server-data/editor-changes"),
    "This is a file, not a log directory",
  );
  const valid = editableUnit(f);
  valid.unit.stats.hp += 500;
  assert.throws(() => f.store.saveUnit(valid));
  assert.equal(f.store.revision(), revision);
  assert.equal(fs.readFileSync(path.join(f.root, exceptionFile), "utf8"), document);
});

test("malformed exception section rolls back source and logs; unit renames include old and new IDs", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const file = path.join(f.root, exceptionFile),
    document = fs.readFileSync(file, "utf8");
  fs.writeFileSync(file, document + "\n<!-- catalog-editor-exceptions:start -->");
  const before = f.store.revision(),
    draft = editableUnit(f, "Type61");
  draft.unit.id = "Renamed_Type61";
  assert.throws(() => f.store.saveUnit(draft), /自动登记标记/);
  assert.equal(f.store.revision(), before);
  assert.equal(logs(f.root).length, 0);
  fs.writeFileSync(file, document);
  const result = f.store.saveUnit(draft);
  const record = f.read(result.auditLog),
    unit = record.units.find((unit) => unit.id === "Renamed_Type61");
  assert.equal(unit.previousId, "Type61");
  assert.equal(record.target.newId, "Renamed_Type61");
});

test("exception table write failure removes the new log and rolls back all source changes", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const file = path.join(f.root, exceptionFile),
    document = fs.readFileSync(file, "utf8"),
    revision = f.store.revision();
  const rename = fs.renameSync;
  t.mock.method(fs, "renameSync", (from, to) => {
    if (to === file) throw Object.assign(Error("exception table denied"), { code: "EACCES" });
    return rename(from, to);
  });
  const draft = editableUnit(f);
  draft.unit.stats.hp += 500;
  assert.throws(() => f.store.saveUnit(draft), /exception table denied/);
  assert.equal(f.store.revision(), revision);
  assert.equal(logs(f.root).length, 0);
  assert.equal(fs.readFileSync(file, "utf8"), document);
});

test("authenticated HTTP saves record the actual socket IP, never client claims or access secrets", async (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const app = createDeveloperServer({ port: 0, store: f.store, catalog: f.catalog });
  const address = await app.listen();
  t.after(() => app.close());
  const base = "http://127.0.0.1:" + address.port;
  const session = await (
    await fetch(base + "/api/editor/session", {
      method: "POST",
      body: JSON.stringify({ key: "13450" }),
    })
  ).json();
  const draft = editableUnit(f);
  draft.unit.stats.hp += 500;
  draft.ip = "forged-IP";
  draft.key = "13450";
  const response = await fetch(base + "/api/editor/unit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Editor-Token": session.token,
      "X-Forwarded-For": "forged-IP",
    },
    body: JSON.stringify(draft),
  });
  assert.equal(response.status, 200);
  const result = await response.json(),
    bytes = fs.readFileSync(path.join(f.root, result.auditLog), "utf8"),
    record = JSON.parse(bytes);
  assert.equal(record.source.ip, "127.0.0.1");
  assert(record.source.sessionId);
  assert(!bytes.includes(session.token));
  assert(!bytes.includes("forged-IP"));
  assert.equal(logs(f.root).length, 1);
});
