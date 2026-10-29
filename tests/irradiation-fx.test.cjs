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

test("native charge anchor follows the rendered actor, firing audio is separate and beam width never shrinks below MOD scale", () => {
  const sounds = [],
    charges = [],
    images = [];
  const context = vm.createContext({
    ART: {
      models: { hull: { presentation: { mapScale: 1 } } },
      effects: Object.fromEntries(
        ["Charge", "Start", "Mid", "End"].map((part) => [
          "Irradiation_" + part + "_Pink",
          { asset: part, frames: 28, duration: 1 },
        ]),
      ),
    },
    SpriteRenderer: {
      images: Object.fromEntries(
        ["Charge", "Start", "Mid", "End"].map((part) => [part, { width: 280, height: 84 }]),
      ),
      muzzle: (_model, weapon, actor) => {
        const offset = weapon.muzzle.mounts[0].offset;
        return { x: actor.x + offset.y * actor.scale, y: actor.y + offset.x * actor.scale };
      },
    },
    SpriteEffects: { draw: (_ctx, _id, x, y, scale) => charges.push({ x, y, scale }) },
    GameAudio: { playSound: (sound) => sounds.push(sound.asset) },
    MapEffects: { capture() {}, after: (done) => done() },
  });
  vm.runInContext(
    fs.readFileSync("client/irradiation-fx.js", "utf8") + ";globalThis.fx=IrradiationFX",
    context,
  );
  context.fx.start({
    id: "native",
    unitId: "source",
    model: "hull",
    color: "Pink",
    from: { x: 0, y: 0 },
    to: { x: 10, y: 0 },
    chargeSeconds: 2,
    fireSeconds: 2,
    chargeMuzzle: { mounts: [{ bone: "Body", offset: { x: 9, y: 50 } }] },
    muzzle: { mounts: [{ bone: "Body", offset: { x: 9, y: 40 } }] },
    beamWidth: 315,
    chargeScale: 1.3,
    sound: { asset: "native-charge" },
    fireSound: { asset: "native-fire" },
  });
  const ctx = {
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    drawImage: (...args) => images.push(args),
  };
  const actor = () => ({ x: 100, y: 200, scale: 0.5, angle: 90, clip: "native", time: 0.5 });
  const position = (x, y) => ({ x: x * 40, y: y * 40 });
  context.fx.draw(ctx, 0, position, 40, actor);
  assert.deepEqual(charges, [{ x: 125, y: 204.5, scale: 0.65 }]);
  assert.deepEqual(sounds, ["native-charge"]);
  context.fx.draw(ctx, 2200, position, 40, actor);
  context.fx.draw(ctx, 2300, position, 40, actor);
  assert.deepEqual(sounds, ["native-charge", "native-fire"]);
  assert.equal(images.length, 6);
  // Hit range changes must not change any native section geometry.
  const first = images.slice(images.length / 2);
  images.length = 0;
  context.fx.reset();
  context.fx.start({
    id: "long",
    color: "Pink",
    from: { x: 0, y: 0 },
    to: { x: 30, y: 0 },
    chargeSeconds: 2,
    fireSeconds: 2,
    elapsedSeconds: 2.2,
  });
  context.fx.draw(ctx, 0, position, 40, actor);
  assert.equal(images.length, 3);
  assert.deepEqual(
    images.map((args) => args.slice(5)),
    first.map((args) => args.slice(5)),
  );
  assert.ok(images.every((args) => args[8] >= 315 * 0.5));
});
