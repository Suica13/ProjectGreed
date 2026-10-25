const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  vm = require("node:vm");
const G = require("../shared/rules.js"),
  ART = G.catalog;
const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
function targetAt(unit, relative) {
  const c = G.center(unit),
    angle = ((unit.angle + relative) * Math.PI) / 180;
  return {
    model: "RGM_79__machine_gun",
    x: c.x + Math.sin(angle) * 8,
    y: c.y - Math.cos(angle) * 8,
    hp: 1,
    team: 1,
  };
}
test("native rear beam turret arcs are preserved and remain valid through every hull heading", () => {
  for (const id of ["SalamisClass", "MagellanClass", "MagellanClass_Green"]) {
    const a = { model: id + "__standard", x: 10, y: 10, hp: 100000, angle: 0 };
    const m = G.modelOf(a),
      rear = m.modules.filter((m) => m.id.includes("BeamCannon") && /_[LR]2$/.test(m.id));
    assert.equal(rear.length, 2);
    for (const module of rear) {
      assert.equal(module.arc, id === "SalamisClass" ? 75 : 50, module.id);
      const w = m.weapons.find((w) => w.attack.strikes.some((s) => s.moduleId === module.id));
      for (const angle of [0, 90, 180, 270, -90, 630]) {
        a.angle = angle;
        for (const offset of [-module.arc + 0.5, 0, module.arc - 0.5])
          assert.ok(
            G.availableStrikes(a, w, targetAt(a, module.idleDir + offset)).some(
              (s) => s.moduleId === module.id,
            ),
            module.id + " heading " + angle + " offset " + offset,
          );
        for (const offset of [-module.arc - 0.5, module.arc + 0.5])
          assert.ok(
            !G.availableStrikes(a, w, targetAt(a, module.idleDir + offset)).some(
              (s) => s.moduleId === module.id,
            ),
            module.id + " outside arc",
          );
      }
    }
  }
});
test("rear turret muzzle rotation agrees with legal firing arc across negative aim angles", () => {
  const context = vm.createContext({ ART });
  vm.runInContext(
    fs.readFileSync("client/renderer.js", "utf8") + "\nglobalThis.sprite=SpriteRenderer",
    context,
  );
  const model = "SalamisClass__standard",
    module = ART.models[model].modules.find((m) => m.id.endsWith("BeamCannon_L2")),
    weapon = ART.models[model].weapons.find((w) => w.moduleIds?.includes(module.id));
  const actor = { x: 500, y: 500, scale: 1, angle: 270, aimAngle: -171 };
  const index = weapon.attack.strikes.find((s) => s.moduleId === module.id).shotIndex;
  const origin = context.sprite.modulePosition(model, module.id, actor),
    muzzle = context.sprite.muzzle(model, weapon, actor, null, 0, index);
  const angle = (Math.atan2(muzzle.x - origin.x, -(muzzle.y - origin.y)) * 180) / Math.PI;
  assert.ok(Math.abs(wrap(angle - actor.aimAngle)) < 0.00001);
});
