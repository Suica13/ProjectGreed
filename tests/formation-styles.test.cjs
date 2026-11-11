const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const E = require("../shared/economy");
const B = require("../shared/battle-economy");
const { createRoomEngine } = require("../shared/room-engine");

test("starter transports carry three Zannys and three default Zaku Fs, with five complete sets", () => {
  const formation = E.starterFormation(),
    stock = E.initial();
  assert.deepEqual(
    formation.map((e) => e.unitId),
    ["Medea", "RFF_06", "RFF_06", "RFF_06", "FatUncle", "MS_06F", "MS_06F", "MS_06F"],
  );
  assert.deepEqual(stock.inventory, { Medea: 5, RFF_06: 15, FatUncle: 5, MS_06F: 15 });
  assert.equal(G.formationPoints(formation), 14);
  const plan = G.planFormation(formation, 1500, { requiresCarriers: true }, 18);
  assert.equal(plan.disabled.length, 0);
  assert.equal(plan.totalCost, 1100);
  assert.deepEqual(
    E.validate({ money: 17, supplies: 23, licenses: {}, inventory: { Type61: 2 } }).inventory,
    { Type61: 2 },
  );
});

test("only quick free formations restore independent deployment and single-unit caps", () => {
  const entry = [{ unitId: "Type61", kitId: "standard" }];
  for (const mode of ["regular", "quick", "battlefield", "sweep"]) {
    const s = { ...G.defaultRoomSettings(), mode, formationStyle: "free" };
    const rules = G.armyRestrictions(s, {
      seat: 0,
      licenses: { Type61: true },
      inventory: { Type61: 1 },
    });
    assert.equal(G.formationStyle(s), mode === "quick" ? "free" : "standard");
    assert.equal(rules.unitCostLimit, mode === "quick" ? 250 : Infinity);
    const plan = G.planFormation(entry, 1500, rules, 18);
    assert.equal(plan.disabled.length, mode === "quick" ? 0 : 1);
  }
});

test("authoritative settings force standard outside quick, and free quick deploys a standalone tank", (t) => {
  let serial = 0;
  const errors = [];
  const engine = createRoomEngine({
    rules: G,
    randomId: () => String(++serial),
    randomToken: () => String(++serial),
    randomSeed: () => 7319,
    send: (_, m) => {
      if (m.type === "error") errors.push(m);
    },
    aiDelayMs: 999999,
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, {
    mode: "create",
    room: "STYLES",
    roomMode: "quick",
    characterFaction: "PMC",
    licenses: { Type61: true },
  });
  const room = engine.rooms.get("STYLES");
  const act = (action, fields = {}) =>
    engine.action(ws, {
      id: "req-" + ++serial,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  act("configure_room", { ...room.settings, battleMode: "regular", formationStyle: "free" });
  assert.equal(room.settings.formationStyle, "standard");
  act("configure_room", {
    ...room.settings,
    battleMode: "quick",
    formationStyle: "free",
    unitCostLimit: 100,
  });
  assert.equal(room.settings.formationStyle, "free");
  act("add_ai", { seat: 1 });
  act("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] });
  act("confirm_formation");
  assert.equal(room.phase, "deployment");
  assert.equal(room.game.units.filter((u) => G.ownerOf(u) === 0).length, 1);
  assert.deepEqual(errors, []);
});

test("standard and quick rewards use new endpoints and 25-point final rounding", () => {
  assert.deepEqual(B.calculateBattleReward(1500), { money: 2000, supplies: 3000, technology: 500 });
  assert.deepEqual(B.calculateBattleReward(20000), {
    money: 10000,
    supplies: 15000,
    technology: 1000,
  });
  assert.equal(B.calculateBattleReward(1999).money, 2000);
  assert.equal(B.technologyReward(true, "quick"), 50);
  assert.equal(B.roundReward(112.5), 125);
});
