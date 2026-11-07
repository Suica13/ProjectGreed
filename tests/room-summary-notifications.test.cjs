const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules.js"),
  { createRoomEngine } = require("../shared/room-engine.js");

test("battle revisions do not rebroadcast unchanged lobby summaries; setting and presence changes do", (t) => {
  let id = 0;
  const summaries = [];
  const engine = createRoomEngine({
    rules: G,
    randomId: () => "id" + ++id,
    randomToken: () => "token" + ++id,
    randomSeed: () => 1,
    send() {},
    onRooms: (list) => summaries.push(structuredClone(list)),
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 };
  engine.join(ws, { mode: "create", room: "SUMMARY", characterFaction: "PMC" });
  const room = engine.rooms.get("SUMMARY"),
    initial = summaries.length;
  assert(initial > 0);
  for (let i = 0; i < 20; i++) {
    room.revision++;
    engine.broadcast(room);
  }
  assert.equal(summaries.length, initial);
  engine.action(ws, {
    id: "cost",
    revision: room.revision,
    action: "configure_room",
    ...G.defaultRoomSettings(),
    costLimit: 4000,
  });
  assert.equal(summaries.length, initial + 1);
  assert.equal(summaries.at(-1)[0].costLimit, 4000);
  const fresh = engine.roomList();
  fresh[0].costLimit = -1;
  assert.equal(engine.roomList()[0].costLimit, 4000);
  ws.readyState = 3;
  engine.disconnect(ws);
  assert.equal(summaries.length, initial + 2);
  assert.equal(summaries.at(-1)[0].players, 0);
  assert(!JSON.stringify(summaries).includes("token"));
});
