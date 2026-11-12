const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules"), E = require("../shared/economy");
const { createRoomEngine } = require("../shared/room-engine");

test("regular era and technology caps both apply; quick keeps its separate rules", () => {
  const ids = ["Medea", "RGM_79", "RMS_179_AEUG", "RX_93"];
  const player = { seat: 0, characterFaction: "PMC", inventory: Object.fromEntries(ids.map(id => [id, 5])) };
  const settings = { ...G.defaultRoomSettings(), mapId: null, regularEra: "0087T1" };
  const rules = G.armyRestrictions(settings, player);
  for (const id of ids.slice(0, 3)) assert.equal(G.restrictionReason(G.models[E.defaultModel(id)], rules), null, id);
  assert.equal(G.restrictionReason(G.models[E.defaultModel("RX_93")], rules), "not_allowed");
  const caps = Object.fromEntries(G.factions.map(f => [f, 0]));
  const capped = G.armyRestrictions({ ...settings, technologyCaps: caps }, player);
  assert.equal(G.restrictionReason(G.models[E.defaultModel("RX_178_AEUG")], capped), "technology_limit");
  const quick = G.armyRestrictions({ ...settings, mode: "quick" }, player);
  assert.equal(G.restrictionReason(G.models[E.defaultModel("RX_93")], quick), null);
});

test("regular room validates and publishes the era, regenerates AI and resets readiness", t => {
  let n = 0;
  const engine = createRoomEngine({ rules: G, randomId: () => String(++n), randomToken: () => String(++n),
    randomSeed: () => 7319, send: () => {}, aiDelayMs: 999999 });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, { mode: "create", room: "ERAS", roomMode: "regular", characterFaction: "PMC" });
  const room = engine.rooms.get("ERAS");
  const act = (action, fields = {}) => engine.action(ws, { id: "req-" + ++n, revision: room.revision,
    round: room.game.round, phase: room.phase, matchId: room.matchId, action, ...fields });
  assert.equal(room.settings.regularEra, "0079T1");
  assert.throws(() => act("configure_room", { ...room.settings, regularEra: "invalid" }));
  assert.equal(room.settings.regularEra, "0079T1");
  act("add_ai", { seat: 1 });
  room.seats[0].ready = true;
  room.seats[1].formation = [{ unitId: "Type61", kitId: "standard" }];
  act("configure_room", { ...room.settings, regularEra: "0087T2", technologyLimitMode: "custom", technologyLimit: 5000 });
  assert.equal(room.settings.regularEra, "0087T2");
  assert.equal(room.settings.technologyLimit, 5000);
  assert.equal(room.seats[0].ready, false);
  assert.equal(room.seats[1].formation, null);
});

test("regular AI fights with selected-era units and can carry them in earlier transports", () => {
  const settings = { ...G.defaultRoomSettings(), mapId: null, regularEra: "0087T2", costLimit: 20000, unitLimit: 36,
    technologyCaps: Object.fromEntries(G.factions.map(f => [f, 999999])) };
  const rules = { ...G.armyRestrictions(settings, { bot: true, seat: 0, characterFaction: "AEUG" }),
    aiAllowedEras: [settings.regularEra], aiEarlierCarriers: true };
  for (const seed of [1, 7319, 98765]) {
    const army = G.randomFormation(seed, settings.costLimit, rules, settings.unitLimit);
    assert(army.some(e => G.isFleetCarrier(G.formationModel(e))));
    const passengers = army.filter(e => !G.isFleetCarrier(G.formationModel(e)));
    assert(passengers.length);
    assert(passengers.every(e => G.formationModel(e).tags.includes(settings.regularEra)));
    assert.deepEqual(G.planFormation(army, settings.costLimit, rules, settings.unitLimit).reasons, {});
  }
});
