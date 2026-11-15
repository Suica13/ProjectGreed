const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("ordinary ship AA textures preload and no barrage skill is exposed", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(async () => {
    const id = Object.keys(ART.models).find((id) => ART.models[id].prefabId === "SalamisClass");
    const m = ART.models[id],
      w = m.weapons.find((w) => w.rangeRole === "ship_anti_air");
    const keys = SpriteRenderer.battleKeys({ game: { units: [{ model: id }] } });
    await SpriteRenderer.ensureAssets(keys);
    return {
      range: [w.min, w.max],
      skill: m.skills.some((s) => s.id === "ShipAntiAirVolley"),
      loaded: !!SpriteRenderer.images[w.projectile.asset],
    };
  });
  expect(result).toEqual({ range: [1, 2], skill: false, loaded: true });
});
