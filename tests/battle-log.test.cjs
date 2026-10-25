const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const G = require("../shared/rules");

function chatFixture() {
  const nodes = new Map(),
    downloads = [],
    blobs = [];
  function node() {
    return {
      options: [],
      children: [],
      scrollTop: 0,
      scrollHeight: 0,
      clientHeight: 0,
      replaceChildren(...children) {
        this.children = children;
      },
      setAttribute() {},
      add(option) {
        this.options.push(option);
      },
      querySelectorAll() {
        return [];
      },
      append() {},
      click() {
        downloads.push(this.download);
      },
      remove() {},
    };
  }
  const byId = (id) => {
    if (!nodes.has(id)) nodes.set(id, node());
    return nodes.get(id);
  };
  const context = vm.createContext({
    Net: { active: false },
    WebSocket: { OPEN: 1 },
    game: { units: [] },
    byId,
    ChatChannels: { label: () => "全部" },
    Option: function (text, value) {
      return { text, value };
    },
    element: () => node(),
    setNamedText: (line, text) => {
      line.textContent = text;
    },
    document: { createElement: () => node(), body: { append() {} } },
    window: { addEventListener() {} },
    Blob,
    URL: {
      createObjectURL(blob) {
        blobs.push(blob);
        return "blob:test";
      },
      revokeObjectURL() {},
    },
    setTimeout() {},
    clearTimeout() {},
  });
  vm.runInContext(fs.readFileSync("client/chat.js", "utf8") + "\nglobalThis.chat=Chat;", context);
  return { chat: context.chat, byId, downloads, blobs };
}

test("game and room download the entire chronological UTF-8 log while displaying only recent rows", async () => {
  const { chat, byId, downloads, blobs } = chatFixture();
  assert.equal(byId("downloadBattleLog").disabled, true);
  byId("downloadBattleLog").onclick();
  assert.equal(blobs.length, 0);
  const entries = Array.from({ length: 120 }, (_, i) => `[蓝方][Player01]吉姆[X01] 行动${119 - i}`);
  entries[0] += "，部位破坏：头部、左臂";
  chat.setLog(entries);
  assert.equal(byId("log").children.length, 80);
  assert.equal(byId("roomCombatLog").children.length, 80);
  entries[0] = "changed after setLog";
  for (const id of ["downloadBattleLog", "roomDownloadBattleLog"]) {
    assert.equal(byId(id).disabled, false);
    byId(id).onclick();
  }
  assert.equal(downloads.length, 2);
  assert.match(downloads[0], /^ProjectGreed-battle-log-.*\.txt$/);
  const expected = Array.from({ length: 120 }, (_, i) => `[蓝方][Player01]吉姆[X01] 行动${i}`);
  expected[119] += "，部位破坏：头部、左臂";
  for (const blob of blobs) {
    assert.deepEqual(
      Array.from(new Uint8Array(await blob.arrayBuffer()).slice(0, 3)),
      [239, 187, 191],
    );
    assert.equal(await blob.text(), expected.join("\r\n") + "\r\n");
  }
  chat.setLog([]);
  assert.equal(byId("roomDownloadBattleLog").disabled, true);
});

test("offline combat logs destroyed body parts and ship modules without duplicate names", () => {
  const source = fs.readFileSync("client/app.js", "utf8"),
    lines = [];
  const module = Object.values(G.models).find((m) => m.prefabId === "SalamisClass").modules[0];
  const context = vm.createContext({
    Net: { active: false },
    Rules: G,
    battleUnit: (id) => ({ id }),
    getWeapon: () => ({ name: "测试武器" }),
    logUnit: (u) => u.id,
    formatNumber: String,
    addLog: (text) => lines.push(text),
  });
  vm.runInContext(
    source.slice(source.indexOf("function logEvent("), source.indexOf("function progressBattle(")),
    context,
  );
  context.logEvent({
    from: "a",
    to: "b",
    weapon: "test",
    hit: true,
    damage: 100,
    after: 100,
    brokenParts: ["head", "leftArm", "head", module.id],
  });
  assert.ok(lines[0].includes("部位破坏：头部、左臂、" + G.partNames[module.id]));
  assert.equal(lines[0].split("头部").length, 2);
  context.logEvent({ from: "a", to: "b", weapon: "test", hit: false, after: 100 });
  assert.ok(!lines[1].includes("部位破坏"));
});
