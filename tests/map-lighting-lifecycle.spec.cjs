const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");

test("fresh scenes start at their own lighting and constant light does not generate floating point cache variants", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(async () => {
    Net.leave();
    const entry = { unitId: "Type61", kitId: "standard" };
    game = Rules.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
    game.deployment = null;
    game.ai = false;
    game.climateSettings = { weather: "clear", dayNight: "noon" };
    Rules.getMap(game.mapId).lighting = {
      distance: 0.13,
      intensity: 0.37,
      horizontalAngle: -47,
      enabled: true,
    };
    globalThis.ProjectGreedMapLighting = { intensity: 0.01, distance: 10, horizontalAngle: 60 };
    globalThis.ProjectGreedLightTransition = { key: "old-scene" };
    resetMapPresentation();
    const cleared = !globalThis.ProjectGreedMapLighting && !globalThis.ProjectGreedLightTransition;
    await SpriteRenderer.ensureModels(game.units.map((unit) => unit.model));
    phase = "idle";
    selected = moving = battleView = null;
    setPageView("game");
    MapCamera.reset();
    const values = [];
    for (const now of [1000, 1107, 1309, 1553, 1791, 2102, 2501, 2800]) {
      drawMap(now);
      const light = globalThis.ProjectGreedMapLighting;
      values.push([light.distance, light.intensity, light.horizontalAngle]);
    }
    resetMapPresentation();
    return {
      cleared,
      values,
      released: !globalThis.ProjectGreedMapLighting && !globalThis.ProjectGreedLightTransition,
    };
  });
  expect(result.cleared && result.released).toBe(true);
  for (const row of result.values) expect(row).toEqual(result.values[0]);
  expect(result.values[0][1]).toBe(0.37);
});
