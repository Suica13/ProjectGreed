const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  C = require("../shared/campaign.js"),
  P = G.pilots;
const crews = require("../shared/campaign-pilots.js");
const ctx = {
  G,
  world: require("../assets/maps/strategy/earth_0079_mid/world.json"),
  production: require("../shared/production-data.cjs"),
  development: require("../shared/development.js"),
};
const members = [0, 1, 2, 3].map((seat) => ({ seat }));
function fixture() {
  const state = C.create(ctx, members);
  const act = (seat, action, fields = {}) =>
    C.action(ctx, state, members, seat, {
      action: "campaign_pilot_" + action,
      turn: state.turn,
      ...fields,
    });
  return { state, act };
}

test("campaign rebirth validates ownership and charges the treasury once before resetting progression", () => {
  const {state,act}=fixture();
  act(0,"recruit",{name:"Rebirth"});
  const entry=state.pilots[0];
  entry.profile=G.pilots.custom({...entry.profile,level:8,experience:30000});
  const before=structuredClone(entry.profile);
  state.teams[0].money=79999;
  assert.throws(()=>act(0,"reincarnate",{pilotId:entry.profile.id}),/资金/);
  assert.deepEqual(entry.profile,before);
  state.teams[0].money=100000;
  assert.throws(()=>act(1,"reincarnate",{pilotId:entry.profile.id}));
  act(0,"reincarnate",{pilotId:entry.profile.id});
  assert.equal(state.teams[0].money,20000);
  assert.equal(entry.profile.level,0);
  assert.equal(entry.profile.reincarnations,1);
  assert.equal(entry.profile.points,80);
  assert.throws(()=>act(0,"reincarnate",{pilotId:entry.profile.id}));
  assert.equal(state.teams[0].money,20000);
});
test("campaign recruitment charges the shared treasury and rejects forged stats, duplicate assignment and enemy control", () => {
  const { state, act } = fixture(),
    before = state.teams[0].money;
  act(2, "recruit", {
    name: "独立驾驶员",
    level: 10,
    experience: 999999,
    stats: { shooting: 999 },
  });
  const p = state.pilots[0].profile;
  assert.equal(state.teams[0].money, before - 1000);
  assert.equal(p.level, 0);
  assert.equal(p.experience, 0);
  assert.equal(p.points, 80);
  assert.equal(p.stats.shooting, 100);
  const first = C.addUnit(ctx, state, 2, "jaburo", "RGM_79"),
    second = C.addUnit(ctx, state, 2, "jaburo", "Type61");
  act(2, "assign", { armyId: first.id, pilotId: p.id });
  const firstLabel = G.models[first.unitId + "__" + first.kitId].name + `[No.${first.id.slice(5)}]`;
  assert(state.history.at(-1).includes(`配属驾驶员：${p.name} → ${firstLabel}`));
  assert.equal(C.view(state).units.find((u) => u.id === first.id).pilotName, p.name);
  assert.throws(() => act(2, "assign", { armyId: second.id, pilotId: p.id }), /已配属/);
  assert.throws(() => act(1, "train", { pilotId: p.id, stat: "shooting", amount: 5 }), /无权/);
  act(0, "train", { pilotId: p.id, stat: "shooting", amount: 5 }); // Team commander manages teammate crews.
  assert.equal(state.pilots[0].profile.stats.shooting, 105);
  assert.equal(state.pilots[0].profile.points, 75);
  first.moveTo = "andes";
  assert.throws(() => act(2, "assign", { armyId: first.id, pilotId: null }), /调动/);
  first.moveTo = null;
  act(2, "assign", { armyId: first.id, pilotId: null });
  assert(state.history.at(-1).includes(`取消配属：${p.name} ← ${firstLabel}`));
  act(2, "assign", { armyId: second.id, pilotId: p.id });
  assert.equal(second.pilotId, p.id);
  state.teams[0].money = 0;
  const snapshot = structuredClone(state);
  assert.throws(() => act(2, "recruit", { name: "没钱" }), /资源不足/);
  assert.deepEqual(state, snapshot);
});
test("campaign promotions retain cumulative XP, demotions/reset refund training and clear skills", () => {
  const { state, act } = fixture();
  act(0, "recruit", { name: "升职测试" });
  const entry = state.pilots[0],
    id = entry.profile.id;
  entry.profile = P.gainExperience(entry.profile, 100000);
  state.teams[0].money = 1000000;
  let funds = state.teams[0].money;
  for (let level = 0; level < 6; level++) {
    funds -= P.upgradeCost(entry.profile);
    act(0, "upgrade", { pilotId: id });
    assert.equal(entry.profile.level, level + 1);
    assert.equal(entry.profile.experience, 100000);
    assert.equal(state.teams[0].money, funds);
  }
  act(0, "skill", { pilotId: id, skillId: P.skillChoices[0].id });
  act(0, "train", { pilotId: id, stat: "speed", amount: 5 });
  act(0, "reset", { pilotId: id });
  assert.equal(entry.profile.selectedSkillId, undefined);
  assert.equal(entry.profile.stats.speed, 100);
  assert.equal(entry.profile.points, P.trainingBudget(6));
  act(0, "demote", { pilotId: id });
  assert.equal(entry.profile.level, 5);
  assert.equal(entry.profile.experience, 100000);
  assert.equal(entry.profile.points, P.trainingBudget(5));
});
test("campaign ACE recruitment follows campaign technology and faction, and cannot bypass training restrictions", () => {
  const { state, act } = fixture();
  const node = ctx.development
    .nodes("EFSF")
    .find((n) =>
      n.unlocks.some((id) => P.aceProfile(id)?.price && P.canAssign({ aceId: id }, "EFSF")),
    );
  assert(node);
  const aceId = node.unlocks.find(
    (id) => P.aceProfile(id)?.price && P.canAssign({ aceId: id }, "EFSF"),
  );
  const profile = P.aceProfile(aceId);
  state.teams[0].money = 1000000;
  state.teams[0].supplies = 1000000;
  assert.throws(() => act(0, "recruit", { aceId }), /尚未开发/);
  state.teams[0].researched.push(node.id);
  act(0, "recruit", { aceId });
  assert.equal(state.pilots[0].profile.aceId, aceId);
  assert.equal(state.teams[0].money, 1000000 - profile.price.money);
  assert.throws(() => act(0, "recruit", { aceId }), /已招募/);
  assert.throws(() => act(1, "recruit", { aceId }), /尚未开发/);
  assert.throws(
    () => act(0, "train", { pilotId: "ace-" + aceId, stat: "shooting", amount: 5 }),
    /强化无效/,
  );
});

test("ACE assignment and removal switch special forms reversibly without repairing battle damage", () => {
  const { state, act } = fixture();
  const unit = C.addUnit(ctx, state, 0, "jaburo", "RX_79_G", "machine_gun");
  const aceId = "Pilot_EFSF_0079_N_ACE_SHR";
  state.pilots.push({ ownerSeat: 0, team: 0, profile: P.createAce(aceId) });
  const game = G.create(
    false,
    1,
    [
      [{ unitId: unit.unitId, kitId: unit.kitId }],
      [{ unitId: "MS_06F", kitId: ctx.production.defaultKits.MS_06F }],
    ],
    false,
    G.campaignRoomSettings({ mapId: "frontier_1v1" }),
  );
  unit.state = structuredClone(game.units[0]);
  unit.state.hp = Math.floor(G.modelOf(game.units[0]).hp / 2);
  unit.state.en = Math.floor(G.modelOf(game.units[0]).en / 2);
  const before = { unitId: unit.unitId, kitId: unit.kitId, hp: unit.state.hp, en: unit.state.en };
  act(0, "assign", { armyId: unit.id, pilotId: "ace-" + aceId });
  assert.equal(unit.unitId, "RX_79_G_Ez8");
  assert.deepEqual(unit.pilotBase, { unitId: "RX_79_G", kitId: "machine_gun" });
  assert.equal(unit.state.pilot.aceId, aceId);
  act(0, "assign", { armyId: unit.id, pilotId: null });
  assert.equal(unit.unitId, before.unitId);
  assert.equal(unit.kitId, before.kitId);
  assert.equal(unit.pilotBase, undefined);
  assert(unit.state.hp <= before.hp);
  assert(unit.state.en <= before.en);
});
test("crew transfers travel with army control and malformed or duplicate saved assignments are rejected", () => {
  const { state, act } = fixture();
  act(0, "recruit", { name: "随队转交" });
  const id = state.pilots[0].profile.id,
    unit = C.addUnit(ctx, state, 0, "jaburo", "RGM_79");
  act(0, "assign", { armyId: unit.id, pilotId: id });
  C.action(ctx, state, members, 0, { action: "campaign_transfer", turn: 1, ids: [unit.id], to: 2 });
  C.action(ctx, state, members, 2, {
    action: "campaign_accept_transfer",
    turn: 1,
    transferId: state.transfers[0].id,
    accept: true,
  });
  assert.equal(state.pilots[0].ownerSeat, 2);
  const clean = C.validate(ctx, state, members);
  assert.deepEqual(clean.pilots, state.pilots);
  const duplicate = structuredClone(state);
  duplicate.units.find((other) => other.id !== unit.id && other.team === 0).pilotId = id;
  assert.throws(() => C.validate(ctx, duplicate, members), /配属无效或重复/);
  const forged = structuredClone(state);
  forged.pilots[0].profile.stats.shooting = 999;
  assert.throws(() => C.validate(ctx, forged, members), /属性|上限|强化/);
  const old = structuredClone(state);
  delete old.pilots;
  unit.pilotId = null;
  for (const u of old.units) delete u.pilotId;
  assert.deepEqual(C.validate(ctx, old, members).pilots, []);
});
test("escaping crews bind to the live successor and dead crews become available without losing records", () => {
  const { state, act } = fixture();
  act(0, "recruit", { name: "脱出驾驶员" });
  const entry = state.pilots[0],
    first = C.addUnit(ctx, state, 0, "jaburo", "RGM_79"),
    successor = C.addUnit(ctx, state, 0, "jaburo", "RGM_79");
  first.pilotId = entry.profile.id;
  first.destroyed = true;
  const profile = P.battleResult(entry.profile, "kill", 200, 200);
  crews.capture(state, {
    units: [
      { team: 0, hp: 0, campaignId: first.id, pilot: profile },
      { team: 0, hp: 100, campaignId: successor.id, pilot: profile },
    ],
  });
  assert.equal(first.pilotId, null);
  assert.equal(successor.pilotId, profile.id);
  assert.equal(entry.profile.experience, 200);
  assert.equal(entry.profile.record.kills, 1);
  successor.destroyed = true;
  crews.capture(state, {
    units: [
      { team: 0, hp: 0, campaignId: successor.id, pilot: P.battleResult(profile, "loss", 200, 0) },
    ],
  });
  assert.equal(successor.pilotId, null);
  assert.equal(entry.profile.record.losses, 1);
});

test("authoritative campaign combat earns crew XP while ordinary saved battles still earn nothing", (t) => {
  const { createRoomEngine } = require("../shared/room-engine.js");
  let serial = 0;
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "id-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => 1,
    send: () => {},
  });
  t.after(() => engine.close());
  for (const strategic of [false, true]) {
    const host = { readyState: 1 },
      guest = { readyState: 1 },
      code = strategic ? "CREW" : "SAVED";
    engine.join(host, { mode: "create", room: code, name: "attacker", characterFaction: "PMC" });
    engine.join(guest, { mode: "join", room: code, name: "defender", characterFaction: "PMC" });
    const room = engine.rooms.get(code);
    const p = P.createCustom("custom-combat-test", "战役战斗驾驶员");
    room.game = G.create(
      false,
      1,
      [
        [{ unitId: "RGM_79", kitId: "machine_gun", customPilot: p }],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ],
      false,
      { mapId: "frontier_1v1", fogMode: "disabled" },
    );
    room.started = true;
    room.startedFromSave = true;
    room.matchId = "match-" + code;
    room.activeSeats = [true, true];
    room.phase = "idle";
    room.plans = [];
    room.responses = [];
    room.reactions = [];
    room.pending = null;
    room.turnDone = [false, false];
    room.turnNotBefore = 0;
    if (strategic) {
      room.campaign = C.create(ctx, members.slice(0, 2));
      room.campaignBattle = { region: "canada", stopRound: 11, startRound: 1, delegatedSeats: [] };
    }
    const [attacker, target] = room.game.units;
    Object.assign(attacker, { x: 5, y: 5, actionPoints: 100, en: 10000 });
    Object.assign(target, { x: 7, y: 5, hp: 1, shield: 0 });
    // Deterministic accuracy fixture; no client is allowed to author either crew's attributes.
    target.pilot.stats.reaction = 0;
    room.game.tiles[5][5] = room.game.tiles[5][7] = "plain";
    const weapon = G.modelOf(attacker).weapons.find((w) =>
      G.canAttack(room.game, attacker, target, w),
    );
    assert(weapon);
    const act = (socket, action, fields = {}) =>
      engine.action(socket, {
        action,
        id: "action-" + ++serial,
        revision: room.revision,
        round: room.game.round,
        matchId: room.matchId,
        ...fields,
      });
    act(host, "attack", {
      unitId: attacker.id,
      targetId: target.id,
      weaponId: weapon.id,
      weaponIds: [weapon.id],
    });
    act(host, "end_turn");
    for (const reaction of [...room.reactions])
      act(guest, "respond", { reactionId: reaction.id, response: "defend" });
    if (room.phase === "reaction" && room.reactionReviewId)
      act(guest, "confirm_responses", { reviewId: room.reactionReviewId });
    assert.equal(target.hp, 0);
    assert.equal(attacker.pilot.record.kills, strategic ? 1 : 0);
    assert.equal(attacker.pilot.experience, strategic ? G.pilots.combatExperience(G.modelOf(attacker).cost,G.modelOf(target).cost) : 0);
    assert.equal(
      (room.pilotAwards || []).length,
      0,
      "campaign crews must never credit personal profile awards",
    );
    assert.equal((room.economyAwards || []).length, 0);
  }
});
