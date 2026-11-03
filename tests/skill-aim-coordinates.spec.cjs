const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("mortar and nuclear shots reach the selected map cell in all four directions", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const cases = await page.evaluate(() => {
    const output = [];
    for (const kind of ["mortar", "nuke"])
      for (const [dx, dy] of [[5, 0], [-5, 0], [0, 5], [0, -5]]) {
        const model = Object.values(UnitModels).find(m => m.weapons.some(w =>
          kind === "mortar" ? w.projectile?.motion === "mortar" : w.special?.type === "nuke"));
        const weapon = model.weapons.find(w =>
          kind === "mortar" ? w.projectile?.motion === "mortar" : w.special?.type === "nuke");
        const angle = Math.atan2(dx, -dy) * 180 / Math.PI;
        const source = {
          x: 10.5 * Rules.mapCellPixels, y: 10.5 * Rules.mapCellPixels,
          angle, aimAngle: angle, scale: 1,
          unit: { id: "source", model: model.prefabId + "__" + model.kitId, angle, aimAngle: angle },
        };
        const impactCell = { x: 10 + dx, y: 10 + dy };
        const expected = {
          x: (impactCell.x + .5) * Rules.mapCellPixels,
          y: (impactCell.y + .5) * Rules.mapCellPixels,
        };
        // The selected cell, rather than a victim's formation/dodge offset, is authoritative.
        const target = { x: expected.x + 40, y: expected.y - 25, scale: 1,
          unit: { id: "target", model: source.unit.model } };
        const plan = WeaponEffects.plan(weapon, source, target,
          { impactCell, hit: true, damage: 100, targetDodgeSlot: 1 });
        output.push({ kind, expected, blast: plan.blastPoint,
          shots: plan.shots.map(s => s.destination) });
      }
    return output;
  });
  expect(cases).toHaveLength(8);
  for (const item of cases) {
    expect(item.blast).toEqual(item.expected);
    for (const destination of item.shots) expect(destination).toEqual(item.expected);
  }
});
