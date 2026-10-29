const { test, expect } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { createRoomEngine } = require("../shared/room-engine.js");
const G = require("../shared/rules.js");
function snapshots() {
  const frames = new Map();
  let seq = 0;
  const engine = createRoomEngine({
    rules: G,
    randomId: () => `move-${++seq}`,
    randomToken: () => `token-${++seq}`,
    randomSeed: () => 1,
    send: (ws, m) => frames.set(ws, JSON.parse(JSON.stringify(m))),
  });
  try {
    const players = [{ readyState: 1 }, { readyState: 1 }];
    players.forEach((ws, i) =>
      engine.join(ws, {
        mode: i ? "join" : "create",
        room: "MOVESPEC",
        characterFaction: "PMC",
        inventory: { Type61: 4 },
      }),
    );
    const room = engine.rooms.get("MOVESPEC");
    function act(ws, action, fields = {}) {
      engine.action(ws, {
        id: `action-${++seq}`,
        revision: room.revision,
        round: room.game.round,
        matchId: room.matchId,
        action,
        ...fields,
      });
      const frame = frames.get(ws);
      assert.notEqual(frame.type, "error", JSON.stringify(frame));
      return frame;
    }
    act(players[0], "configure_room", { ...G.defaultRoomSettings(), fogMode: "disabled" });
    const formation = [{ unitId: "Type61", kitId: "standard" }];
    players.forEach((ws) => act(ws, "set_ready", { ready: true, formation }));
    act(players[0], "start_game");
    players.forEach((ws) => act(ws, "confirm_formation"));
    players.forEach((ws) => act(ws, "confirm_deployment"));
    room.game.tiles.forEach((row) => row.fill("plain"));
    const u = room.game.units[0];
    Object.assign(u, { x: 5, y: 8 });
    Object.assign(room.game.units[1], { x: 12, y: 8 });
    const views = [null, 0, 1].map((team) => {
      const ws = { readyState: 1 };
      engine.join(ws, { mode: "join", room: "MOVESPEC", characterFaction: "PMC" });
      assert.equal(ws.seat, null);
      act(ws, "spectate", { team });
      return { ws, team, states: [] };
    });
    const capture = () => views.forEach((view) => view.states.push(act(view.ws, "sync")));
    capture();
    act(players[0], "move", { unitId: u.id, x: 6, y: 8 });
    capture();
    act(players[0], "confirm_move", { unitId: u.id });
    capture();
    capture();
    return views.map(({ team, states }) => ({ team, states }));
  } finally {
    engine.close();
  }
}
for (const team of [null, 0, 1])
  test(`spectator ${team === null ? "global" : "team " + team} movement preview and confirmation animate once`, async ({
    page,
  }) => {
    const { states } = snapshots().find((view) => view.team === team);
    await page.addInitScript(() => localStorage.setItem("projectgreed.language", "zh"));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    const counts = await page.evaluate(async (states) => {
      Net.leave({ notify: false });
      await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(states[0].game));
      Net.active = true;
      Net.local = true;
      Net.seat = null;
      Net.started = true;
      Net.memberId = states[0].you.id;
      Net.applied = false;
      Net.seen.clear();
      setPageView("game");
      const original = PlanningUI.move;
      let plays = 0;
      const counts = [];
      PlanningUI.move = (...args) => {
        plays++;
        return original(...args);
      };
      try {
        for (const state of states) {
          Net.snapshot = state;
          Net.applySnapshot(state);
          counts.push(plays);
        }
      } finally {
        PlanningUI.move = original;
      }
      return counts;
    }, states);
    expect(counts).toEqual(team === 1 ? [0, 0, 1, 1] : [0, 1, 1, 1]);
  });
