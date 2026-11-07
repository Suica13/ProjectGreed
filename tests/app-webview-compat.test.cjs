const { test } = require("node:test");
const assert = require("node:assert/strict");
const { missingFeatures } = require("../apps/android/webview-compat.js");
function view() {
  return {
    Map,
    Set,
    Proxy,
    Promise,
    fetch,
    WebSocket: function () {},
    structuredClone,
    Array,
    Object,
    TextEncoder,
    TextDecoder,
    crypto: { getRandomValues() {} },
    ResizeObserver: function () {},
    HTMLDialogElement: { prototype: { showModal() {} } },
    Element: { prototype: { replaceChildren() {} } },
    CSS: { supports: () => true },
    document: { createElement: () => ({ getContext: () => ({}) }) },
  };
}
test("capability acceptance is independent of a WebView version string", () => {
  for (const version of ["80.0", "83.0", "105.0", "109.0", "119.0", "120.0", "unknown"]) {
    const browser = view();
    browser.navigator = { userAgent: "Chrome/" + version };
    assert.deepEqual(missingFeatures(browser), []);
  }
});
test("unsupported clone and selector capabilities are reported separately", () => {
  const browser = view();
  browser.structuredClone = undefined;
  browser.CSS.supports = () => false;
  const missing = missingFeatures(browser);
  assert.equal(missing.length, 2);
  assert.match(missing[0], /structuredClone/);
  assert.match(missing[1], /CSS :has/);
});
test("old CSS parsers and unavailable canvases produce readable failures instead of crashing the probe", () => {
  const browser = view();
  browser.CSS.supports = () => {
    throw Error("old parser");
  };
  browser.document.createElement = () => ({ getContext: () => null });
  const missing = missingFeatures(browser);
  assert.equal(missing.length, 2);
  assert.match(missing.join(" "), /Canvas 2D/);
});
test("missing profile and battle primitives cannot silently pass startup", () => {
  const browser = view();
  browser.Array = { prototype: {} };
  browser.Object = {};
  browser.crypto = null;
  browser.ResizeObserver = undefined;
  browser.HTMLDialogElement = undefined;
  const missing = missingFeatures(browser);
  assert.equal(missing.length, 4);
  assert.match(missing.join(" "), /Object.hasOwn/);
});

test("a packaged selector fallback can satisfy the UI requirement while missing native primitives still fail", () => {
  const browser = view();
  browser.CSS.supports = () => false;
  browser.AppCompat = { selectors: true };
  assert.deepEqual(missingFeatures(browser), []);
  browser.structuredClone = undefined;
  assert.equal(missingFeatures(browser).length, 1);
});
