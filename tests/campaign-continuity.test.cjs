const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  C = require("../shared/campaign.js"),
  Records = require("../shared/match-records.js");
const { createCampaignRoom } = require("../shared/campaign-room.js");
const { createAttackPlanner } = require("../shared/attack-plans.js");
const ctx = {
  G,
  world: require("../shared/campaign-world.json"),
  production: require("../shared/production-data.cjs"),
  development: require("../shared/development.js"),
  validateBattle: (save) => Records.validateSave(G, save),
};
function fixture(ids = ["Gunperry", "RGM_79", "MS_06F"]) {
  let serial = 0;
  const members = [
    { id: "host", seat: 0 },
    { id: "guest", seat: 1 },
  ];
  const state = C.create(ctx, members);
  state.units = [];
  ids.forEach((id, index) => C.addUnit(ctx, state, index === ids.length - 1 ? 1 : 0, "canada", id));
  state.phase = "encounters";
  state.encounters = [{ region: "canada", turn: 0, battleSave: null, roster: {}, settled: [] }];
  const planner = createAttackPlanner(G, () => "plan-" + ++serial);
  const room = {
    hostId: "host",
    campaign: state,
    seats: members,
    settings: { mode: "campaign" },
    started: false,
    phase: "waiting",
    chat: [],
  };
  const adapter = createCampaignRoom({
    G,
    Records,
    randomId: () => "battle-" + ++serial,
    randomSeed: () => 13,
    members: () => members,
    planner,
    log: (room, text) => room.log.unshift(text),
  });
  function enter() {
    const preparation = adapter.view(room).preparation;
    for (const member of members)
      adapter.handle(room, member, {
        action: "campaign_enter",
        region: preparation.region,
        preparationId: preparation.id,
        mapId: "frontier_1v1",
        delegate: false,
      });
  }
  enter();
  return { room, adapter, members, enter };
}

test("regional re-entry preserves the full battlefield and every actor, including cargo and map effects", () => {
  const { room, adapter, enter } = fixture();
  room.game.round = 7;
  room.game.team = 1;
  const carrier = room.game.units.find((unit) => G.modelOf(unit).prefabId === "Gunperry");
  const passenger = room.game.units.find((unit) => G.modelOf(unit).prefabId === "RGM_79");
  carrier.angle = 123;
  passenger.embarked = {
    carrierId: carrier.id,
    hangarId: G.hangars.of(carrier)[0].id,
    boardRound: 3,
  };
  for (const [index, actor] of room.game.units.entries()) {
    actor.hp -= 100 * (index + 1);
    actor.en -= 10 * (index + 1);
    actor.shield = Math.max(0, actor.shield - 25);
    actor.actionPoints = 3.5;
    actor.weaponUses = { [G.modelOf(actor).weapons[0].id]: 2 };
    actor.skillReadyRound = { EXAM: 11 };
    actor.skillUses = { test: 1 };
    actor.brokenParts = { armL: true };
    actor.burning = { expiresRound: 10, lastDamageRound: 5 };
    actor.apPenaltyNextTurn = 0.25;
    actor.moduleHp = { left: 100 };
    actor.pilot.experience = 1234;
  }
  G.hangars.sync(room.game);
  room.game.smokeFields = [{ x: carrier.x, y: carrier.y, radius: 2, expiresRound: 9 }];
  room.game.beamDiffusionFields = [{ x: carrier.x, y: carrier.y, radius: 4, expiresRound: 11 }];
  room.game.visionAreas = [{ team: 0, x: carrier.x, y: carrier.y, radius: 3, expiresRound: 9 }];
  const expected = Records.clone(room.game);
  const oldLog = [...room.log];
  adapter.checkpoint(room);
  const encounter = room.campaign.encounters[0];
  assert.deepEqual(encounter.battleSave.game, expected);
  for (const actor of expected.units)
    assert.deepEqual(room.campaign.units.find((unit) => unit.id === actor.campaignId).state, actor);
  C.validate(ctx, room.campaign, room.seats);
  room.campaign.phase = "encounters";
  enter();
  assert.deepEqual(
    room.game,
    expected,
    "no unit, field, RNG stream or turn state is rebuilt for a continuing battlefield",
  );
  assert.deepEqual(room.log.slice(1), oldLog);
  assert.equal(room.campaignBattle.stopRound, expected.round + room.campaign.rounds * 2);
});

test("mid-battle campaign export retains escaped units and completed player actions through import", () => {
  const { room, adapter, members, enter } = fixture(["RGM_79", "RGM_79", "MS_06F"]);
  const removed = room.game.units.shift();
  const spawned = {
    ...Records.clone(removed),
    id: removed.id + "-escape-1",
    hp: 1000,
    en: 100,
    x: removed.x + 1,
    angle: 78,
  };
  delete spawned.campaignId;
  room.game.units.push(spawned);
  room.turnDone = [true, false];
  const exported = adapter.handle(room, members[0], { action: "campaign_export" }).save;
  const savedBattle = exported.encounters[0].battleSave;
  assert.equal(exported.units.find((unit) => unit.id === removed.campaignId).destroyed, true);
  assert(savedBattle.game.units.find((unit) => unit.id === spawned.id).campaignId);
  assert.equal(
    room.campaign.units.length,
    3,
    "export must not mutate the running strategic ledger",
  );
  room.campaign = C.validate(ctx, exported, members);
  room.started = false;
  room.campaignBattle = null;
  enter();
  assert.deepEqual(room.game, savedBattle.game);
  assert.deepEqual(room.turnDone, [true, false]);
  assert.equal(room.campaignBattle.stopRound, 21, "resume the original remaining segment rounds");
});

test("a sniper becoming ready at a segment boundary survives save validation and queues once on re-entry", () => {
  const { room, adapter, enter } = fixture(["RGM_79SC", "RGM_79", "MS_06F"]);
  const actor = room.game.units[0],
    target = room.game.units.at(-1);
  const shot = {
    target: target.id,
    weapon: G.modelOf(actor).weapons[0].id,
    aimCell: { x: target.x, y: target.y },
  };
  actor.readySnipe = Records.clone(shot);
  actor.plan = { ...shot, charged: true };
  actor.actionPoints = 0;
  adapter.checkpoint(room);
  assert.equal(room.campaign.encounters[0].battleSave.game.units[0].plan, null);
  C.validate(ctx, room.campaign, room.seats);
  room.campaign.phase = "encounters";
  enter();
  assert.equal(room.game.units[0].readySnipe, undefined);
  assert.equal(room.plans.length, 1);
  assert.equal(room.plans[0].weapon, shot.weapon);
  assert.equal(room.plans[0].target, target.id);
  assert.equal(room.plans[0].charged, true);
  assert.equal(room.game.units[0].actionPoints, 0);
});
