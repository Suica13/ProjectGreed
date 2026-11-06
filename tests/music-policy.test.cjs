const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
function player() {
  const nodes = new Map(),
    events = new Map();
  class Audio {
    constructor() {
      this.paused = true;
      this.events = {};
    }
    addEventListener(k, v) {
      this.events[k] = v;
    }
    getAttribute(k) {
      return this[k];
    }
    play() {
      this.paused = false;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  const tracks = require("../assets/music/playlist.json").tracks.map((t) => ({
    ...t,
    source: t.file,
  }));
  const context = vm.createContext({
    Audio,
    Math,
    ART: { music: { volume: 1, tracks } },
    pageView: "menu",
    Net: { snapshot: null },
    document: {
      getElementById(id) {
        if (!nodes.has(id))
          nodes.set(id, {
            addEventListener(k, f) {
              events.set(id + ":" + k, f);
            },
            setAttribute() {},
          });
        return nodes.get(id);
      },
    },
    window: { addEventListener() {} },
  });
  vm.runInContext(
    fs.readFileSync("client/music.js", "utf8") + ";globalThis.player=MusicPlayer",
    context,
  );
  function samples() {
    const out = [];
    for (let i = 0; i < 80; i++) {
      events.get("musicNext:click")();
      out.push(tracks[context.player.index]);
    }
    return out;
  }
  return { context, samples };
}
test("PMC menus randomize all menu tracks, while strategic menus and battles respect faction music", () => {
  const { context: c, samples } = player();
  const menu = samples();
  assert(menu.every((t) => t.scene === "menu"));
  assert.deepEqual([...new Set(menu.map((t) => t.faction))].sort(), ["EFSF", "PMC", "ZEON"]);
  c.Net.snapshot = {
    settings: { mode: "campaign" },
    you: { id: "me" },
    members: [{ id: "me", seat: 1, characterFaction: "ZEON" }],
    campaign: { teams: [{ faction: "EFSF" }, { faction: "ZEON" }] },
  };
  c.player.sync();
  assert(samples().every((t) => t.scene === "menu" && t.faction === "ZEON"));
  c.pageView = "game";
  c.player.sync();
  assert(samples().every((t) => t.scene === "battle" && (!t.faction || t.faction === "ZEON")));
  c.Net.snapshot.members[0].seat = 0;
  c.player.sync();
  assert(samples().every((t) => t.scene === "battle" && (!t.faction || t.faction === "EFSF")));
  c.Net.snapshot = null;
  c.pageView = "menu";
  c.player.sync();
  assert(samples().every((t) => t.scene === "menu"));
});
