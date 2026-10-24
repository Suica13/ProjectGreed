const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules.js");
const { rows } = require("../tools/evaluate-cost.cjs");
test("native faction tags propagate across kits independently of room teams and resolve unit icons", () => {
  for (const prefab of G.catalog.prefabs) {
    const faction = prefab.id.startsWith("R") ? "EFSF" : "ZEON";
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
test("repriced platforms follow the requested tiers and top units share the same cost range", () => {
  const order = ["MS_06F", "MS_06J", "MS_06K", "RGM_79", "RGC_80", "MS_09"];
  const average = (id) => {
    const models = Object.values(G.models).filter((m) => m.prefabId === id);
    return models.reduce((sum, m) => sum + m.cost, 0) / models.length;
  };
  for (let i = 1; i < order.length; i++) assert.ok(average(order[i]) > average(order[i - 1]));
  const range = (id) => {
    const costs = Object.values(G.models)
      .filter((m) => m.prefabId === id)
      .map((m) => m.cost);
    return [Math.min(...costs), Math.max(...costs)];
  };
  assert.deepEqual(range("RGC_80"), range("RGM_79L"));
  assert.ok(average("MS_06J") <= average("MS_06F") * 1.25);
  for (const id of ["MS_09", "RGM_79_G"]) {
    assert.ok(
      G.catalog.prefabs.find((p) => p.id === id).stats.cost >= 475 &&
        G.catalog.prefabs.find((p) => p.id === id).stats.cost <= 550,
    );
    assert.ok(average(id) > average("RGM_79L"));
  }
  for (const row of rows) {
    // Stored COST is manually published; estimates can change after weapon balancing.
    const band = require("../tools/cost-balance.json")[G.models[row.id].prefabId];
    const prefab = G.catalog.prefabs.find((p) => p.id === G.models[row.id].prefabId);
    assert.ok(prefab.stats.cost >= band.min && prefab.stats.cost <= band.max);
    assert.equal(row.cost, G.models[row.id].cost);
    assert.equal(G.models[row.id].cost % 25, 0);
    assert.ok(row.platformEstimate >= band.min && row.platformEstimate <= band.max);
    assert.ok(Number.isFinite(row.offense) && row.offense > 0);
    assert.ok(Number.isFinite(row.effectiveHp) && row.effectiveHp > 0);
  }
});
test("ground GM upgrades ordinary GM protection and HP; missiles offer accuracy without heavy single-shot damage", () => {
  const gm = G.models.RGM_79__machine_gun,
    ground = G.models.RGM_79_G__machine_gun;
  assert.equal(G.models.MS_06F__machine_gun.hp, 12000);
  assert.equal(ground.hp, 20000);
  assert.ok(ground.hp > gm.hp && ground.move >= gm.move && ground.mobility > gm.mobility);
  assert.ok(ground.defenses.shell.percent > gm.defenses.shell.percent);
  assert.ok(ground.defenses.shell.flat > gm.defenses.shell.flat);
  const missile = G.models.RGM_79_G__missile_launcher.weapons[0];
  const cannon = G.models.RGM_79_G__cannon.weapons[0];
  assert.ok(missile.hit > cannon.hit);
  assert.ok(missile.damagePerShot < cannon.damagePerShot);
  assert.ok(missile.damage < cannon.damage);
  assert.equal(missile.shotCount, 3);
  assert.equal(missile.max, 7);
  assert.equal(missile.role, "guided_missile");
  const legs = G.models.MS_06J__machine_gun.weapons.find((w) => w.id === "ZN_MS_06J_LegMS");
  assert.equal(legs.shotCount, 2);
  assert.equal(legs.hit, 95);
  assert.equal(legs.en, 7.5);
});

test("Dom moves farther with low evasion; movement and mobility affect separate combat rules", () => {
  const dom = G.models.MS_09__bazooka,
    light = G.models.RGM_79L__beam_gun;
  assert.equal(dom.move, 7);
  assert.equal(dom.mobility, 85);
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

test("Gelgoog and ground Gundam machine guns gain ten percent damage with native firing cadence", () => {
  for (const [model, baseline] of [
    ["MS_14A__machine_gun", 850],
    ["RX_79_G__machine_gun", 900],
  ]) {
    const weapon = G.models[model].weapons[0];
    assert.equal(weapon.damagePerShot, Math.round(baseline * 1.1));
    assert.deepEqual(weapon.damageComponents, { shell: Math.round(baseline * 1.1) });
    assert.equal(weapon.damage, weapon.shotCount * weapon.damagePerShot);
  }
});

test("all primary weapon kits use fixed category surcharges on the unchanged platform base", () => {
  const costs = {
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
  for (const prefab of G.catalog.prefabs)
    for (const kit of prefab.weaponKits) {
      assert.equal(kit.cost, costs[kit.id], prefab.id + ":" + kit.id);
      assert.equal(G.models[prefab.id + "__" + kit.id].cost, prefab.stats.cost + costs[kit.id]);
    }
  assert.equal(G.models.RGM_79__machine_gun.cost, 350);
  assert.equal(G.models.RGM_79__bazooka.cost, 400);
  assert.equal(G.models.RGM_79__beam_spray.cost, 425);
  assert.equal(G.models.MS_14A__beam_rifle.cost, 900);
  assert.equal(G.models.RX_79_G__cannon.cost, 925);
});
