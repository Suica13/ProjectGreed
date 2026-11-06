const { test } = require("node:test");
const assert = require("node:assert/strict");
const { inspect, replace, compactSquads, expandSquads } = require("../client/profile-storage.js");
function storage(values, limit) {
  const data = new Map(Object.entries(values));
  return {
    data,
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    removeItem: (key) => data.delete(key),
    setItem(key, value) {
      const next = new Map(data).set(key, value);
      if ([...next].reduce((n, [k, v]) => n + k.length + v.length, 0) > limit)
        throw Object.assign(Error("full"), { name: "QuotaExceededError" });
      data.set(key, value);
    },
  };
}
test("replacement releases obsolete records before allocating new keys at quota", () => {
  const store = storage({ old: "x".repeat(95) }, 100);
  replace(
    [
      ["new", "replacement"],
      ["old", null],
    ],
    store,
  );
  assert.deepEqual([...store.data], [["new", "replacement"]]);
});
test("failed replacement restores all originals without temporary allocation overhead", () => {
  const initial = { large: "x".repeat(85), settings: "yes" },
    store = storage(initial, 105);
  assert.throws(() =>
    replace(
      [
        ["large", null],
        ["small", "ok"],
        ["too-large", "x".repeat(200)],
      ],
      store,
    ),
  );
  assert.deepEqual(Object.fromEntries(store.data), initial);
});
test("assigned pilot avatars are stored once and expanded for portable archives", () => {
  const pilot = { id: "custom-one", name: "Pilot", uploadedPortrait: "avatar".repeat(5000) };
  const squads = [
    {
      name: "Squad",
      units: Array.from({ length: 20 }, () => ({ unitId: "Type61", customPilot: pilot })),
    },
  ];
  const compact = compactSquads(squads, [pilot]);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(squads).length / 100);
  assert.deepEqual(expandSquads(compact, [pilot]), squads);
  assert.deepEqual(compactSquads(squads, []), squads);
  assert.deepEqual(expandSquads(compact, [])[0].units[0], { unitId: "Type61" });
});
test("denied writes do not delete untouched existing records during rollback", () => {
  const store = storage({ existing: "preserved" }, 100);
  store.setItem = () => {
    throw Object.assign(Error("denied"), { name: "SecurityError" });
  };
  assert.throws(() => replace([["existing", "changed"]], store), { name: "SecurityError" });
  assert.equal(store.getItem("existing"), "preserved");
});
test("storage diagnostics distinguish zero quota from a healthy empty store", () => {
  const blocked = inspect(storage({}, 0));
  assert.equal(blocked.estimatedBytes, 0);
  assert.equal(blocked.readable, true);
  assert.equal(blocked.writable, false);
  assert.equal(blocked.errorName, "QuotaExceededError");
  const healthy = storage({}, 1000);
  assert.equal(inspect(healthy).writable, true);
  assert.equal(healthy.length, 0);
});
test("diagnostics report size categories without exposing keys or save secrets", () => {
  const data = storage(
    { "projectgreed.profile-identity.v1": "secret-value", "private-foreign-key": "other-secret" },
    1000,
  );
  const report = inspect(data);
  assert.equal(report.writable, true);
  assert.equal(report.groups.length, 2);
  assert.ok(!JSON.stringify(report).includes("secret"));
  assert.ok(!JSON.stringify(report).includes("foreign-key"));
  assert.equal(data.length, 2);
});
