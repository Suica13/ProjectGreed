const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm"),
  G = require("../shared/rules.js"),
  R = require("../shared/match-records.js");
function runtime() {
  const nodes = [],
    ids = new Map(),
    sent = [],
    classes = new Set();
  function node(tag = "div") {
    const e = {
      tag,
      textContent: "",
      children: [],
      options: [],
      value: "",
      hidden: false,
      checked: false,
      style: {},
      classList: { add() {}, remove() {} },
      append(...v) {
        this.children.push(...v);
      },
      replaceChildren(...v) {
        this.children = v;
        this.options = [];
      },
      add(v) {
        this.options.push(v);
      },
      setAttribute() {},
      addEventListener() {},
      showModal() {
        this.open = true;
      },
      close() {
        this.open = false;
      },
      click() {
        this.onclick?.();
      },
    };
    nodes.push(e);
    return e;
  }
  const byId = (id) => {
    if (!ids.has(id)) ids.set(id, node());
    return ids.get(id);
  };
  byId("downloadBattleLog").onclick = () => {};
  const g = G.create(false, 11),
    errors = [];
  const context = {
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    TextEncoder,
    Blob,
    URL,
    performance: { now: () => 1000 },
    crypto: { randomUUID: () => String(sent.length) + "-request" },
    document: {
      createElement: node,
      createTextNode: (text) => ({ textContent: text }),
      body: {
        append() {},
        classList: { add: (x) => classes.add(x), remove: (x) => classes.delete(x) },
      },
    },
    Option: function (text, value) {
      this.text = text;
      this.value = value;
    },
    byId,
    Rules: G,
    MatchRecords: R,
    game: g,
    phase: "idle",
    pageView: "menu",
    log: [],
    battleView: null,
    moving: null,
    selected: null,
    weaponId: null,
    pending: null,
    mode: "select",
    Net: {
      active: false,
      snapshot: null,
      revision: 1,
      memberId: "host",
      socket: { readyState: 1, send: (raw) => sent.push(JSON.parse(raw)) },
      applySnapshot() {},
    },
    ReplayPresentation: {
      setActive(v) {
        this.active = v;
      },
      setImmersive(v) {
        this.immersive = v;
      },
      immersive: false,
    },
    Chat: { setSnapshot() {}, saveLog() {} },
    MatchResults: { reset() {} },
    CombatPlayback: { reset() {} },
    PlanningUI: { reset() {}, move() {} },
    MapEffects: { reset() {} },
    SkillEffects: { reset() {}, start() {} },
    TurnFlow: { reset() {}, play: async () => {}, setReplayPaused() {} },
    WeaponAudio: { stop() {} },
    MapCamera: { reset() {} },
    MapCombat: { reset() {}, seed() {}, begin() {} },
    ART: { effects: {} },
    LocalRoom: { open() {} },
    note: (m) => errors.push(m),
    update() {},
    setPageView: (view) => {
      context.pageView = view;
    },
    addEventListener() {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("client/replay-player.js", "utf8"), context);
  return { context, nodes, byId, sent, errors, player: context.ReplayPlayer, classes };
}
function archive() {
  const game = G.create(false, 11),
    record = R.create(G, "record", { ...G.defaultRoomSettings(), mapId: game.mapId }, game.tiles);
  const { seed, partSeed, ...publicGame } = game,
    first = { game: publicGame, phase: "idle", log: ["first"], viewTeam: null };
  const second = R.clone(first);
  second.game.units[0].hp -= 10;
  second.log.unshift("second");
  record.perspectives = ["global"];
  record.frames = [
    { at: 0, views: { global: R.pack(null, first) } },
    { at: 1, views: { global: R.pack(first, second) } },
  ];
  return { record, first, second };
}
test("standalone file playback loads, pauses, advances, seeks backwards and restores the previous screen", async () => {
  const r = runtime(),
    { record, first, second } = archive(),
    file = r.nodes.find((e) => e.tag === "input" && e.type === "file");
  file.files = [{ size: JSON.stringify(record).length, text: async () => JSON.stringify(record) }];
  await file.onchange();
  assert.deepEqual(r.errors, []);
  assert.equal(r.player.active, true);
  assert.equal(r.context.pageView, "game");
  assert.equal(r.context.ReplayPresentation.active, true);
  r.player.tick(1200);
  assert.equal(r.context.game.units[0].hp, first.game.units[0].hp, "paused");
  const play = r.nodes.find((e) => e.tag === "button" && e.textContent === "播放");
  await play.onclick();
  r.player.tick(1450);
  assert.equal(r.context.game.units[0].hp, second.game.units[0].hp);
  const timeline = r.nodes.find((e) => e.type === "range");
  timeline.value = 0;
  await timeline.onchange();
  assert.equal(r.context.game.units[0].hp, first.game.units[0].hp);
  r.player.stop();
  assert.equal(r.player.active, false);
  assert.equal(r.context.pageView, "menu");
  assert.equal(r.context.ReplayPresentation.active, false);
});
test("shared replay acknowledges completed frames through replay_ready without submitting gameplay commands", () => {
  const r = runtime(),
    { first } = archive();
  r.context.Net.active = true;
  const snapshot = {
    hostId: "host",
    members: [],
    game: first.game,
    settings: G.defaultRoomSettings(),
    replay: {
      id: "replay",
      recordId: "record",
      index: 0,
      total: 2,
      token: "frame-0",
      playing: true,
      speed: 1,
      perspective: "global",
      perspectives: ["global"],
      checkpoints: [],
      frame: first,
    },
  };
  assert.equal(r.player.receive(snapshot), true);
  r.player.tick(1250);
  assert.equal(r.sent.length, 1);
  assert.equal(r.sent[0].action, "replay_ready");
  assert.equal(r.sent[0].token, "frame-0");
  r.player.response({ type: "record_reply", ack: r.sent[0].id });
  r.player.receive({ ...snapshot, replay: null });
  assert.equal(r.player.active, false);
});
