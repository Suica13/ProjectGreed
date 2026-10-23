const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
function runtime() {
  const element = { hidden: true, style: {} },
    context = {
      document: { getElementById: () => element },
      ART: { presentation: { battleFadeIn: 0.3, battleHold: 2, battleFadeOut: 0.3 } },
    };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("client/battle-window.js", "utf8") + ";globalThis.window=BattleWindow;",
    context,
  );
  return { window: context.window, element };
}
test("battle fades in, holds two seconds after completion, fades out and closes exactly once", () => {
  const { window, element } = runtime(),
    view = { completed: false };
  let closed = 0;
  window.show(view, 1000);
  assert.equal(element.hidden, false);
  assert.equal(element.style.opacity, "0");
  assert.equal(view.start, 1300);
  window.update(view, 1150, () => closed++);
  assert.equal(Number(element.style.opacity), 0.5);
  window.update(view, 1300, () => closed++);
  assert.equal(view.windowState, "playing");
  view.completed = true;
  window.complete(view, 5000);
  window.update(view, 6999, () => closed++);
  assert.equal(element.style.opacity, "1");
  assert.equal(closed, 0);
  window.update(view, 7000, () => closed++);
  assert.equal(view.windowState, "closing");
  window.update(view, 7150, () => closed++);
  assert.equal(Number(element.style.opacity), 0.5);
  window.update(view, 7300, () => closed++);
  assert.equal(closed, 1);
  assert.equal(element.hidden, true);
  window.update(view, 9000, () => closed++);
  window.resume(view, 10000);
  assert.equal(closed, 1);
  assert.equal(element.hidden, true);
});
test("room navigation and disconnect suspend the hold clock; new battles reject stale updates", () => {
  const { window, element } = runtime(),
    view = { completed: true };
  let closed = 0;
  window.show(view, 0);
  window.complete(view, 1000);
  window.suspend(view, 1500);
  window.suspend(view, 1700);
  window.update(view, 10000, () => closed++);
  assert.equal(closed, 0);
  window.resume(view, 10000);
  assert.equal(view.completedAt, 9500);
  window.update(view, 11499, () => closed++);
  assert.equal(view.windowState, "holding");
  const next = { completed: false };
  window.show(next, 11500);
  window.update(view, 15000, () => closed++);
  assert.equal(closed, 0);
  assert.equal(element.hidden, false);
});
