const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  { createRoomEngine } = require("../shared/room-engine.js");

for (const closeDuringQuery of [false, true])
  test(`AI transport scans yield and abandon ${closeDuringQuery ? "closed rooms" : "superseded revisions"}`, async (t) => {
    let serial = 0,
      probes = 0,
      interruptedAt = null,
      room,
      engine;
    const events = [];
    const clients = [{ readyState: 1 }, { readyState: 1 }];
    const rules = {
      ...G,
      hangars: {
        ...G.hangars,
        recoveryOrder() {
          probes++;
          // Simulate an expensive but read-only per-unit logistics query.
          const deadline = performance.now() + 10;
          while (performance.now() < deadline) {}
          if (probes === 1)
            setTimeout(() => {
              interruptedAt = probes;
              if (closeDuringQuery) engine.close();
              else
                engine.action(clients[1], {
                  id: "interrupt",
                  revision: room.revision,
                  round: room.game.round,
                  matchId: room.matchId,
                  action: "share_units",
                });
            }, 0);
          return null;
        },
      },
    };
    engine = createRoomEngine({
      rules,
      randomId: () => "id" + ++serial,
      randomToken: () => "token" + ++serial,
      randomSeed: () => 1,
      aiDelayMs: 1,
      send(_ws, snapshot) {
        if (snapshot.lastEvent?.type === "move") events.push(snapshot.lastEvent);
      },
    });
    t.after(() => engine.close());
    const profile = {
      characterFaction: "PMC",
      licenses: { Type61: true },
      inventory: { Type61: 12 },
      kits: { Type61__standard: 12 },
    };
    engine.join(clients[0], { ...profile, mode: "create", room: "YIELD" });
    engine.join(clients[1], { ...profile, mode: "join", room: "YIELD" });
    room = engine.rooms.get("YIELD");
    const formation = Array.from({ length: 12 }, () => ({ unitId: "Type61", kitId: "standard" }));
    const act = (seat, action, fields = {}) =>
      engine.action(clients[seat], {
        id: "action" + ++serial,
        revision: room.revision,
        action,
        ...fields,
      });
    act(1, "set_ready", { ready: true, formation });
    act(0, "start_game", { formation });
    act(0, "confirm_formation");
    act(1, "confirm_formation");
    act(0, "confirm_deployment");
    room.seats[0].bot = true;
    act(1, "confirm_deployment");
    room.turnNotBefore = 0;
    const timeout = Date.now() + 3000;
    while (interruptedAt === null && Date.now() < timeout)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(
      interruptedAt,
      1,
      "the interruption must run after the first probe, before the remaining units are scanned",
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(events.length, 0, "a stale query must not apply a movement intent");
    assert.equal(probes, 1, "the old scan must stop immediately after its revision/room changes");
  });
