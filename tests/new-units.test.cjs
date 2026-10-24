const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const G = require("../shared/rules.js"),
  ART = G.catalog,
  WeaponSequence = require("../shared/weapon-sequence.js");
const ids = ["MS_06F", "MS_09", "RGM_79_G", "MS_06J", "MS_06K"];
const context = { ART, WeaponSequence };
vm.createContext(context);
vm.runInContext(
  fs.readFileSync("client/renderer.js", "utf8") + "\nglobalThis.renderer=SpriteRenderer;",
  context,
);
const renderer = context.renderer;
test("new native prefabs have real source stats, correct armor and shieldless units, all kits and no container variant", () => {
  for (const id of ids) {
    const p = ART.prefabs.find((p) => p.id === id);
    assert.ok(p);
    assert.equal(
      p.stats.hp,
      { MS_06F: 12000, MS_06J: 13500, MS_06K: 16000, MS_09: 22500, RGM_79_G: 20000 }[id],
    );
    assert.ok(p.stats.cost > 0);
    assert.equal(p.stats.counterLimit, 1);
    assert.ok(["zh", "en", "ja"].every((lang) => p.localization[lang].name));
    assert.ok(p.weaponKits.every((k) => k.weapons.every((w) => p.weapons[w])));
    if (id !== "RGM_79_G") {
      assert.equal(p.shield.hp, 0);
      assert.equal(p.presentation.shield, false);
    }
    for (const kit of p.weaponKits) assert.ok(G.models[id + "__" + kit.id]);
  }
  assert.equal(ART.prefabs.find((p) => p.id === "RGM_79_G").weaponKits.length, 5);
  assert.equal(ART.models.RGM_79_G__machine_gun.shield.hp, 2500);
  assert.ok(!Object.keys(G.models).some((id) => id.includes("WithBackpack")));
  assert.ok(ART.models.MS_09__bazooka.move > ART.models.MS_06F__machine_gun.move);
  assert.ok(ART.models.MS_06K__machine_gun.mobility < ART.models.MS_06J__machine_gun.mobility);
  assert.doesNotMatch(
    JSON.stringify(ART.prefabs.filter((p) => ids.includes(p.id))),
    /memory\.|self\.resource|\$\{/,
  );
});
test("new weapons retain native shot cadence, alternate left and right mounts and resolve native colored hit effects", () => {
  const f = G.models.MS_06F__machine_gun.weapons[0];
  assert.deepEqual(f.attack.shots, [0.3, 0.425, 0.55, 0.675, 0.8, 0.925, 1.05, 1.175]);
  assert.equal(f.clip, "Common_Shoot_Two_Handed_A");
  const chest = G.models.MS_09__bazooka.weapons.find((w) => w.id === "ZN_MS_09_ChestBeam");
  assert.equal(chest.shotCount, 8);
  assert.equal(chest.clip, null);
  assert.equal(chest.changeHeldWeapon, false);
  assert.equal(chest.hitEffect, "Beam_Hit_1_S_Yellow");
  assert.ok(chest.projectile.texture.endsWith("Beam_1_Yellow.png"));
  const leg = G.models.MS_06J__machine_gun.weapons.find((w) => w.id === "ZN_MS_06J_LegMS");
  assert.deepEqual(leg.attack.shots, [0.3, 0.3]);
  assert.deepEqual(leg.attack.muzzleIndices, [0, 1]);
  const big = G.models.MS_06K__big_gun.weapons[0];
  assert.deepEqual(big.attack.shots, [0.4, 0.5, 0.6, 0.7]);
  assert.deepEqual(big.attack.muzzleIndices, [0, 1, 0, 1]);
  for (const model of Object.values(G.models).filter((m) =>
    ids.concat(["MS_14A", "RX_79_G"]).includes(m.prefabId),
  )) {
    for (const w of model.weapons) {
      assert.ok(ART.effects[w.hitEffect]);
      assert.ok(ART.sounds[w.sound.asset]);
      if (w.type !== "melee") assert.ok(ART.assets[w.projectile.asset]);
      assert.equal("ammo" in w, false);
      assert.ok(w.en > 0 || (w.slot === "skill" && w.en === 0));
    }
  }
});
test("every new muzzle aligns with its source barrel including both launchers, mirrored facings and unequal scales", () => {
  for (const [modelId, model] of Object.entries(G.models).filter(([, m]) =>
    ids.concat(["MS_14A", "RX_79_G"]).includes(m.prefabId),
  )) {
    for (const w of model.weapons.filter((w) => w.type !== "melee")) {
      for (let index = 0; index < w.shotCount; index++) {
        const barrel = w.source.barrels[w.attack.muzzleIndices[index]];
        for (const angle of [90, -90])
          for (const scale of [0.4, 1.8]) {
            const point = renderer.muzzle(
                modelId,
                w,
                { x: 100, y: 80, angle, scale },
                null,
                0,
                index,
              ),
              sign = angle === 90 ? 1 : -1;
            assert.ok(
              Math.abs(point.x - (100 + sign * barrel.y * scale)) < 1e-7,
              modelId + "/" + w.id + " x",
            );
            assert.ok(
              Math.abs(point.y - (80 + sign * barrel.x * scale)) < 1e-7,
              modelId + "/" + w.id + " y",
            );
          }
      }
    }
  }
});
test("kit selection hides other held guns, fixed cannon remains, and a melee weapon switches its own art", () => {
  for (const [id, model] of Object.entries(G.models).filter(([, m]) =>
    ids.concat(["MS_14A", "RX_79_G"]).includes(m.prefabId),
  )) {
    const primary = model.weapons[0],
      held = renderer.visibleLayers(id, primary.id).map((l) => l.name);
    const prefab = ART.prefabs.find((p) => p.id === model.prefabId);
    for (const other of prefab.weaponKits.filter((k) => k.id !== model.kitId)) {
      const absent = other.weapons[0];
      assert.ok(!held.includes(absent), id + " must hide " + absent);
    }
    const melee = model.weapons.find((w) => w.type === "melee");
    assert.ok(melee);
    const layers = renderer.visibleLayers(id, melee.id).map((l) => l.name);
    if (melee.id !== "Common_Cqb_A") assert.ok(layers.includes(melee.id), id + " melee art");
    if (model.prefabId === "MS_06K") {
      assert.ok(held.includes("MS_06K_Cannon"));
      assert.ok(layers.includes("MS_06K_Cannon"));
    }
  }
});
test("shieldless armor receives authoritative damage without a fake shield or durability restoration", () => {
  const a = { unitId: "RGM_79", kitId: "machine_gun" },
    b = { unitId: "MS_06F", kitId: "machine_gun" };
  const g = G.create(false, 1, [[a], [b]]),
    [from, to] = g.units;
  Object.assign(from, { x: 2, y: 4 });
  Object.assign(to, { x: 4, y: 4 });
  const event = G.fight(g, from, to, G.models[from.model].weapons[0], "defend")[0];
  assert.equal(to.shield, 0);
  assert.ok(event.damage > 0);
  assert.equal(event.shieldDamage, 0);
  assert.ok(event.strikes.every((s) => !s.blocked));
});
test("player rings and owner labels use the viewing player's seat, not fixed red/blue faction colors", () => {
  const members = [
    { id: "a", name: "Alice", seat: 0 },
    { id: "b", name: "Bob", seat: 1 },
    { id: "c", name: "Carol", seat: 2 },
    { id: "d", name: "Dave", seat: 3 },
  ];
  const ctx = {
    Rules: G,
    Net: { active: true, seat: 3, snapshot: { members } },
    game: { ai: false, team: 0 },
    phase: "idle",
    Deployment: { team: () => 1 },
  };
  vm.createContext(ctx);
  vm.runInContext(
    fs.readFileSync("client/unit-identity.js", "utf8") + "\nglobalThis.identity=UnitIdentity;",
    ctx,
  );
  const own = { ownerSeat: 3, team: 1 },
    ally = { ownerSeat: 1, team: 1 },
    enemy = { ownerSeat: 0, team: 0 };
  assert.equal(ctx.identity.relation(own), "own");
  assert.equal(ctx.identity.relation(ally), "ally");
  assert.equal(ctx.identity.relation(enemy), "enemy");
  assert.equal(ctx.identity.owner(own).name, "Dave");
  assert.equal(ctx.identity.owner(own).team, "队伍2");
  const arcs = [],
    draw = {
      beginPath() {},
      arc(...args) {
        arcs.push(args);
      },
      fill() {},
      stroke() {},
    };
  ctx.identity.drawRing(draw, own, { x: 20, y: 30 }, 40);
  assert.deepEqual(arcs[0], [20, 30, 12.4, 0, Math.PI * 2]);
  assert.equal(draw.strokeStyle, "#68e99a");
  ctx.Net.active = false;
  ctx.game.ai = true;
  ctx.game.team = 1;
  assert.equal(ctx.identity.relation({ ownerSeat: 0, team: 0 }), "own");
  assert.equal(ctx.identity.relation({ ownerSeat: 1, team: 1 }), "enemy");
  assert.equal(ctx.identity.owner(ally).name, "AI");
  ctx.game.ai = false;
  ctx.phase = "deployment";
  assert.equal(ctx.identity.relation(own), "ally"); // Hotseat player 1 owns seat1, not an online-only seat3.
  assert.equal(ctx.identity.relation(ally), "own");
});
