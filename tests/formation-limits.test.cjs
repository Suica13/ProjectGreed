const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  { createRoomEngine } = require("../shared/room-engine");
const carrier = () => ({ unitId: "Medea", kitId: "standard" });
const tank = (i) => ({
  unitId: "Type61",
  kitId: "standard",
  ...(i === undefined ? {} : { preload: { carrierIndex: i, hangarId: "Hangar_1" } }),
});
const rules = { requiresCarriers: true, unitCostLimit: Infinity };
test("player defaults are 1500 COST and 18 capacity, without independent hull or unit caps", () => {
  const settings = G.defaultRoomSettings();
  assert.equal(settings.costLimit, 1500);
  assert.equal(settings.unitLimit, 18);
  const human = G.armyRestrictions(settings, { seat: 0, characterFaction: "PMC" });
  assert.equal(human.unitCostLimit, Infinity);
  assert.equal(human.requiresCarriers, true);
  assert.equal(human.cargoCostLimit, undefined);
  assert.equal(human.fleetUnitCostLimit, undefined);
  assert.equal(G.armyUnitLimit(settings, { seat: 0 }), 18);
  const elite = [
    { unitId: "PegasusClass", kitId: "standard" },
    { unitId: "RGM_79", kitId: "machine_gun", preload: { carrierIndex: 0, hangarId: "Hangar_1" } },
  ];
  const plan = G.planFormation(elite, 2000, rules, 18);
  assert.equal(plan.disabled.length, 0);
  assert.equal(plan.totalCost, 1750);
});
test("carrier, passengers and pilot share the same COST and capacity budgets", () => {
  const entries = [carrier(), ...Array.from({ length: 6 }, () => tank(0))];
  const p = G.planFormation(entries, 500, rules, 18);
  assert.equal(p.totalCost, 550);
  assert.equal(p.deployCost, 500);
  assert.equal(p.reasons[6], "cost");
  assert.equal(G.formationPoints(p.deployable), 6);
  const capacity = G.planFormation(entries, 2000, rules, 3);
  assert.equal(capacity.deployable.length, 3);
  assert.equal(G.formationPoints(capacity.deployable), 3);
  assert.equal(capacity.reasons[3], "count");
});
test("unloaded units and passengers of an unavailable carrier cannot deploy independently", () => {
  assert.equal(G.planFormation([tank()], 2000, rules, 18).reasons[0], "not_embarked");
  const p = G.planFormation([carrier(), tank(0)], 2000, { ...rules, aiBannedUnits: ["Medea"] }, 18);
  assert.equal(p.reasons[0], "not_allowed");
  assert.equal(p.reasons[1], "carrier_disabled");
  assert.equal(p.deployCost, 0);
  assert.throws(
    () =>
      G.planFormation([carrier(), ...Array.from({ length: 7 }, () => tank(0))], 2000, rules, 18),
    /格纳库容量/,
  );
});
test("AI follows the room budget and retains its previous capacity and single-unit rules", () => {
  const s = G.defaultRoomSettings(),
    bot = { seat: 1, bot: true };
  assert.equal(G.armyBudget(s, bot), 1500);
  assert.equal(G.armyUnitLimit(s, bot), 36);
  assert.equal(G.armyRestrictions(s, bot).unitCostLimit, 250);
  assert.equal(G.armyRestrictions(s, bot).requiresCarriers, undefined);
  assert.equal(
    G.armyRestrictions({ ...s, mode: "campaign" }, { seat: 0 }).requiresCarriers,
    undefined,
  );
});
test("server applies combined COST and weighted capacity to readiness and deployment", (t) => {
  let n = 0;
  const messages = [];
  const e = createRoomEngine({
    rules: G,
    randomId: () => String(++n),
    randomToken: () => String(++n),
    randomSeed: () => 7319,
    send: (ws, m) => messages.push(m),
    aiDelayMs: 999999,
  });
  t.after(() => e.close());
  const ws = { readyState: 1 };
  e.join(ws, {
    mode: "create",
    room: "LIMITS",
    roomMode: "regular",
    characterFaction: "PMC",
    licenses: { Medea: true, Type61: true },
    inventory: { Medea: 5, Type61: 30 },
  });
  const r = e.rooms.get("LIMITS"),
    act = (action, data = {}) =>
      e.action(ws, {
        id: "req-" + ++n,
        revision: r.revision,
        round: r.game.round,
        phase: r.phase,
        matchId: r.matchId,
        action,
        ...data,
      });
  act("configure_room", { ...r.settings, battleMode: "regular", costLimit: 2000, unitLimit: 3 });
  act("add_ai", { seat: 1 });
  const formation = [carrier(), ...Array.from({ length: 6 }, () => tank(0))];
  act("start_game", { formation });
  assert.equal(r.phase, "assembly");
  const snapshot = messages.filter((m) => m.type === "state" && m.you?.seat === 0).at(-1),
    p = snapshot.assembly.players.find((p) => p.seat === 0);
  assert.equal(p.unitLimit, 3);
  assert.equal(p.limit, 2000);
  assert.equal(p.requiresCarriers, true);
  act("confirm_formation");
  assert.equal(r.phase, "deployment");
  const own = r.game.units.filter((u) => G.ownerOf(u) === 0);
  assert.equal(own.length, 3);
  assert.equal(own.filter((u) => u.embarked).length, 2);
});
