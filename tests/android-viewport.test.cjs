const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
function fixture({
  width = 844,
  height = 390,
  coarse = true,
  ua = "Android",
  scale = 1,
  dpr = 3,
} = {}) {
  const events = {},
    docEvents = {},
    frames = [],
    timers = [],
    classes = new Set();
  let writes = 0,
    content = "width=device-width,initial-scale=1";
  const viewport = {
    get content() {
      return content;
    },
    set content(v) {
      content = v;
      writes++;
    },
  };
  const root = {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    dataset: {},
  };
  const context = {
    document: {
      documentElement: root,
      querySelector: () => viewport,
      activeElement: null,
      addEventListener: (k, f) => (docEvents[k] = f),
    },
    navigator: { userAgent: ua },
    matchMedia: () => ({ matches: coarse }),
    innerWidth: width,
    innerHeight: height,
    devicePixelRatio: dpr,
    visualViewport: {
      width,
      height,
      scale,
      addEventListener: (k, f) => (events["visual-" + k] = f),
    },
    addEventListener: (k, f) => (events[k] = f),
    requestAnimationFrame: (f) => (frames.push(f), frames.length),
    setTimeout: (f) => timers.push(f),
  };
  context.window = context;
  vm.runInNewContext(fs.readFileSync("client/landscape-viewport.js", "utf8"), context);
  return {
    context,
    events,
    docEvents,
    root,
    viewport,
    get writes() {
      return writes;
    },
    flush() {
      while (frames.length) frames.shift()();
    },
  };
}
test("late Android startup geometry recovers without a user zoom or resize", () => {
  const f = fixture({ width: 0, height: 0 });
  assert.equal(f.writes, 0);
  Object.assign(f.context.visualViewport, { width: 844, height: 390 });
  f.docEvents.DOMContentLoaded();
  f.flush();
  assert(f.root.classList.contains("phone-landscape"));
  assert.equal(f.writes, 1);
  assert.match(f.viewport.content, /width=1948/);
});
test("self-generated viewport events and subpixel jitter do not rewrite meta repeatedly", () => {
  const f = fixture();
  assert.equal(f.writes, 1);
  for (let n = 0; n < 100; n++) {
    Object.assign(f.context.visualViewport, {
      width: 844 + (n % 2 ? 0.1 : -0.1),
      height: 390 + (n % 2 ? 0.1 : -0.1),
    });
    f.events["visual-resize"]();
    f.flush();
  }
  assert.equal(f.writes, 1);
  Object.assign(f.context.visualViewport, { width: 390, height: 844 });
  f.events.orientationchange();
  f.flush();
  assert(!f.root.classList.contains("phone-landscape"));
  assert.equal(f.viewport.content, "width=device-width,initial-scale=1");
});
test("mobile backing buffers respect native zoom, GPU edge and pixel budgets; desktop DPR stays unchanged", () => {
  const f = fixture({ scale: 0.4333333333 });
  const ratio = f.context.GameViewport.pixelRatio(1600, 700);
  assert(ratio < 1.31 && ratio > 1.29);
  assert(1600 * 700 * ratio * ratio < 4000001);
  const huge = f.context.GameViewport.pixelRatio(8000, 4000);
  assert(8000 * huge <= 4096);
  assert(8000 * 4000 * huge * huge <= 4000001);
  const desktop = fixture({ coarse: false, ua: "Windows", dpr: 3 });
  assert.equal(desktop.context.GameViewport.pixelRatio(1600, 900), 3);
  assert.equal(desktop.writes, 0);
});
