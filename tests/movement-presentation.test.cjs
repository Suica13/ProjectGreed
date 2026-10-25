const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm");
const ART = require("../tools/load-catalog.cjs").loadCatalog();
const context = vm.createContext({ ART });
vm.runInContext(fs.readFileSync("client/renderer.js", "utf8") + "\nglobalThis.renderer=SpriteRenderer", context);
const model = (id) => ART.units.find((u) => u.id.startsWith(id + "__")).id;
const visible = (id, moving, onLand) => context.renderer.visibleLayers(model(id), null, true, moving, null, 1, true, {}, null, onLand).map((l) => l.name);

test("all native hover decals loop only during land movement", () => {
  for (const p of ART.prefabs.filter((p) => p.layers.some((l) => l.name === "Hover"))) {
    assert.ok(visible(p.id, true, true).includes("Hover"), p.id);
    assert.ok(!visible(p.id, false, true).includes("Hover"), p.id + " stationary");
    assert.ok(!visible(p.id, true, false).includes("Hover"), p.id + " water/space");
    assert.equal(p.layers.find((l) => l.name === "Hover").frameFps, 10);
  }
  assert.ok(visible("MS_09", true, true).includes("Hover"));
});

test("EXAM and HADES have native startup effects and persistent red loops only in active forms", () => {
  for (const p of ART.prefabs.filter((p) => p.skills?.some((s) => s.type === "overdrive"))) {
    const skill = p.skills.find((s) => s.type === "overdrive");
    assert.ok(ART.effects[skill.effect].texture.endsWith("System_" + skill.id + ".png"));
    assert.ok(!visible(p.id, false, true).includes("System_Red_Top_1"));
    for (const name of ["System_Red_Top_1", "System_Red_Bot_1"])
      assert.ok(visible(skill.formUnitId, false, true).includes(name), skill.formUnitId + name);
  }
});

test("every prefab has exactly one persistent movement bonus, wired missiles retain native IDs and mortar is one skill", () => {
  for (const p of ART.prefabs)
    assert.equal(p.stats.move, p.sourceStats.tacticalMoveBeforeBonus + 1, p.id);
  const bd = ART.prefabs.find((p) => p.id === "RX_79_BD_1");
  assert.equal(bd.weapons.EF_RX_79_BD_ChestMS_Line.localization.en.name, "Chest Wire-Guided Missiles");
  const tank = ART.prefabs.find((p) => p.id === "RMV_1");
  assert.equal(tank.weapons.Common_MortarDouble.slot, "skill");
  assert.equal(tank.weapons.Common_MortarDouble.special.type, "mortar");
  assert.equal(tank.weapons.Common_MortarDouble.changeHeldWeapon, false);
  assert.ok(!tank.weaponKits.some((k) => k.weapons.includes("Common_MortarDouble_L")));
  assert.equal(tank.weapons.EF_RMV_1_Cannon.special, undefined);
});
