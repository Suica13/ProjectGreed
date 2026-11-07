const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../shared/rules");
const C = require("../shared/campaign");
const Records = require("../shared/match-records");
const { createCampaignRoom } = require("../shared/campaign-room");
const { createAttackPlanner } = require("../shared/attack-plans");

test("campaign restoration accepts every configured hidden form and weapon kit", () => {
  let checked = 0;
  for (const prefab of G.catalog.prefabs.filter(prefab => prefab.formOnly)) {
    for (const kit of prefab.weaponKits) {
      const entry = { unitId: prefab.id, kitId: kit.id };
      assert(G.models[prefab.id + "__" + kit.id], "missing hidden model: " + prefab.id + "/" + kit.id);
      assert.doesNotThrow(() => G.validateFormation([entry], Infinity, Infinity, true),
        "campaign restoration must accept " + prefab.id + "/" + kit.id);
      assert.throws(() => G.validateFormation([entry], Infinity, Infinity),
        "ordinary formations must still reject " + prefab.id + "/" + kit.id);
      checked++;
    }
  }
  assert(checked > 0);
});

test("New York restores deployed carriers and their passengers without dropping the attacking team", () => {
  const members = [{ id: "host", seat: 0 }, { id: "enemy", seat: 1, bot: true }];
  const ctx = {
    G, world: G.catalog.scenarios.earth_0079_mid.world,
    production: require("../shared/production-data.cjs"),
    development: require("../shared/development"),
    validateBattle: save => Records.validateSave(G, save),
  };
  const state = C.create(ctx, members);
  state.units = [];
  const carrier = C.addUnit(ctx, state, 0, "new_york", "Medea_DeployState", "standard");
  carrier.entryFrom = "america";
  carrier.state = { id: "saved-carrier", hp: 10000, en: 250 };
  for (let i = 0; i < 3; i++) {
    const passenger = C.addUnit(ctx, state, 0, "new_york", "RGM_79_G", "machine_gun");
    passenger.entryFrom = "america";
    passenger.state = {
      id: "saved-passenger-" + i, hp: 10000, en: 200,
      embarked: { carrierId: "saved-carrier", hangarId: "Hangar_1", boardRound: 1 },
    };
  }
  C.addUnit(ctx, state, 1, "new_york", "MS_06F");
  state.phase = "encounters";
  state.encounters = [{ region: "new_york", turn: 0, battleSave: null, roster: {}, settled: [] }];
  let serial = 0;
  const room = {
    hostId: "host", campaign: state, seats: [...members, ...Array(8).fill(null)],
    settings: { mode: "campaign" }, started: false, phase: "waiting", chat: [],
  };
  const adapter = createCampaignRoom({
    G, Records, randomId: () => String(++serial), randomSeed: () => 1,
    members: () => members, planner: createAttackPlanner(G, () => String(++serial)),
    log: () => {},
  });
  const prep = adapter.view(room).preparation;
  adapter.handle(room, members[0], {
    action: "campaign_enter", region: prep.region, mapId: prep.mapId,
    preparationId: prep.id, delegate: false,
  });
  assert.equal(room.started, true);
  assert.equal(room.game.units.length, 5);
  const restored = room.game.units.find(unit => unit.id === "saved-carrier");
  assert.equal(G.modelOf(restored).prefabId, "Medea_DeployState");
  assert.equal(restored.hp, 10000);
  assert.equal(restored.en, 250);
  for (let i = 0; i < 3; i++) {
    const passenger = room.game.units.find(unit => unit.id === "saved-passenger-" + i);
    assert.equal(passenger.hp, 10000);
    assert.equal(passenger.en, 200);
    assert.equal(passenger.embarked.carrierId, restored.id);
    assert.equal(passenger.embarked.hangarId, "Hangar_1");
  }
  adapter.checkpoint(room);
  Records.validateSave(G, room.campaign.encounters[0].battleSave);
});

test("restoring a campaign form does not allow players to buy or deploy form-only units", () => {
  const entries = [{ unitId: "Medea_DeployState", kitId: "standard" }];
  assert.throws(() => G.validateFormation(entries, 99999, 72), /不可用/);
  assert.throws(() => G.create(false, 1, [entries, []], false, { mode: "campaign" }), /不可用/);
  assert.throws(() => G.create(false, 1, [entries, []], false, { mode: "regular" }, { allowExistingForms: true }), /不可用/);
});
