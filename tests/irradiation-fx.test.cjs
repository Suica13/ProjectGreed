const test = require("node:test"),
  assert = require("node:assert/strict"),
  vm = require("node:vm"),
  fs = require("node:fs");
test("irradiation hides stored passengers until impact and never resurrects a destroyed fog actor", () => {
  const context = vm.createContext({
    performance: { now: () => 0 },
    ART: {
      models: {},
      effects: Object.fromEntries(
        ["Charge", "Start", "Mid", "End"].map((part) => [
          "Irradiation_" + part + "_Pink",
          { asset: part, frames: 28, duration: 1 },
        ]),
      ),
    },
    SpriteRenderer: {
      images: Object.fromEntries(
        ["Charge", "Start", "Mid", "End"].map((part) => [part, { width: 280, height: 10 }]),
      ),
    },
    SpriteEffects: { draw() {} },
    GameAudio: { playSound() {} },
    MapEffects: {
      capture() {},
      after(fn) {
        fn();
      },
    },
  });
  vm.runInContext(
    fs.readFileSync("client/irradiation-fx.js", "utf8") + ";globalThis.api=IrradiationFX",
    context,
  );
  const target = { id: "victim", hp: 5000 },
    passenger = { id: "stored", hp: 100, embarked: { carrierId: "victim" } },
    after = { id: "stored", hp: 100 };
  context.api.start({
    id: "beam",
    unitId: "source",
    from: { x: 0, y: 0 },
    to: { x: 10, y: 0 },
    color: "Pink",
    chargeSeconds: 2,
    fireSeconds: 2,
    actors: [target, passenger],
    hits: [{ unitId: "victim", before: 5000, after: 0, hit: true }],
  });
  assert.deepEqual(
    Array.from(context.api.units([after], 0), (u) => u.id),
    ["victim"],
  );
  const ctx = { save() {}, restore() {}, translate() {}, rotate() {}, drawImage() {} };
  const position = (x, y) => ({ x, y });
  context.api.draw(ctx, 0, position, 40);
  context.api.draw(ctx, 2100, position, 40);
  const units = context.api.units([after], 2100);
  assert.equal(units.find((u) => u.id === "victim").hp, 0);
  assert.ok(units.some((u) => u.id === "stored" && !u.embarked));
});
