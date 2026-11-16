const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  E = require("../shared/battle-economy"),
  M = require("../shared/mission-mode");
const { createRoomEngine } = require("../shared/room-engine");
test("completion multipliers are separate from process awards, pilot XP and activity configuration", () => {
  const activity = Object.freeze({ money: 2, supplies: 3, technology: 4, experience: 5 });
  assert.deepEqual(E.rewardMultipliers(activity), activity);
  assert.deepEqual(E.settlementMultipliers(E.rewardMultipliers(activity)), {
    money: 2.5,
    supplies: 3.75,
    technology: 5,
    experience: 5,
  });
  assert.deepEqual(E.settlementMultipliers({ money: 0, technology: 0 }), {
    money: 0,
    supplies: 1.25,
    technology: 0,
  });
  assert.deepEqual(G.battlefieldMode.defeatReward(1000), { money: 750, supplies: 1125 });
});
for (const mode of ["regular", "quick", "battlefield", "mission"])
  test(
    mode + " settles the increased completion award once and preserves previous receipts",
    (t) => {
      let serial = 0;
      const engine = createRoomEngine({
        rules: G,
        randomId: () => "reward-" + ++serial,
        randomToken: () => "token-" + ++serial,
        randomSeed: () => 1,
        aiDelayMs: 999999,
        resultReturnMs: 999999,
        send: () => {},
      });
      t.after(() => engine.close());
      const ws = { readyState: 1 };
      engine.join(ws, {
        mode: "create",
        room: "INCREASE",
        characterFaction: "PMC",
        inventory: { Type61: 10 },
        licenses: { Type61: true },
      });
      const room = engine.rooms.get("INCREASE"),
        player = room.seats.find((p) => p && !p.bot);
      Object.assign(room.settings, {
        mode,
        costLimit: 1500,
        formationStyle: "free",
        fogMode: "disabled",
      });
      if (mode === "mission") room.settings.mapId = "mission_white_base";
      room.game = G.create(
        false,
        1,
        [[{ unitId: "Type61", kitId: "standard" }], [{ unitId: "Type61", kitId: "standard" }]],
        false,
        {...room.settings, mode:"regular", mapId:"frontier_1v1"},
      );
      room.game.mapId=room.settings.mapId;
      Object.assign(room, {
        started: true,
        phase: "finished",
        matchId: "completion-match",
        startedFromSave: false,
        replay: false,
        economyAwards: [
          {
            id: "process",
            matchId: "completion-match",
            memberId: player.id,
            kind: "kill",
            money: 100,
            supplies: 150,
          },
        ],
        techAwards: [],
        techParticipation: { [player.id]: ["hit"] },
        technologyStartPoints: { [player.id]: require("../shared/development").normalizeTechnologyPoints({}) },
        battleRoster: {},
      });
      room.game.winner = 0;
      if (mode === "mission")
        room.game.mission = { fired: [], started: true, protect: [], dialogue: null };
      for (const u of room.game.units)
        room.battleRoster[u.id] = {
          memberId: u.team === 0 ? player.id : "enemy",
          seat: u.team,
          team: u.team,
          unitId: "Type61",
          model: "Type61__standard",
          cost: 1500,
          performance: 1,
          bot: false,
          technologyFactions: ["EFSF"],
        };
      const before =
        mode === "mission"
          ? M.reward(room, G)
          : mode === "battlefield"
            ? G.battlefieldMode.baseReward(room.settings, 0)
            : E.calculateBattleReward(1500);
      const expectedTech =
        mode === "mission"
          ? M.technologyReward(room, G)
          : mode === "battlefield"
            ? G.battlefieldMode.technologyReward(room.settings, 0, true, 1.25)
            : E.technologyReward(true, mode, 1.25, 1500);
      const expectedMoney = E.roundReward(before.money * (mode === "quick" ? 0.1 : 1) * 1.25);
      const expectedSupplies = E.roundReward(before.supplies * (mode === "quick" ? 0.1 : 1) * 1.25);
      engine.broadcast(room);
      const result = room.economyAwards.find((a) => a.kind === "result");
      assert(result);
      assert.equal(result.money, expectedMoney);
      assert.equal(result.supplies, expectedSupplies);
      if (mode === "mission") assert.deepEqual(result.stockGained.inventory, before.inventory);
      assert.equal(
        room.techAwards.reduce((sum, a) => sum + a.points, 0),
        mode === "mission" ? E.roundReward(expectedTech * 1.25) : expectedTech,
      );
      assert.deepEqual(
        room.economyAwards.find((a) => a.id === "process"),
        {
          id: "process",
          matchId: "completion-match",
          memberId: player.id,
          kind: "kill",
          money: 100,
          supplies: 150,
        },
      );
      const receipts = JSON.stringify([room.economyAwards, room.techAwards]);
      engine.broadcast(room);
      assert.equal(JSON.stringify([room.economyAwards, room.techAwards]), receipts);
    },
  );
