const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
test("immersion is replay-only, hides UI, cancels turn cutins and always restores via Escape or replay exit", () => {
  const listeners = {},
    elements = [],
    classes = new Set();
  let cancelled = 0,
    closed = 0;
  const context = {
    window: { addEventListener: (name, fn) => (listeners[name] = fn) },
    TurnFlow: { reset: () => cancelled++ },
    document: {
      createElement: () => {
        const e = { append() {}, addEventListener() {} };
        elements.push(e);
        return e;
      },
      getElementById: () => ({ append() {} }),
      querySelectorAll: () => [{ close: () => closed++ }],
      body: {
        classList: { toggle: (name, value) => (value ? classes.add(name) : classes.delete(name)) },
      },
    },
  };
  vm.createContext(context);
  const source = fs.readFileSync("client/settings.js", "utf8");
  vm.runInContext(source.slice(source.indexOf("window.ReplayPresentation =")), context);
  const replay = context.window.ReplayPresentation;
  replay.setImmersive(true);
  assert.equal(replay.immersive, false);
  replay.setActive(true);
  assert.equal(elements[0].hidden, false);
  replay.setImmersive(true);
  assert.equal(replay.immersive, true);
  assert.equal(cancelled, 1);
  assert.equal(closed, 1);
  assert(classes.has("replay-immersive"));
  listeners.keydown({ key: "Escape", preventDefault() {}, stopImmediatePropagation() {} });
  assert.equal(replay.immersive, false);
  assert.equal(classes.size, 0);
  replay.setImmersive(true);
  replay.setActive(false);
  assert.equal(replay.immersive, false);
  assert.equal(elements[0].hidden, true);
});
