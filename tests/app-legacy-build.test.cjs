const { test } = require("node:test");
const assert = require("node:assert/strict"),
  vm = require("node:vm");
const { transformScript, transformCss } = require("../tools/build-app-legacy.cjs");
test("Chrome80 transforms preserve logical assignment short-circuiting and global script scope", () => {
  const source = `let calls = 0; const state = { a: 0, b: null, c: 4 };
    state.a ||= ++calls; state.b ??= ++calls; state.c &&= ++calls;
    state.a ||= ++calls; state.b ??= ++calls;
    globalThis.result = { calls, state, nested: state?.missing?.value ?? 9 };`;
  const original = {},
    legacy = {};
  vm.runInNewContext(source, original);
  vm.runInNewContext(transformScript(source), legacy);
  assert.equal(JSON.stringify(legacy.result), JSON.stringify(original.result));
});
test("legacy selectors and positioning produce usable old-engine fallbacks", () => {
  const css = transformCss(":where(.a,.b):has(.child):is(.x,.y){inset:0}");
  assert.match(css, /csstools-has-/);
  assert.match(css, /top:0/);
  assert.doesNotMatch(css, /:where\(/);
  assert.doesNotMatch(css, /:is\(/);
});
