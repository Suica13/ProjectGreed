const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const ART = require("../tools/load-catalog.cjs").loadCatalog();

test("movement, aircraft and space thrust never draw through fog", () => {
  let clips = 0,
    draws = 0;
  const context = vm.createContext({
    ART,
    SpriteEffects: {
      clipFog() {
        clips++;
      },
      brokenModules() {},
    },
  });
  vm.runInContext(
    fs.readFileSync("client/renderer.js", "utf8") + "\nglobalThis.renderer=SpriteRenderer;",
    context,
  );
  const renderer = context.renderer;
  const ctx = {
    globalAlpha: 1,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    drawImage() {
      draws++;
    },
  };
  for (const [id, environment, moving, flying] of [
    ["RGM_79__machine_gun", "ground", true, false],
    ["RGM_79__machine_gun", "space", false, false],
    ["Dopp__main_0", "ground", false, true],
  ]) {
    for (const layer of renderer.models[id].decals)
      renderer.images[layer.asset] = { width: 1024, height: 1024 };
    clips = draws = 0;
    renderer.draw(
      ctx,
      id,
      0,
      0,
      1,
      0,
      null,
      0,
      null,
      true,
      true,
      moving,
      {},
      0,
      false,
      false,
      environment,
      null,
      null,
      flying,
    );
    assert.ok(clips > 0, id + " propulsion must be clipped to visible cells");
    clips = draws = 0;
    renderer.draw(
      ctx,
      id,
      0,
      0,
      1,
      0,
      null,
      0,
      null,
      true,
      true,
      moving,
      {},
      0,
      false,
      false,
      environment,
      null,
      null,
      flying,
      null,
      true,
    );
    assert.equal(draws, 0, id + " hidden propulsion must not appear in the effects-only feed");
  }
});
