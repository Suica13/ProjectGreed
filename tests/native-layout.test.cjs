const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const G = require("../shared/rules"),
  { loadCatalog } = require("../tools/load-catalog.cjs");
const prefab = (id) => G.catalog.prefabs.find((p) => p.id === id);
const model = (id) => Object.values(G.models).find((m) => m.prefabId === id);
test("tank turret decals retain native attachments and firing mounts use the same semantic joints", () => {
  for (const id of ["Type61", "Type61A5", "MTank_Eins"]) {
    const p = prefab(id);
    assert.ok(p.stats.visualTurrets.length, id);
    for (const t of p.stats.visualTurrets) {
      assert.ok(p.skeleton[t.bone]);
      assert.ok(p.layers.some((l) => l.bone === t.bone));
    }
    assert.ok(
      model(id).weapons.some((w) =>
        w.muzzle?.mounts?.some((m) => p.stats.visualTurrets.some((t) => m.bone === t.bone)),
      ),
    );
  }
});
test("main native equipment choices retain every common fixed weapon, including fixed chest guns", () => {
  assert.equal(prefab("MSM_03").weaponKits.length, 1);
  assert.ok(prefab("MSM_03").weaponKits[0].weapons.includes("ZN_MSM_03_ChestBeam"));
  assert.ok(prefab("MSM_03").weaponKits[0].weapons.includes("ZN_MSM_03_SMS"));
  const rx = prefab("RX_78_2");
  assert.equal(rx.weaponKits.length, 3);
  assert.ok(rx.weaponKits.some((k) => k.weapons.includes("EF_SHM")));
  for (const k of rx.weaponKits) assert.ok(k.weapons.includes("Common_DoubleVulcan_MS"));
});
test("pilot skills and alternate secondary equipment stay documented but cannot enter any playable kit", () => {
  const rx = prefab("RX_78_2");
  assert.ok(rx.weapons.EF_BeamSaber_Double_AALDF.availability.reasons.includes("pilot_skill"));
  assert.ok(rx.weapons.EF_BeamJavelin_BF_B.availability.reasons.includes("secondary_loadout"));
  assert.ok(model("RX_78_2").hiddenWeapons.some((w) => w.reasons.includes("pilot_skill")));
  for (const p of G.catalog.prefabs)
    for (const k of p.weaponKits)
      for (const w of k.weapons) assert.ok(!p.weapons[w].availability?.hidden, p.id + "/" + w);
  assert.doesNotMatch(JSON.stringify(G.catalog.prefabs), /memory\.|self\.resource/);
});
test("left/right barrels share one attack, with native firing sub-actions counted exactly once", () => {
  const m = model("MSM_03");
  assert.equal(m.weapons.filter((w) => w.id.startsWith("ZN_MSM_03_ChestBeam")).length, 1);
  const beam = m.weapons.find((w) => w.id === "ZN_MSM_03_ChestBeam");
  assert.equal(beam.shotCount, 12);
  assert.deepEqual([...new Set(beam.attack.muzzleIndices)].sort(), [0, 1]);
  const ship = model("PegasusClass");
  assert.equal(ship.weapons.length, 4);
  for (const w of ship.weapons) {
    assert.equal(new Set(w.moduleIds).size, w.moduleIds.length);
    for (const id of w.moduleIds)
      assert.ok(
        w.attack.strikes.some((s) => s.moduleId === id),
        id,
      );
  }
  assert.equal(ship.weapons.find((w) => w.id === "PegasusClass_Turret_Cannon").shotCount, 6);
});
test("removed kits migrate saved unit names and map to valid canonical kits", () => {
  let count = 0;
  for (const p of G.catalog.prefabs.filter((p) => !p.formOnly))
    for (const [old, current] of Object.entries(p.kitAliases || {})) {
      const [clean] = G.validateFormation(
        [{ unitId: p.id, kitId: old, customName: "测试[A01]" }],
        Infinity,
      );
      assert.equal(clean.kitId, current);
      assert.equal(clean.customName, "测试[A01]");
      count++;
    }
  assert.ok(count > 20);
});
test("platform prices use native unit Level rather than repeatable halving", () => {
  for (const p of G.catalog.prefabs) {
    assert.equal(p.stats.cost, Math.max(25, Math.round(p.sourceStats.unitLevel / 100) * 25), p.id);
    assert.equal(p.sourceStats.balanceStatus, "native-level");
  }
});

test("every space spawn fits twelve horizontal warships without overlap and permits deployment rotations", () => {
  for (const map of Object.values(G.catalog.maps).filter((m) => m.environment === "space")) {
    const army = Array(12).fill({ unitId: "SalamisClass", kitId: "standard" });
    const g = G.create(
      false,
      1,
      map.spawns.map(() => army),
      true,
      { mapId: map.id, costLimit: 99999 },
    );
    const seen = new Set();
    for (const u of g.units) {
      assert.deepEqual(G.dimensions(u), { width: 3, height: 2 });
      for (const c of G.cells(u)) {
        const key = G.key(c.x, c.y);
        assert.ok(!seen.has(key));
        seen.add(key);
      }
    }
  }
});
test("supply ranges use footprint cells below sprites, appear for selected enemy ships or in-range allies", () => {
  const sandbox = {
    Net: { active: true, seat: 0 },
    Rules: {
      ownerOf: (u) => u.ownerSeat,
      seatTeam: (s) => s % 2,
      center: (u) => ({ x: u.x || 0, y: u.y || 0 }),
      modelOf: () => ({ ship: true, supplyAura: { range: 2 } }),
      inSupplyRange: (a,b) => Math.abs((b.x || 0) - (a.x || 0)) <= 2,
      supplyCells: () => [{x:0,y:0}],
      key: (x,y) => x + "," + y,
      models: { ship: { ship: true } },
    },
    game: {},
    Deployment: {},
    Math,
  };
  vm.createContext(sandbox);
  vm.runInContext(
    fs.readFileSync("client/unit-identity.js", "utf8") + ";globalThis.identity=UnitIdentity",
    sandbox,
  );
  const arcs = [],
    ctx = {
      save() {},
      restore() {},
      beginPath() {},
      moveTo() {},
      lineTo() {},
      fillRect(...a) {
        arcs.push(a);
      },
      fill() {},
      stroke() {},
    };
  const ship = { id: "s", model: "ship", ownerSeat: 1, team: 1 };
  sandbox.identity.drawCommandAura(ctx, ship, { x: 0, y: 0 }, 64, null);
  assert.equal(arcs.length, 0);
  sandbox.identity.drawCommandAura(ctx, ship, { x: 0, y: 0 }, 64, ship);
  assert.equal(arcs.length, 1);
  sandbox.identity.drawCommandAura(ctx, ship, { x: 0, y: 0 }, 64, { id: "a", team: 1, x: 1, y: 0 });
  assert.equal(arcs.length, 2);
  sandbox.identity.drawCommandAura(ctx, ship, { x: 0, y: 0 }, 64, { id: "b", team: 1, x: 5, y: 0 });
  assert.equal(arcs.length, 2);
  sandbox.identity.drawCommandAura(ctx, ship, { x: 0, y: 0 }, 64, { id: "c", team: 0, x: 0, y: 0 });
  assert.equal(arcs.length, 2);
  assert.equal(arcs[0][2], 64);
  assert.equal(ctx.fillStyle, "#35d6c130");
  for (const p of G.catalog.prefabs) assert.ok(!p.layers.some((l) => /^Ring/.test(l.texture)));
  const app = fs.readFileSync("client/app.js", "utf8");
  assert.ok(
    app.indexOf("UnitIdentity.drawCommandAura(ctx") <
      app.indexOf("SpriteRenderer.draw(", app.indexOf("const mapUnitPoses")),
  );
});
