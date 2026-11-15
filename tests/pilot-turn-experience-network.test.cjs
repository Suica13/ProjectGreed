const test = require("node:test"),
  assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const WebSocket = require("ws");
const { createServer } = require("../server");
const G = require("../shared/rules");
const version = require("../project.json").version;

test("WebSocket snapshot delivers private pilot XP before playback completion and final settlement", async (t) => {
  const app = createServer({ port: 0, host: "127.0.0.1", aiDelayMs: 999999 });
  const address = await app.listen(),
    sockets = [];
  t.after(async () => {
    for (const ws of sockets) ws.terminate();
    await app.close();
  });
  async function connect(mode) {
    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    sockets.push(ws);
    const frames = [];
    ws.on("message", (raw) => frames.push(JSON.parse(raw)));
    const wait = async (predicate) => {
      const end = Date.now() + 5000;
      while (Date.now() < end) {
        const frame = frames.find(predicate);
        if (frame) return frame;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      throw Error("WebSocket XP test timed out");
    };
    await new Promise((resolve, reject) => {
      ws.once("open", resolve);
      ws.once("error", reject);
    });
    ws.send(
      JSON.stringify({
        type: "hello",
        version,
        mode,
        room: "WIREXP",
        roomMode: "quick",
        characterFaction: "PMC",
        licenses: { Type61: true },
        inventory: { Type61: 10 },
      }),
    );
    await wait((f) => f.type === "joined");
    await wait((f) => f.type === "state");
    return {
      frames,
      wait,
      async act(action, fields = {}) {
        const room = app.rooms.get("WIREXP"),
          id = randomUUID();
        ws.send(
          JSON.stringify({
            type: "action",
            action,
            id,
            revision: room.revision,
            matchId: room.matchId,
            round: room.game.round,
            ...fields,
          }),
        );
        const result = await wait(
          (f) => (f.type === "state" && f.ack === id) || (f.type === "error" && f.id === id),
        );
        assert.equal(result.type, "state", JSON.stringify(result));
        return result;
      },
    };
  }
  const host = await connect("create"),
    guest = await connect("join");
  const room = app.rooms.get("WIREXP"),
    pilot = G.pilots.createCustom("custom-wire-xp", "Wire XP");
  const tank = { unitId: "Type61", kitId: "standard" };
  await host.act("configure_room", {
    ...G.defaultRoomSettings(),
    battleMode: "quick",
    formationStyle: "free",
    fogMode: "disabled",
  });
  await guest.act("set_ready", { ready: true, formation: [tank, tank] });
  await host.act("start_game", { formation: [{ ...tank, customPilot: pilot }] });
  await host.act("confirm_formation");
  await guest.act("confirm_formation");
  await host.act("confirm_deployment");
  await guest.act("confirm_deployment");
  const actor = room.game.units.find((u) => u.pilot?.id === pilot.id),
    enemies = room.game.units.filter((u) => u.team === 1),
    target = enemies[0];
  room.game.tiles.forEach((row) => row.fill("plain"));
  room.game.seed = 1;
  Object.assign(actor, { x: 4, y: 4 });
  Object.assign(target, { x: 6, y: 4, hp: 1, shield: 0 });
  target.pilot.stats.reaction = 0;
  Object.assign(enemies[1], { x: 30, y: 20 });
  await host.act("attack", { unitId: actor.id, targetId: target.id });
  await host.act("end_turn");
  while (room.phase === "reaction") {
    if (room.reactions.length)
      await guest.act("respond", { reactionId: room.reactions[0].id, response: "defend" });
    else await guest.act("confirm_responses", { reviewId: room.reactionReviewId });
  }
  const snapshot = await host.wait(
    (f) =>
      f.type === "state" &&
      f.pilotAwards?.some((a) => a.pilotId === pilot.id && a.experiencePoints > 0),
  );
  assert.equal(snapshot.rewardsSettled, false);
  assert.equal(snapshot.phase, "playback");
  const award = snapshot.pilotAwards.find((a) => a.kind === "kill");
  assert.equal(award.experiencePoints, 10);
  assert.equal(award.persistent, true);
  assert.equal(snapshot.game.units.find((u) => u.id === actor.id).pilot.experience, 10);
  assert(
    guest.frames
      .filter((f) => f.type === "state")
      .every((f) => !(f.pilotAwards || []).some((a) => a.pilotId === pilot.id)),
  );
  const ledger = { pilots: [pilot], awards: [] };
  G.pilots.creditAwards(ledger, snapshot.pilotAwards, { settled: false });
  G.pilots.creditAwards(ledger, snapshot.pilotAwards, { settled: true });
  assert.equal(ledger.pilots[0].experience, 10);
});
