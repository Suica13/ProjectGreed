const { test } = require("node:test"),
  assert = require("node:assert/strict");
const { createStorage } = require("../apps/common/app-runtime.js");
function host() {
  let state = { ok: true, revision: 0, values: {} };
  return {
    read: () => JSON.stringify(state),
    commit(text) {
      const next = JSON.parse(text);
      if (this.fail) return JSON.stringify({ ok: false, error: "Disk full" });
      if (next.revision !== state.revision)
        return JSON.stringify({ ok: false, error: "Stale revision" });
      state = { ok: true, revision: state.revision + 1, values: next.values };
      return JSON.stringify({ ok: true, revision: state.revision });
    },
    snapshot: () => structuredClone(state),
  };
}
test("native facade saves beyond browser quota, restores Unicode and exposes Storage enumeration", () => {
  const disk = host(),
    a = createStorage(disk);
  a.storage.setItem("projectgreed.large", "x".repeat(6 * 1024 * 1024));
  a.storage["projectgreed.name"] = "驾驶员😀";
  assert.deepEqual(Object.keys(a.storage), ["projectgreed.large", "projectgreed.name"]);
  assert.equal(a.storage.length, 2);
  assert.equal(a.storage.key(1), "projectgreed.name");
  const b = createStorage(disk);
  assert.equal(b.storage.getItem("projectgreed.large").length, 6 * 1024 * 1024);
  assert.equal(b.storage.getItem("projectgreed.name"), "驾驶员😀");
  delete b.storage["projectgreed.name"];
  assert.equal(b.storage.getItem("projectgreed.name"), null);
});
test("a multi-key purchase is committed once, and disk failure preserves the entire wallet and roster", () => {
  const disk = host(),
    a = createStorage(disk);
  a.batch([
    ["projectgreed.money", "1000"],
    ["projectgreed.pilots", "[]"],
  ]);
  assert.equal(disk.snapshot().revision, 1);
  disk.fail = true;
  assert.throws(() =>
    a.batch([
      ["projectgreed.money", "0"],
      ["projectgreed.pilots", '["pilot"]'],
    ]),
  );
  assert.equal(a.storage.getItem("projectgreed.money"), "1000");
  assert.equal(a.storage.getItem("projectgreed.pilots"), "[]");
  assert.equal(disk.snapshot().revision, 1);
  disk.fail = false;
  a.batch([
    ["projectgreed.money", "0"],
    ["projectgreed.pilots", '["pilot"]'],
  ]);
  assert.equal(disk.snapshot().revision, 2);
});
test("stale native views cannot overwrite a newer save", () => {
  const disk = host(),
    a = createStorage(disk),
    b = createStorage(disk);
  a.storage.setItem("projectgreed.money", "1");
  assert.throws(() => b.storage.setItem("projectgreed.money", "2"), /Stale/);
  assert.equal(b.storage.getItem("projectgreed.money"), null);
  assert.equal(disk.snapshot().values["projectgreed.money"], "1");
});
test("failed reads never silently create empty profiles, and prototype-like keys remain plain data", () => {
  assert.throws(() => createStorage({ read: () => '{"ok":false,"error":"damaged"}' }), /damaged/);
  const a = createStorage(host());
  a.storage.setItem("__proto__", "safe");
  assert.equal(a.storage.getItem("__proto__"), "safe");
  assert.equal({}.safe, undefined);
  a.storage.clear();
  assert.equal(a.storage.length, 0);
});

test("a page from a previous save folder cannot overwrite the newly selected folder at the same revision", () => {
  let epoch = "internal",
    values = { wallet: "1000" };
  const bridge = {
    read: () => ({ ok: true, epoch, revision: 0, values }),
    commit: (text) => {
      const next = JSON.parse(text);
      if (next.epoch !== epoch) return { ok: false, error: "Storage location changed" };
      values = next.values;
      return { ok: true, revision: 1 };
    },
  };
  const oldPage = createStorage(bridge);
  epoch = "external";
  values = { wallet: "9000" };
  assert.throws(() => oldPage.storage.setItem("wallet", "0"), /Storage location changed/);
  assert.equal(values.wallet, "9000");
  const newPage = createStorage(bridge);
  newPage.storage.setItem("wallet", "8000");
  assert.equal(values.wallet, "8000");
});
