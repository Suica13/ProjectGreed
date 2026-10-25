const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const { rows } = require("../tools/evaluate-cost.cjs");
test("native faction tags propagate across kits independently of room teams and resolve unit icons", () => {
  for (const prefab of G.catalog.prefabs) {
    const faction =
      prefab.faction ||
      (prefab.id.startsWith("R") || ["SalamisClass", "FF_X7"].includes(prefab.id)
        ? "EFSF"
        : "ZEON");
    assert.deepEqual(prefab.tags, [faction, "0079"]);
    for (const kit of prefab.weaponKits) {
      const id = prefab.id + "__" + kit.id;
      assert.equal(G.models[id].faction, faction);
      assert.deepEqual(G.models[id].tags, [faction, "0079"]);
      const art = G.catalog.units.find((u) => u.id === id);
      assert.match(G.catalog.assets[art.icon], /^data:image\/png;base64,/);
    }
  }
  const entry = { unitId: "MS_06F", kitId: "machine_gun" };
  const game = G.create(false, 1, [[entry], [entry]]);
  assert.deepEqual(
    game.units.map((u) => u.team),
    [0, 1],
  );
  assert.equal(G.models[game.units[0].model].faction, G.models[game.units[1].model].faction);
});
test("all platform prices follow native Level while estimates remain informational", () => {
  for (const p of G.catalog.prefabs) {
    assert.equal(p.stats.cost, p.costBalance.published, p.id);
  }
  for (const row of rows) {
    assert.equal(row.cost, G.models[row.id].cost);
    assert.ok(Number.isFinite(row.offense) && row.offense > 0);
    assert.ok(Number.isFinite(row.effectiveHp) && row.effectiveHp > 0);
  }
});

test("native ground GM retains superior armor and original missile payload", () => {
  const gm = G.models.RGM_79__machine_gun,
    ground = G.models.RGM_79_G__machine_gun;
  assert.equal(G.models.MS_06F__machine_gun.hp, 15000);
  assert.equal(ground.hp, 25000);
  assert.ok(ground.hp > gm.hp);
  assert.ok(ground.defenses.shell.percent > gm.defenses.shell.percent);
  const missile = G.models.RGM_79_G__missile_launcher.weapons[0];
  assert.equal(missile.max, 4);
  assert.equal(missile.hit, missile.sourceHit);
  assert.equal(missile.damage, missile.damagePerShot * missile.shotCount);
});

test("Dom moves farther with low evasion; movement and mobility affect separate combat rules", () => {
  const dom = G.models.MS_09__bazooka,
    light = G.models.RGM_79L__beam_gun;
  assert.equal(dom.move, 8);
  assert.equal(dom.mobility, 100);
  assert.equal(dom.move, light.move);
  assert.ok(dom.mobility < light.mobility);
  const id = "MS_09__bazooka",
    original = G.models[id];
  const g = G.create(false, 1, [
    [{ unitId: "RGM_79", kitId: "machine_gun" }],
    [{ unitId: "MS_09", kitId: "bazooka" }],
  ]);
  g.tiles = g.tiles.map((row) => row.map(() => "plain"));
  const [a, b] = g.units;
  Object.assign(a, { x: 2, y: 2 });
  Object.assign(b, { x: 6, y: 5 });
  const w = G.models[a.model].weapons[0];
  const beforeHit = G.estimate(g, a, b, w).hit,
    beforeRange = G.reachable(g, b).size;
  try {
    G.models[id] = { ...original, move: 3 };
    assert.equal(G.estimate(g, a, b, w).hit, beforeHit);
    assert.ok(G.reachable(g, b).size < beforeRange);
    G.models[id] = { ...original, mobility: 135 };
    assert.ok(G.estimate(g, a, b, w).hit < beforeHit);
    assert.equal(G.reachable(g, b).size, beforeRange);
  } finally {
    G.models[id] = original;
  }
});

test("Gelgoog and ground Gundam machine guns use original payload and cadence", () => {
  assert.equal(G.models.MS_14A__machine_gun.weapons[0].damagePerShot, 750);
  for (const id of ["MS_14A__machine_gun", "RX_79_G__machine_gun"]) {
    const w = G.models[id].weapons[0];
    assert.equal(w.shotCount, w.nativeTiming.projectiles);
    assert.equal(w.hit, 100);
    assert.equal(w.en, 20);
  }
});

test("all primary weapon kits use fixed category surcharges on the unchanged platform base", () => {
  const costs = {
    standard: 0,
    machine_gun: 0,
    anti_air: 0,
    bazooka: 50,
    missile_launcher: 50,
    big_gun: 50,
    beam_spray: 75,
    beam_gun: 75,
    beam_rifle: 100,
    cannon: 100,
    magella_cannon: 100,
  };
  assert.deepEqual(require("../assets/weapon-kit-costs.json"), costs);
  for (const prefab of G.catalog.prefabs.filter((p) => !p.mechanics))
    for (const kit of prefab.weaponKits) {
      assert.equal(kit.cost, costs[kit.id], prefab.id + ":" + kit.id);
      assert.equal(G.models[prefab.id + "__" + kit.id].cost, prefab.stats.cost + costs[kit.id]);
    }
  assert.equal(G.models.RGM_79__machine_gun.cost, 250);
  assert.equal(G.models.RGM_79__bazooka.cost, 300);
  assert.equal(G.models.RGM_79__beam_spray.cost, 325);
  assert.equal(G.models.MS_14A__beam_rifle.cost, 475);
  assert.equal(G.models.RX_79_G__cannon.cost, 600);
});
