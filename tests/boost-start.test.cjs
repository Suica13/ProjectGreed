const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const G = require("../shared/rules.js"),
  ART = G.catalog;
function runtime() {
  const context = {
    ART,
    UnitModels: ART.models,
    BattleScene: { settings: () => ({ mapScale: 1 }) },
  };
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync("client/renderer.js", "utf8") +
      fs.readFileSync("client/sprite-effects.js", "utf8") +
      "\nglobalThis.sprites=SpriteEffects;globalThis.moves=MovementEffects;globalThis.renderer=SpriteRenderer;",
    context,
  );
  const effect = ART.effects.Boost_Start,
    png = Buffer.from(ART.assets[effect.asset].split(",")[1], "base64"),
    frames = [];
  context.renderer.images[effect.asset] = {
    width: png.readUInt32BE(16),
    height: png.readUInt32BE(20),
  };
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    scale() {},
    globalAlpha: 1,
    drawImage(image, x) {
      frames.push(x);
    },
  };
  return { ...context, ctx, frames, width: png.readUInt32BE(16) / effect.frames };
}
test("native Boost_Start plays four frames once and short map movement does not cut it off", () => {
  const r = runtime(),
    unit = { model: "RGM_79__beam_spray", angle: 90 };
  assert.equal(ART.effects.Boost_Start.fps, 6);
  for (const t of [-0.1, 0, 0.17, 0.34, 0.51, 0.7]) r.sprites.boostStart(r.ctx, unit, 0, 0, 1, t);
  assert.deepEqual(r.frames, [0, r.width, r.width * 2, r.width * 3]);
  r.frames.length = 0;
  r.moves.start(unit, { x: 0, y: 0 }, { x: 1, y: 0 }, 0);
  r.moves.draw(r.ctx, 100, () => ({ x: 0, y: 0 }), 64);
  r.moves.draw(r.ctx, 510, () => ({ x: 0, y: 0 }), 64);
  r.moves.draw(r.ctx, 700, () => ({ x: 0, y: 0 }), 64);
  assert.deepEqual(r.frames, [0, r.width * 3]);
  r.moves.start(unit, { x: 0, y: 0 }, { x: 1, y: 0 }, 800);
  r.moves.reset();
  r.moves.draw(r.ctx, 900, () => ({ x: 0, y: 0 }), 64);
  assert.equal(r.frames.length, 2);
});
