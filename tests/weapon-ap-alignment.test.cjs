const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const Classes = require("../shared/weapon-classes");
const { createAttackPlanner } = require("../shared/attack-plans");

test("final AP follows type and mount priorities across the compiled catalog", () => {
  const prices = {
    bazooka: 5,
    beam_bazooka: 5,
    beam_rifle: 3,
    machine_gun: 4,
    cannon: 5,
    mortar: 6,
    sniper: 8,
  };
  let count = 0,
    wrists = 0,
    heads = 0;
  for (const model of Object.values(G.models))
    for (const w of model.weapons) {
      if (model.ship) continue;
      const expected = Classes.mountAP(w) ?? prices[Classes.classify(w)];
      if (expected !== undefined) {
        assert.equal(w.actionCost, expected, model.prefabId + "/" + w.id);
        count++;
      }
      if (Classes.wristWeapon(w)) {
        assert.equal(w.maxUsesPerTurn, 1, w.id);
        wrists++;
      }
      if (Classes.headBeam(w)) heads++;
    }
  assert(count > 1000);
  assert(wrists > 30);
  assert(heads > 0);
});

function fixture() {
  const model = Object.values(G.models).find(
    (m) => m.prefabId === "RX_78_4" && m.weapons.filter(Classes.wristWeapon).length === 2,
  );
  const game = G.create(
    false,
    1,
    [
      [{ unitId: model.prefabId, kitId: model.kitId }],
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
    ],
    false,
    { fogMode: "disabled" },
  );
  game.tiles.forEach((row) => row.fill("plain"));
  const [a, b] = game.units;
  game.units.forEach((u, i) =>
    Object.assign(u, { x: 5 + i, y: 5, hp: 1000000, en: 100000, shield: 0, actionPoints: 30 }),
  );
  const wrists = G.modelOf(a).weapons.filter(Classes.wristWeapon);
  const room = { game, matchId: "wrist-limit" };
  let sequence = 0;
  const planner = createAttackPlanner(G, () => String(++sequence));
  planner.reset(room);
  return { game, a, b, wrists, room, planner };
}

test("automatic fire enforces each wrist once and rejects manual selection", () => {
  const f = fixture();
  const automatic = G.firePlan(f.game, f.a, f.b);
  for (const wrist of f.wrists)
    assert(automatic.weapons.filter((w) => w.id === wrist.id).length <= 1);
  assert.throws(
    () => G.firePlan(f.game, f.a, f.b, { ids: [f.wrists[0].id, f.wrists[0].id] }),
    /不支持/,
  );
  assert.equal(automatic.ap, 0);
});

test("a multi-shot wrist use is complete, charged once, blocked until handoff, and independent per arm", () => {
  const f = fixture(),
    ids = f.wrists.map((w) => w.id);
  f.planner.plan(f.room, f.a, f.b, null, 0, "shooting", true);
  const [request] = f.planner.prepare(f.room);
  f.planner.choose(f.room, request.id, "defend");
  const events = f.planner
    .resolve(f.room)
    .flatMap((b) => b.events)
    .filter((e) => e.from === f.a.id && ids.includes(e.weapon));
  assert.equal(events.length, 2);
  assert(events.every((e) => e.strikes.length > 1));
  assert.equal(f.a.actionPoints, 30);
  for (const wrist of f.wrists) {
    assert.equal(f.a.weaponTurnUses[wrist.id], 1);
    assert.equal(G.canUse(f.a, wrist), false);
    assert.throws(() => G.firePlan(f.game, f.a, f.b, { ids: [wrist.id] }));
  }
  const counter = G.firePlan(f.game, f.a, f.b, { counter: true });
  assert(counter.weapons.every((w) => !ids.includes(w.id)));
  G.end(f.game);
  assert.equal(f.a.weaponTurnUses, undefined);
  assert(G.firePlan(f.game, f.a, f.b, { counter: true }).weapons.some((w) => w.id === ids[0]));
});

test("mount overrides do not classify handheld weapons by their arm bone", () => {
  assert.equal(
    Classes.mountAP({ id: "EF_BeamRifle", type: "beam", requiredParts: ["rightArm"] }),
    null,
  );
  assert.equal(Classes.mountAP({ sourceName: "Common_ArmBeamSaber_F", type: "melee" }), 3);
  assert.equal(Classes.mountAP({ sourceName: "ZN_MSN_02_Head_BR", type: "beam" }), 3);
  assert.equal(Classes.mountAP({ sourceName: "NEZ_AMX_011_HeadBeamCannon", type: "beam" }), 3);
});
