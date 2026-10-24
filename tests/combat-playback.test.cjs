const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
function runtime() {
  const elements = new Map(),
    units = [
      { id: "a", name: "A", hp: 100 },
      { id: "b", name: "B", hp: 100 },
    ];
  const calls = { shows: [], snapshots: 0, requests: [] };
  const context = {
    battleView: null,
    phase: "idle",
    pageView: "game",
    performance: { now: () => 100 },
    getUnit: (id) => units.find((u) => u.id === id),
    unitName: (u) => u.name,
    byId: (id) => {
      if (!elements.has(id)) elements.set(id, {});
      return elements.get(id);
    },
    MapCombat: {
      reset: () => {},
      seed: () => {},
      begin: (view) => calls.shows.push(view.networkId),
      resume: () => {},
      suspend: () => {
        calls.suspended = true;
      },
    },
    BattleWindow: {
      show: (view) => calls.shows.push(view.networkId),
      resume: () => {},
      suspend: () => {
        calls.suspended = true;
      },
    },
    TurnFlow: { play: () => {} },
    Net: {
      snapshot: {},
      memberId: "viewer",
      applySnapshot: () => calls.snapshots++,
      request: (action, fields) => calls.requests.push({ action, ...fields }),
    },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("client/combat-playback.js", "utf8") + "\nglobalThis.playback=CombatPlayback",
    context,
  );
  return { context, playback: context.playback, calls };
}
const battle = (id) => ({
  id,
  matchId: "match",
  a: "a",
  b: "b",
  actors: [
    { id: "a", hp: 100 },
    { id: "b", hp: 100 },
  ],
  before: { a: 100, b: 100 },
  events: [],
});
function snapshot(ready = []) {
  return {
    matchId: "match",
    started: true,
    phase: "playback",
    you: { id: "viewer" },
    playback: { id: "batch", members: ["viewer", "other"], ready },
    combats: [battle("one"), battle("two")],
  };
}
test("all results start as one parallel batch, repeated snapshots never restart it, and completion acknowledges only this viewer", () => {
  const { context, playback, calls } = runtime();
  context.Net.snapshot = snapshot();
  playback.receive(context.Net.snapshot, true);
  playback.receive(context.Net.snapshot, true);
  assert.equal(playback.queued, 1);
  playback.show();
  assert.deepEqual(calls.shows, ["batch"]);
  assert.equal(context.battleView.battles.length, 2);
  playback.show();
  assert.equal(calls.shows.length, 1);
  playback.finish();
  assert.equal(context.battleView, null);
  playback.show();
  assert.equal(calls.requests.length, 1);
  assert.equal(calls.requests[0].action, "playback_ready");
  assert.equal(calls.requests[0].batchId, "batch");
});
test("unfinished reconnects replay the active batch; a viewer who already confirmed completion does not replay it", () => {
  const first = runtime();
  first.context.Net.snapshot = snapshot();
  first.playback.receive(first.context.Net.snapshot, false);
  assert.equal(first.playback.queued, 1);
  const second = runtime();
  second.context.Net.snapshot = snapshot(["viewer"]);
  second.playback.receive(second.context.Net.snapshot, false);
  assert.equal(second.playback.queued, 0);
});
