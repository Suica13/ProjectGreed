const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  D = require("../shared/development.js");
const { createRoomEngine } = require("../shared/room-engine.js");

for (const mode of ["regular", "quick"])
  test(`${mode}: AI-only rooms use the spectator host's research instead of starter technology`, () => {
    let sequence = 0;
    const engine = createRoomEngine({
      rules: G,
      send() {},
      randomId: () => "spectator-" + ++sequence,
      randomToken: () => "token-" + ++sequence,
      randomSeed: () => 1,
    });
    const host = { readyState: 1 };
    const researched = { EFSF: D.nodes("EFSF").map((node) => node.id) };
    try {
      engine.join(host, {
        mode: "create",
        room: "AIONLY",
        characterFaction: "EFSF",
        researched,
        roomMode: mode,
      });
      const room = engine.rooms.get("AIONLY");
      const action = (action, fields = {}) =>
        engine.action(host, {
          action,
          id: "request-" + ++sequence,
          revision: room.revision,
          ...fields,
        });
      action("configure_room", {
        mapId: "frontier_1v1",
        costLimit: 4000,
        unitCostLimit: 800,
        unitLimit: 12,
      });
      action("add_ai", { seat: 1 });
      action("switch_seat", { seat: null });
      action("add_ai", { seat: 0 });
      // Another spectator's advanced faction must not become the fallback source.
      engine.join(
        { readyState: 1 },
        {
          mode: "join",
          room: "AIONLY",
          characterFaction: "PMC",
          researched: { EFSF: researched.EFSF, AEUG: D.nodes("AEUG").map((node) => node.id) },
        },
      );
      action("start_game", { researched });
      assert.equal(room.phase, "assembly");
      const hostMember = room.members.get(room.hostId);
      const expected = D.aiResearch([
        { characterFaction: hostMember.characterFaction, researched },
      ]);
      assert.deepEqual(room.aiResearch, expected);
      assert(room.seats.every((member) => member.bot));
      assert(
        room.seats.some((member) =>
          member.formation.some((entry) => !D.allows(member.characterFaction, entry.unitId, {})),
        ),
      );
      for (const bot of room.seats)
        assert(
          bot.formation.every((entry) => D.allows(bot.characterFaction, entry.unitId, expected)),
        );
    } finally {
      engine.close();
    }
  });
