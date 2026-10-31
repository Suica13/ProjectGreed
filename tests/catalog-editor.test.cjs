const test = require("node:test"),
  assert = require("node:assert/strict");
const { editorFixture } = require("./catalog-editor-fixture.cjs");
const Schema = require("../shared/catalog-editor-schema.js");
const { createDeveloperServer, clientAllowed } = require("../tools/developer-server.cjs");
const { ensureDeveloper } = require("../tools/open-developer.cjs");

test("unit overrides, source prices, localization and slot order persist without changing templates or other units", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const fs = require("node:fs"),
    path = require("node:path");
  fs.mkdirSync(path.join(f.root, "public"));
  fs.writeFileSync(path.join(f.root, "public/client.html"), "Unchanged client build");
  const data = f.store.getUnit("RX_78_2"),
    originalLibrary = f.read("assets/weapons.json");
  const other = f.read("assets/units/RGM_79/unit.json");
  data.id = data.unit.id;
  data.unit.stats.hp += 500;
  data.unit.localization.en.name = "Editor Gundam";
  data.unit.shield.hp += 100;
  data.unit.shield.blockChance = 0.6;
  data.unit.presentation.previewScale = 1.2;
  data.price = { money: 500, supplies: 1000 };
  const id = data.unit.weaponKits[0].weapons[0];
  Schema.setDamage(data.unit.weapons[id], 2000);
  Schema.setHit(data.unit.weapons[id], 90);
  data.unit.weaponKits[0].weapons.reverse();
  const templates = f.store.templates();
  data.unit.skills.push(
    structuredClone(templates.skills.find((s) => s.value.type === "emp").value),
  );
  f.store.saveUnit(data);
  assert.equal(
    fs.readFileSync(path.join(f.root, "public/client.html"), "utf8"),
    "Unchanged client build",
  );
  assert.equal(fs.existsSync(path.join(f.root, "public/developer.html")), false);
  const saved = f.store.getUnit(data.id);
  assert.equal(saved.unit.stats.hp, data.unit.stats.hp);
  assert.equal(saved.unit.weapons[id].damagePerShot, 2000);
  assert.equal(saved.unit.localization.en.name, "Editor Gundam");
  assert.equal(saved.price.money, 500);
  assert.equal(saved.unit.presentation.previewScale, 1.2);
  assert.deepEqual(saved.unit.weaponKits[0].weapons, data.unit.weaponKits[0].weapons);
  assert.deepEqual(f.read("assets/weapons.json"), originalLibrary);
  assert.deepEqual(f.read("assets/units/RGM_79/unit.json"), other);
  assert(f.read("assets/units/RX_78_2/unit.json").weapons[id].overrides);
});

test("common weapon adjustments stack with per-unit numeric offsets", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const unit = f.store.getUnit("RX_78_2");
  unit.id = unit.unit.id;
  const id = "EF_HypeBazooka";
  const localDelta = 93 - unit.unit.weapons[id].hit;
  Schema.setHit(unit.unit.weapons[id], 93);
  f.store.saveUnit(unit);
  const ref = f.read("assets/units/RX_78_2/unit.json").weapons[id].ref;
  const common = f.store.getWeapon(ref);
  Schema.setHit(common.weapon, 77);
  f.store.saveWeapon(common);
  assert.equal(f.store.getUnit("RX_78_2").unit.weapons[id].hit, 77 + localDelta);
  assert.equal(f.store.getWeapon(ref).weapon.hit, 77);
  assert.throws(() => f.store.saveWeapon(common), /其他编辑修改/);
});

test("editor AP and damage offsets follow runtime balance policies", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const data = f.store.getUnit("RX_78_2");
  data.id = data.unit.id;
  const machine = Object.keys(data.unit.weapons).find(
    (id) => data.unit.weapons[id].category === "machine_gun",
  );
  const beam = Object.keys(data.unit.weapons).find(
    (id) => data.unit.weapons[id].category === "beam_rifle",
  );
  data.unit.weapons[machine].actionCost = 3;
  Schema.setDamage(data.unit.weapons[beam], 5000);
  f.store.saveUnit(data);
  const catalog = f.catalog();
  const models = Object.values(catalog.models).filter((model) => model.prefabId === data.id);
  assert(models.some((model) => model.weapons.some((w) => w.id === machine && w.actionCost === 3)));
  assert(
    models.some((model) => model.weapons.some((w) => w.id === beam && w.damagePerShot === 5000)),
  );
  const commonRef = f.read("assets/units/RX_78_2/unit.json").weapons[machine].ref;
  const common = f.store.getWeapon(commonRef);
  const commonDelta = 4 - common.weapon.actionCost;
  common.weapon.actionCost = 4;
  f.store.saveWeapon(common);
  assert.equal(f.store.getUnit(data.id).weaponViews[machine].actionCost, 3 + commonDelta);
});

test("validation rejects bad ranges, unit-changing skills, and rolls back invalid unit data", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const before = f.store.revision();
  const data = f.store.getUnit("RX_78_2");
  data.id = data.unit.id;
  data.unit.stats.hp = -1;
  assert.throws(() => f.store.saveUnit(data), /Invalid/);
  assert.equal(f.store.revision(), before);
  const retry = f.store.getUnit(data.id);
  retry.id = data.id;
  retry.unit.skills = [];
  assert.throws(() => f.store.saveUnit(retry), /单位变化/);
  const weapon = f.store.getWeapon("EF_HypeBazooka__lv2");
  weapon.weapon.min = 100;
  assert.throws(() => f.store.saveWeapon(weapon), /最小射程/);
  assert.equal(f.store.revision(), before);
});

test("unit ID changes update registered source references without relocating assets", (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const data = f.store.getUnit("Type61");
  data.id = "Type61";
  data.unit.id = "Editor_Type61";
  const result = f.store.saveUnit(data);
  assert.equal(result.id, "Editor_Type61");
  assert.equal(f.read("assets/units/Type61/unit.json").id, result.id);
  assert(f.read("shared/production-catalog.json").licenseOffers[result.id]);
  assert.equal(f.store.getUnit(result.id).unit.materials.icon, data.unit.materials.icon);
});

test("local editor service rejects cross-site requests and unauthenticated writes", async (t) => {
  const f = editorFixture();
  t.after(f.cleanup);
  const app = createDeveloperServer({ port: 0, store: f.store, catalog: f.catalog });
  const address = await app.listen();
  t.after(() => app.close());
  const base = "http://127.0.0.1:" + address.port;
  assert.equal(
    (await fetch(base + "/api/editor/session", { headers: { Origin: "https://example.com" } }))
      .status,
    403,
  );
  assert.equal(
    (await fetch(base + "/api/editor/unit", { method: "POST", body: "{}" })).status,
    401,
  );
  const metadata = await (await fetch(base + "/api/editor/session")).json();
  assert.equal(metadata.token, undefined);
  assert.equal((await fetch(base + "/api/editor/bootstrap")).status, 401);
  assert.equal(
    (
      await fetch(base + "/api/editor/session", {
        method: "POST",
        body: JSON.stringify({ key: "wrong" }),
      })
    ).status,
    401,
  );
  const session = await (
    await fetch(base + "/api/editor/session", {
      method: "POST",
      body: JSON.stringify({ key: "13450" }),
    })
  ).json();
  const headers = { "X-Editor-Token": session.token };
  const data = await (await fetch(base + "/api/editor/unit?id=RX_78_2", { headers })).json();
  assert.equal(data.unit.id, "RX_78_2");
  assert.equal((await fetch(base + "/client.html", { headers })).status, 404);
});

test("one-click launcher reuses the matching editor and rejects unrelated services", async (t) => {
  const app = createDeveloperServer({ port: 0 });
  const address = await app.listen();
  t.after(() => app.close());
  const base = "http://127.0.0.1:" + address.port;
  const before = await (await fetch(base + "/api/editor/session")).json();
  assert.equal(
    await ensureDeveloper({ port: address.port, open: false }),
    base + "/developer.html",
  );
  const after = await (await fetch(base + "/api/editor/session")).json();
  assert.equal(before.token, after.token);
  assert.equal(after.protocol, 2);
  const other = require("node:http").createServer((req, res) => res.end("{}"));
  await new Promise((resolve) => other.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        other.closeAllConnections();
        other.close(resolve);
      }),
  );
  await assert.rejects(
    ensureDeveloper({ port: other.address().port, open: false }),
    /已被其他程序/,
  );
});

test("remote editor access respects explicit client IP ranges", () => {
  assert.equal(clientAllowed("203.0.113.5", null), true);
  assert.equal(clientAllowed("192.168.1.20", []), false);
  assert.equal(clientAllowed("192.168.1.20", ["192.168.1.0/24"]), true);
  assert.equal(clientAllowed("::ffff:192.168.1.20", ["192.168.1.20"]), true);
  assert.equal(clientAllowed("203.0.113.5", ["192.168.1.0/24"]), false);
  assert.equal(clientAllowed("127.0.0.1", []), true);
});
