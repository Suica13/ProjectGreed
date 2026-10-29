const test = require("node:test"),
  assert = require("node:assert/strict"),
  G = require("../shared/rules.js");
const entry = { unitId: "RGM_79", kitId: "machine_gun" };
function fixture(deployment = false) {
  const g = G.create(false, 1, [[entry, entry, entry, entry], [entry]], false, {
    costLimit: 99999,
    unitCostLimit: 99999,
  });
  g.tiles.forEach((row) => row.fill("plain"));
  const carrier = g.units[0];
  carrier.model = Object.keys(G.models).find((id) => id.startsWith("PegasusClass__"));
  Object.assign(carrier, { x: 10, y: 8, hp: G.modelOf(carrier).hp, en: G.modelOf(carrier).en });
  g.units.slice(1).forEach((u, i) => Object.assign(u, { x: 8, y: 9 + i }));
  if (deployment) {
    g.deployment = [false, false];
    const point = G.deploymentCells(g, 0, carrier).find(
      (p) => p.x > 0 && G.fits(g, carrier, p.x, p.y, carrier.angle, false, 0),
    );
    Object.assign(carrier, point);
  }
  const hull = G.cells(carrier);
  g.units
    .filter((u) => u.team === 0 && u !== carrier)
    .forEach((u, i) => Object.assign(u, { x: hull[0].x - 1, y: hull[0].y + i }));
  return { g, carrier, u: g.units[1], h: G.hangars.of(carrier)[0] };
}
test("all imported units have separate type tags and valid native capacities", () => {
  assert(G.catalog.prefabs.length > 0);
  assert(G.catalog.prefabs.some(p => p.hangars.length));
  for (const p of G.catalog.prefabs) {
    assert(p.unitTags.length, p.id);
    assert(
      p.tags.every((t) => ["EFSF", "ZEON", "0079E", "0079L", "0083"].includes(t)),
      p.id,
    );
    assert(Number.isInteger(p.transport.slotCost) && p.transport.slotCost > 0, p.id);
    assert(Array.isArray(p.transport.loadTags));
    assert.equal(new Set(p.hangars.map((h) => h.id)).size, p.hangars.length, p.id);
    for (const h of p.hangars) {
      assert(h.capacity > 0, p.id);
      assert(h.allowedTags.length, p.id);
      assert(h.source, p.id);
    }
  }
  assert(G.models.RGM_79__machine_gun.unitTags.includes("MS"));
  assert.equal(G.models.RGM_79__machine_gun.transport.slotCost, 2);
  assert.equal(
    G.hangars.of({ model: Object.keys(G.models).find((id) => id.startsWith("SalamisClass__")) })
      .length,
    0,
  );
});
test("deployment preload uses transport points, rejects overflow and confirmed owner's changes", () => {
  const { g, carrier, u, h } = fixture(true);
  const before = { hp: u.hp, en: u.en, parts: u.brokenParts, name: u.customName };
  for (const passenger of g.units.filter((p) => p.team === 0 && p !== carrier))
    G.hangars.embark(g, passenger, carrier, h.id);
  assert.equal(G.hangars.used(g, carrier, h.id), 6);
  const extra = { ...u, id: "extra", embarked: undefined };
  g.units.push(extra);
  assert(!G.hangars.canEmbark(g, extra, carrier, h.id));
  g.units.pop();
  assert.equal(u.hp, before.hp);
  assert.equal(u.en, before.en);
  assert.equal(u.brokenParts, before.parts);
  assert(!G.onMap(u));
  assert.notEqual(G.at(g, u.x, u.y)?.id, u.id);
  assert.equal(G.reachable(g, u).size, 0);
  assert(!G.canAttack(g, u, g.units.at(-1), G.modelOf(u).weapons[0]));
  assert(!G.canAttack(g, g.units.at(-1), u, G.modelOf(g.units.at(-1)).weapons[0]));
  assert.throws(() => G.move(g, u, 8, 8));
  assert.throws(() => G.wait(g, u));
  const destination = G.hangars.launchCells(g, u)[0];
  assert(destination);
  G.hangars.launch(g, u, destination.x, destination.y);
  assert(!u.embarked);
  assert(!u.moved);
  G.hangars.embark(g, u, carrier, h.id);
  G.confirmDeployment(g, 0);
  assert.equal(G.hangars.launchCells(g, u).length, 0);
});
test("battle recovery requires adjacency, blocks plans and nested carriers, and launches next own turn after maintenance", () => {
  const { g, carrier, u, h } = fixture();
  const hull = G.cells(carrier);
  u.x = hull[0].x - 1;
  u.y = hull[0].y;
  u.brokenParts = { leftArm: true };
  u.hp = 4321;
  u.en = 37;
  u.plan = { target: "enemy" };
  assert(!G.hangars.canEmbark(g, u, carrier, h.id));
  delete u.plan;
  assert(!G.hangars.canEmbark(g, carrier, carrier, h.id));
  G.hangars.embark(g, u, carrier, h.id);
  assert(u.acted);
  assert.equal(u.actionPoints, 0);
  assert.equal(G.hangars.launchCells(g, u).length, 0);
  G.end(g);
  G.end(g);
  const point = G.hangars.launchCells(g, u)[0];
  assert(point);
  G.hangars.launch(g, u, point.x, point.y);
  assert(u.moved);
  assert(!u.acted);
  assert.equal(u.hp, 4321 + Math.round(G.modelOf(u).hp * 0.25));
  assert.equal(u.en, Math.min(G.modelOf(u).en, 37 + G.modelOf(u).en * 0.5));
  assert(!u.brokenParts.leftArm);
  assert.equal(G.actionPoints(u), 4);
  assert(!G.canUndo(g, u));
  assert(!G.hangars.canEmbark(g, u, carrier, h.id));
  assert(G.onMap(u));
});
test("capacity rejects incompatible units and ally passengers retain their owner", () => {
  const { g, carrier, u, h } = fixture(true);
  u.ownerSeat = 2;
  g.deployment.push(false);
  G.hangars.embark(g, u, carrier, h.id);
  assert.equal(G.ownerOf(u), 2);
  const aircraftCarrier = {
    ...carrier,
    id: "aircraft-carrier",
    model: Object.keys(G.models).find((id) => id.startsWith("HimalayaClass__")),
  };
  g.units.push(aircraftCarrier);
  const other = g.units[2];
  assert(!G.hangars.canEmbark(g, other, aircraftCarrier, G.hangars.of(aircraftCarrier)[0].id));
});
test("carrier loss unloads cargo once, applies native 25% loss and never stacks passengers", () => {
  const { g, carrier, u, h } = fixture(true);
  for (const p of g.units.filter((p) => p.team === 0 && p !== carrier))
    G.hangars.embark(g, p, carrier, h.id);
  const hp = u.hp,
    shield = u.shield;
  carrier.hp = 0;
  const events = G.hangars.evacuate(g);
  assert.equal(events.length, 3);
  assert(events.every((e) => e.escaped));
  assert.equal(u.hp, hp - Math.round(G.modelOf(u).hp * 0.25));
  assert.equal(u.shield, Math.max(0, shield - Math.round(G.modelOf(u).shield.hp * 0.25)));
  assert.equal(new Set(events.map((e) => e.x + "," + e.y)).size, 3);
  assert.equal(G.hangars.evacuate(g).length, 0);
  assert.equal(u.acted, false);
  assert.equal(u.actionPoints, Math.round(G.actionBudget(u) * 0.75));
});
test("blocked emergency exits kill cargo and do not keep the defeated team alive", () => {
  const { g, carrier, u, h } = fixture(true);
  g.units = g.units.filter((p) => p === carrier || p === u || p.team === 1);
  G.hangars.embark(g, u, carrier, h.id);
  carrier.hp = 0;
  g.tiles.forEach((row) => row.fill("rock"));
  G.end(g);
  assert.equal(u.hp, 0);
  assert.equal(g.winner, 1);
  assert.equal(g.turnEffects.filter((e) => e.type === "evacuation").length, 1);
});
module.exports = { fixture };

test("a lethal combat event evacuates cargo before winner evaluation and records the exit", () => {
  const { g, carrier, u, h } = fixture(true);
  g.units = g.units.filter((p) => p === carrier || p === u || p.team === 1);
  G.hangars.embark(g, u, carrier, h.id);
  g.deployment = null;
  g.team = 1;
  const enemy = g.units.find((p) => p.team === 1);
  enemy.model = "RGM_79__beam_spray";
  enemy.x = carrier.x - 2;
  enemy.y = carrier.y;
  enemy.en = 9999;
  carrier.hp = 1;
  carrier.shield = 0;
  const original = G.modelOf(enemy).weapons[0],
    weapon = { ...original, hit: 100000 };
  const events = G.fight(g, enemy, carrier, weapon, "defend");
  assert.equal(carrier.hp, 0);
  assert(u.hp > 0);
  assert(!u.embarked);
  assert.equal(g.winner, null);
  assert.equal(events.flatMap((e) => e.evacuations || []).length, 1);
  assert(events[0].evacuations[0].escaped);
});

test("launch uses passenger movement, terrain costs and blocked paths rather than a one-cell radius", () => {
  const { g, carrier, u, h } = fixture();
  // Transport behavior is tested independently of randomized pilot mobility.
  for (const unit of g.units)
    unit.pilot = {
      ...unit.pilot,
      stats: Object.fromEntries(Object.keys(G.pilots.labels).map((key) => [key, 100])),
    };
  G.hangars.embark(g, u, carrier, h.id);
  G.end(g);
  G.end(g);
  const hull = G.cells(carrier),
    left = Math.min(...hull.map((p) => p.x)),
    y = hull[0].y;
  const range = Math.floor(G.modelOf(u, g).move);
  assert(range > 1);
  const far = { x: left - range, y };
  assert(G.hangars.launchCells(g, u).some((p) => p.x === far.x && p.y === far.y));
  assert(!G.hangars.launchCells(g, u).some((p) => p.x === far.x - 1 && p.y === far.y));
  // A rock wall must not be bypassed by distance-only launch checks.
  for (const row of g.tiles) row[left - 2] = "rock";
  assert(!G.hangars.launchCells(g, u).some((p) => p.x === far.x && p.y === far.y));
  assert.throws(() => G.hangars.launch(g, u, far.x, far.y));
  assert(u.embarked);
  g.tiles.forEach((row) => row.fill("plain"));
  G.hangars.launch(g, u, far.x, far.y);
  assert.equal(u.x, far.x);
  assert(u.moved && !u.acted);
});

test("manual deployment boarding also requires an adjacent carrier", () => {
  const { g, carrier, u, h } = fixture(true);
  u.x = G.mapWidth(g) - 1;
  u.y = G.mapHeight(g) - 1;
  assert(!G.hangars.canEmbark(g, u, carrier, h.id));
  assert.throws(() => G.hangars.embark(g, u, carrier, h.id));
});

test("launch locks the carrier undo and reduces passenger AP by 25 percent without ending its action", () => {
  const { g, carrier, u, h } = fixture();
  G.hangars.embark(g, u, carrier, h.id);
  G.end(g);
  G.end(g);
  carrier.moved = true;
  carrier.origin = { x: carrier.x, y: carrier.y, angle: carrier.angle };
  assert(G.canUndo(g, carrier));
  u.actionPoints = 8;
  const point = G.hangars.launchCells(g, u)[0];
  G.hangars.launch(g, u, point.x, point.y);
  assert.equal(G.actionPoints(u), 6);
  assert(!u.acted);
  assert(!G.canUndo(g, carrier));
  assert.throws(() => G.undo(g, carrier));
  assert.equal(carrier.origin, null);
  carrier.origin = { x: carrier.x, y: carrier.y, angle: carrier.angle };
  assert(!G.canUndo(g, carrier));
  G.end(g);
  G.end(g);
  assert.equal(G.actionPoints(u), G.actionBudget(u));
});

test("cargo maintenance restores capped resources and two distinct seeded parts only on own turn", () => {
  const { g, carrier, u, h } = fixture();
  u.embarked = { carrierId: carrier.id, hangarId: h.id };
  const m = G.modelOf(u);
  u.hp = m.hp * 0.1;
  u.en = 0;
  u.brokenParts = { head: true, backpack: true, leftArm: true, rightArm: true };
  const copy = structuredClone(g);
  G.end(g);
  assert.equal(u.hp, m.hp * 0.1);
  assert.equal(Object.keys(u.brokenParts).length, 4);
  G.end(g);
  assert.equal(u.hp, m.hp * 0.1 + Math.round(m.hp * 0.25));
  assert.equal(u.en, m.en * 0.5);
  assert.equal(Object.keys(u.brokenParts).length, 2);
  G.end(copy);
  G.end(copy);
  assert.deepEqual(copy.units.find((x) => x.id === u.id).brokenParts, u.brokenParts);
  u.hp = m.hp - 1;
  u.en = m.en - 1;
  G.end(g);
  G.end(g);
  assert.equal(u.hp, m.hp);
  assert.equal(u.en, m.en);
  assert.deepEqual(u.brokenParts, {});
  carrier.hp = 0;
  u.hp = m.hp * 0.5;
  u.en = 0;
  G.end(g);
  G.end(g);
  assert.equal(u.en, 0);
});

test("AI retreats to compatible hangars and waits for 75 percent resources and repairs", () => {
  const { g, carrier, u, h } = fixture();
  // Transport behavior is tested independently of randomized pilot mobility.
  for (const unit of g.units)
    unit.pilot = {
      ...unit.pilot,
      stats: Object.fromEntries(Object.keys(G.pilots.labels).map((key) => [key, 100])),
    };
  const m = G.modelOf(u);
  u.hp = Math.floor(m.hp * 0.2);
  u.en = 0;
  u.brokenParts = { head: true, leftArm: true };
  Object.assign(u, { x: 3, y: 8 });
  let boarded = false;
  for (let i = 0; i < 8; i++) {
    const order = G.hangars.recoveryOrder(g, u);
    assert(order);
    if (order.action === "embark") {
      G.hangars.embark(g, u, carrier, order.fields.hangarId);
      boarded = true;
      break;
    }
    if (order.action === "move") G.move(g, u, order.fields.x, order.fields.y);
    else {
      G.end(g);
      G.end(g);
    }
  }
  assert(boarded);
  assert(!G.hangars.readyToLaunch(u));
  for (let rounds = 0; rounds < 8 && !G.hangars.readyToLaunch(u); rounds++) {
    G.end(g);
    G.end(g);
  }
  assert(G.hangars.readyToLaunch(u));
  assert(u.hp >= G.modelOf(u).hp * 0.75);
  assert(u.en >= G.modelOf(u).en * 0.75);
  u.brokenParts = { leftArm: true };
  assert(!G.hangars.readyToLaunch(u));
});

test("AI formations keep support below one per three combat units and respect space restrictions", () => {
  for (const points of [6, 8, 12, 16, 32])
    for (const seed of [1, 2, 3]) {
      const entries = G.randomFormation(
        seed,
        99999,
        { environment: "space", unitCostLimit: 99999 },
        points,
      );
      assert.doesNotThrow(() => G.validateFormation(entries, 99999, points));
      const models = entries.map((e) => G.models[e.unitId + "__" + e.kitId]);
      const supports = models.filter(
        (m) =>
          m.supplyAura ||
          m.unitTags?.includes("Support") ||
          m.skills?.some((s) => ["repair", "resupply"].includes(s.type)),
      );
      assert(supports.length * 3 <= models.length - supports.length);
      assert(
        models.every(
          (m) => !m.unitTags?.includes("Infantry") || (m.adaptability.space ?? 100) >= 100,
        ),
      );
    }
  const banned = G.randomFormation(1, 4500, { bannedTypes: ["Ship"], unitCostLimit: 1500 }, 8);
  assert(banned.every((e) => !G.models[e.unitId + "__" + e.kitId].ship));
});

test("AI sometimes preloads existing squad entries with valid capacity and deterministic seeds", () => {
  let loaded = 0,
    independent = 0;
  for (let seed = 1; seed <= 24; seed++) {
    const restrictions = { environment: "space", unitCostLimit: 99999 };
    const entries = G.randomFormation(seed, 99999, restrictions, 32);
    assert.deepEqual(entries, G.randomFormation(seed, 99999, restrictions, 32));
    assert(entries.length > 0);
    assert.doesNotThrow(() => G.validateFormation(entries, 99999, 32));
    for (const e of entries) {
      if (e.preload) loaded++;
      else independent++;
    }
    const plain = entries.map(({ preload, ...e }) => e);
    const cost = (rows) =>
      rows.reduce((sum, e) => sum + G.models[e.unitId + "__" + e.kitId].cost, 0);
    assert.equal(cost(entries), cost(plain));
  }
  assert(loaded > 0);
  assert(independent > loaded);
});

test("AI holds passengers until contact and boards nearby carriers for long journeys", () => {
  const { g, carrier, u, h } = fixture();
  const enemy = g.units.find((x) => x.team !== u.team);
  Object.assign(enemy, { x: g.tiles[0].length - 2, y: 8 });
  u.hp = G.modelOf(u).hp;
  u.en = G.modelOf(u).en;
  const order = G.hangars.recoveryOrder(g, u);
  assert.equal(order?.action, "embark");
  G.hangars.embark(g, u, carrier, order.fields.hangarId);
  assert.equal(G.hangars.shouldLaunch(g, u), false);
  Object.assign(enemy, { x: carrier.x + 6, y: carrier.y });
  assert.equal(G.hangars.shouldLaunch(g, u), true);
  u.hp = G.modelOf(u).hp * 0.5;
  assert.equal(G.hangars.shouldLaunch(g, u), false);
  u.hp = G.modelOf(u).hp;
  delete u.embarked;
  u.acted = false;
  u.moved = false;
  assert.equal(G.hangars.recoveryOrder(g, u), null);
});

test("AI launches toward enemies using passenger movement and leaves a legal attack", () => {
  const { g, carrier, u, h } = fixture();
  u.embarked = { carrierId: carrier.id, hangarId: h.id, boardRound: null };
  const enemy = g.units.find((e) => e.team !== u.team);
  const hull = G.cells(carrier);
  Object.assign(enemy, { x: Math.max(...hull.map((c) => c.x)) + 6, y: carrier.y + 2 });
  const choices = G.hangars.launchCells(g, u);
  const chosen = G.aiLaunchChoice(g, u);
  assert.ok(chosen);
  assert.ok(choices.some((c) => c.x === chosen.x && c.y === chosen.y));
  assert.ok(G.dist({ ...u, ...chosen }, enemy) < G.dist({ ...u, ...choices[0] }, enemy));
  assert.ok(chosen.distance > 1);
  assert.equal(chosen.target, enemy.id);
  G.hangars.launch(g, u, chosen.x, chosen.y);
  const w = G.modelOf(u).weapons.find((w) => w.id === chosen.weapon);
  assert.ok(G.canAttack(g, u, enemy, w));
  assert.ok(G.actionCost(w) <= G.actionPoints(u));
  assert.equal(u.acted, false);
});

test("AI launch keeps recovery and contact requirements", () => {
  const { g, carrier, u, h } = fixture();
  u.embarked = { carrierId: carrier.id, hangarId: h.id, boardRound: null };
  u.hp = 1;
  assert.equal(G.aiLaunchChoice(g, u), null);
  u.hp = G.modelOf(u).hp;
  g.units.find((e) => e.team !== u.team).x = G.mapWidth(g) - 1;
  assert.equal(G.aiLaunchChoice(g, u), null);
});

for (const deployment of [true, false])
  test(`launch preview is inert until confirmation, cancel restores cargo (${deployment})`, () => {
    const { g, carrier, u, h } = fixture(true);
    G.hangars.embark(g, u, carrier, h.id);
    if (!deployment) {
      g.deployment = null;
      u.acted = false;
      u.actionPoints = 5;
      delete u.lastBoardRound;
    }
    const destination = G.hangars.launchCells(g, u)[0];
    assert(destination);
    const before = JSON.stringify(u),
      carrierBefore = JSON.stringify(carrier);
    G.hangars.previewLaunch(g, u, destination.x, destination.y);
    assert(u.embarked);
    assert.equal(G.onMap(u), false);
    const staged = { ...u };
    delete staged.pendingMove;
    assert.equal(JSON.stringify(staged), before);
    assert.equal(JSON.stringify(carrier), carrierBefore);
    G.cancelMove(g, u);
    assert.equal(JSON.stringify(u), before);
    G.hangars.previewLaunch(g, u, destination.x, destination.y);
    const expectedAngle = u.pendingMove.angle;
    const path = G.confirmMove(g, u);
    assert.equal(u.angle, expectedAngle);
    assert(path.length);
    assert(!u.embarked);
    assert(G.onMap(u));
    assert.equal(u.x, destination.x);
    assert.equal(u.y, destination.y);
    if (!deployment) {
      assert.equal(u.actionPoints, 4);
      assert.equal(carrier.lastCargoLaunchRound, g.round);
    }
    assert.throws(() => G.confirmMove(g, u));
  });

function nestedFixture(platform = "Type74") {
  const f = fixture();
  const {g,carrier,u}=f;
  u.model = Object.keys(G.models).find(id=>id.startsWith(platform+"__"));
  u.pilot = undefined;
  Object.assign(u,{hp:G.modelOf(u).hp,en:G.modelOf(u).en});
  const passenger=g.units[2];
  if(platform==="Type74") {
    passenger.model=Object.keys(G.models).find(id=>id.startsWith("Army_Squad_EFSF_0079_N_G_A__"));
    passenger.pilot=undefined;
    Object.assign(passenger,{hp:G.modelOf(passenger).hp,en:G.modelOf(passenger).en});
  }
  Object.assign(passenger,{x:u.x-1,y:u.y});
  const inner=G.hangars.of(u)[0];
  G.hangars.embark(g,passenger,u,inner.id);
  return {...f,passenger,inner};
}
test("loaded APC boards a ship, retains cargo and only occupies its own transport points",()=>{
  const {g,carrier,u,h,passenger,inner}=nestedFixture();
  assert(G.hangars.canEmbark(g,u,carrier,h.id));
  G.hangars.embark(g,u,carrier,h.id);
  assert.equal(G.hangars.used(g,carrier,h.id),1);
  assert.equal(G.hangars.used(g,u,inner.id),1);
  assert.equal(passenger.embarked.carrierId,u.id);
  assert(!G.onMap(passenger));
  assert.equal(G.hangars.launchCells(g,passenger).length,0);
  carrier.x+=2;G.hangars.sync(g);
  assert.equal(passenger.x,carrier.x);
  assert(!G.hangars.canEmbark(g,carrier,u,inner.id));
  G.end(g);G.end(g);
  const point=G.hangars.launchCells(g,u)[0];
  assert(point);
  G.hangars.launch(g,u,point.x,point.y);
  assert.equal(passenger.embarked.carrierId,u.id);
  assert.equal(passenger.x,u.x);
  assert(G.hangars.launchCells(g,passenger).length>0);
});
test("nested SFS riders are hidden while the platform is inside a ship and restored on launch",()=>{
  const {g,carrier,u,h,passenger}=nestedFixture("FF_X7Bst");
  assert(G.onMap(passenger));
  G.hangars.embark(g,u,carrier,h.id);
  assert(!G.onMap(passenger));
  assert(!passenger.embarked.exposed);
  G.end(g);G.end(g);
  const point=G.hangars.launchCells(g,u)[0];
  assert(point);
  G.hangars.launch(g,u,point.x,point.y);
  assert(G.onMap(passenger));
  assert.equal(passenger.x,u.x);
});
test("nested evacuation resolves parents first regardless of unit array order",()=>{
  for(const destroyAPC of [false,true]) {
    const {g,carrier,u,h,passenger}=nestedFixture();
    G.hangars.embark(g,u,carrier,h.id);
    carrier.x+=3;G.hangars.sync(g);
    if(destroyAPC) u.hp=1;
    carrier.hp=0;
    g.units.reverse();
    const events=G.hangars.evacuate(g);
    assert(events.some(e=>e.unitId===u.id));
    if(destroyAPC) {
      assert.equal(u.hp,0);
      assert(events.some(e=>e.unitId===passenger.id));
      assert(!passenger.embarked);
    } else {
      assert(u.hp>0);
      assert.equal(passenger.embarked.carrierId,u.id);
      assert.equal(passenger.x,u.x);
      assert.equal(events.length,1);
    }
  }
});
test("Gogg chest diffusion beams retain beam payload and localized confirmed names",()=>{
  const p=G.catalog.prefabs.find(p=>p.id==="MSM_03");
  for(const id of ["ZN_MSM_03_ChestBeam","ZN_MSM_03_ChestBeam_L"]) {
    const w=p.weapons[id];
    assert.equal(w.name,"胸部光束扩散炮");
    assert.equal(w.type,"beam");
    assert(w.damageComponents.beam>0);
    assert.equal(w.localization.en.name,"Chest Diffusion Beam Cannon");
  }
  assert.equal(p.weapons.ZN_MSM_03_SMS.type,"shell");
});
