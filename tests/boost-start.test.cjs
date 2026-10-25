const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const ART = require("../shared/rules.js").catalog;
const context = vm.createContext({ ART, UnitModels: ART.models });
vm.runInContext(
  fs.readFileSync("client/renderer.js", "utf8") +
    fs.readFileSync("client/sprite-effects.js", "utf8") +
    "\nglobalThis.renderer=SpriteRenderer;globalThis.sprites=SpriteEffects",
  context,
);
function layers(model, moving, environment) {
  return context.renderer
    .visibleLayers(model, null, true, moving, null, 0, true, {}, null, true, environment)
    .map((l) => l.name);
}
test("reverse thrust stays active in space and flight; ships retain native engines", () => {
  for (const [id, unit] of Object.entries(ART.models)) {
    const boost = ART.units
      .find((u) => u.id === id)
      .decals.find((l) =>
        unit.ship ? l.visibleWhen?.thrustActive : l.visibleWhen?.sustainedThrust,
      );
    if (unit.ship && !boost) continue;
    assert.ok(boost, id);
    assert.ok(layers(id, false, "space").includes(boost.name), id);
    assert.ok(layers(id, true, "space").includes(boost.name), id);
    assert.equal(layers(id, false, "ground").includes(boost.name), unit.movementType === "air", id);
  }
});
test("ground booster units still show loops on movement, and start bursts have no runtime API or call sites", () => {
  assert.ok(!layers("RGM_79__machine_gun", false, "ground").includes("BoostLoop"));
  assert.ok(layers("RGM_79__machine_gun", true, "ground").includes("BoostLoop"));
  assert.equal(context.sprites.boostStart, undefined);
  assert.equal(ART.presentation.boostStartEffect, undefined);
  for (const f of fs.readdirSync("client").filter((f) => f.endsWith(".js")))
    assert.doesNotMatch(
      fs.readFileSync("client/" + f, "utf8"),
      /SpriteEffects\.boostStart|MovementEffects/,
    );
});
