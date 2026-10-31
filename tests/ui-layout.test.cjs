const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs"),
  path = require("node:path");
const root = path.join(__dirname, "..");
function runtime() {
  const style = {};
  const context = {
    window: { dispatchEvent() {} },
    document: {
      getElementById: () => ({
        textContent: fs.readFileSync(path.join(root, "client/ui-layout.json"), "utf8"),
      }),
      createElement: () => style,
      head: { append() {} },
    },
    ART: require("../tools/load-catalog.cjs").loadCatalog(),
    structuredClone,
    Event: class {},
    innerWidth: 1400,
    console,
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, "client/ui-layout.js"), "utf8"), context);
  return { ...context.window, style };
}
test("layout validation rejects CSS injection and invalid geometry", () => {
  const U = runtime().UILayout;
  assert.equal(U.profile(), "desktop");
  const v = U.empty();
  v.profiles.desktop.map = {
    x: 20,
    width: 620,
    anchor: "center",
    background: "#123abc",
  };
  assert.equal(U.validate(v).profiles.desktop.map.width, 620);
  for (const bad of [
    { width: -1 },
    { x: Infinity },
    { color: "red;display:none" },
    { anchor: "url(x)" },
    { position: "absolute" },
  ]) {
    v.profiles.desktop.map = bad;
    assert.throws(() => U.validate(v));
  }
  v.profiles.desktop = { unknown: { x: 3 } };
  assert.throws(() => U.validate(v));
});
test("layout remains scoped by viewport and stable selectors", () => {
  const { UILayout: U, style } = runtime(),
    v = U.empty();
  v.profiles.desktop.map = { x: 40, width: 700 };
  v.profiles.mobile.map = { width: 320 };
  U.apply(v);
  assert.match(style.textContent, /@media \(min-width:1101px\)/);
  assert.match(style.textContent, /#mapWrap\{translate:40px 0px/);
  assert.match(style.textContent, /max-width:600px/);
  assert.match(style.textContent, /width:320px/);
});
test("release contains layout and gameplay but excludes developer tools", () => {
  const release = fs.readFileSync(path.join(root, "public/client.html"), "utf8");
  assert.match(release, /id="ui-layout-data"/);
  assert.match(release, /1313/);
  assert.doesNotMatch(
    release,
    /ui-editor-panel|ui-dev-launch|slg-ui-layout-dev-v1|ui-release-template|ui-preview-source|ui-editor-template|ui-editor-css/,
  );
  assert.doesNotMatch(release, /id="catalog-developer"|window\.CatalogDeveloper =/);
  assert.doesNotMatch(release, /id="source-editor"|developerUnitEdit|developerTreeEdit/);
  assert.equal(fs.existsSync(path.join(root, "public/index.html")), false);
});

test("canvas settings validate separately from CSS and preserve version 1 layouts", () => {
  const { UILayout: U, style } = runtime();
  const layout = U.empty();
  layout.profiles.desktop.$battle = { scale: 0.7, leftX: 0.3, RGM_79__bazooka: 1.2, damageY: -0.2 };
  layout.profiles.mobile.$battle = { scale: 0.5 };
  U.apply(layout);
  assert.equal(U.battle().scale, 0.7);
  assert.doesNotMatch(style.textContent, /\$battle|RGM_79__bazooka/);
  assert.equal(U.validate(U.empty()).version, 1);
  for (const bad of [
    { scale: 0 },
    { scale: Infinity },
    { leftX: 2 },
    { leftY: "0.5" },
    { unknown: 1 },
    { constructor: 1 },
    null,
    [],
  ]) {
    layout.profiles.desktop.$battle = bad;
    assert.throws(() => U.validate(layout));
  }
});

test("battle geometry composes global, side and model scales across viewport sizes", () => {
  const context = { window: {} };
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "client/battle-scene.js"), "utf8") +
      ";globalThis.scene=BattleScene;",
    context,
  );
  const scene = context.scene;
  const left = { id: "a", model: "RGM_79__beam_spray" },
    right = { id: "b", model: "RGM_79__bazooka" };
  const options = {
    ...scene.defaults,
    scale: 0.8,
    leftScale: 1.2,
    RGM_79__beam_spray: 0.9,
    leftX: 0.3,
  };
  const desktop = scene.geometry(1000, 450, left, right, options);
  const mobile = scene.geometry(500, 225, left, right, options);
  assert.equal(desktop[0].x, 300);
  assert.equal(desktop[1].x, 750);
  assert.ok(Math.abs(desktop[0].scale / desktop[1].scale - 1.2 * 0.9) < 1e-12);
  assert.equal(mobile[0].x, 150);
  assert.equal(mobile[0].scale, desktop[0].scale / 2);
});

test("built inline scripts remain valid after template formatting and include network runtime", () => {
  const html = fs.readFileSync(path.join(root, "public/client.html"), "utf8");
  let scripts = 0;
  for (const [, attributes, source] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    if (attributes.includes("application/json")) continue;
    assert.doesNotThrow(() => new vm.Script(source));
    scripts++;
  }
  assert.ok(scripts >= 3);
  assert.match(html, /const Net =/);
  assert.doesNotMatch(html, /__NETWORK__|__CORE__|__BATTLE_SCENE__/);
});
test("server serves client and removes developer routes", async () => {
  const { createServer } = require("../server.js"),
    app = createServer({ port: 0, host: "127.0.0.1" }),
    address = await app.listen();
  try {
    const base = "http://127.0.0.1:" + address.port;
    const dev = await fetch(base + "/developer.html"),
      release = await fetch(base + "/");
    assert.equal(dev.status, 404);
    assert.doesNotMatch(await release.text(), /ui-editor-panel/);
  } finally {
    await app.close();
  }
});
