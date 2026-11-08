const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("normal units, MS, MA, aircraft and ships all use the enlarged map scale", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(async () => {
    Net.leave();
    session++;
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
    game.tiles.forEach((row) => row.fill("plain"));
    game.deployment = null;
    const ids = ["Type61", "RGM_79", "MA_08", "Medea", "PegasusClass"];
    const template = structuredClone(game.units[0]);
    game.units = ids.map((id, index) => {
      const [modelId, model] =
        Object.entries(Rules.models).find(
          ([key, model]) => model.prefabId === id && !model.formOnly,
        ) || [];
      if (!model) throw Error("Missing visual fixture " + id);
      return {
        ...structuredClone(template),
        id: "scale-" + id,
        model: modelId,
        x: 7 + index,
        y: 5,
        hp: model.hp,
        en: model.en,
      };
    });
    await SpriteRenderer.ensureModels(game.units.map((unit) => unit.model));
    phase = "idle";
    pending = moving = battleView = null;
    mode = "select";
    selected = null;
    setPageView("game");
    MapCamera.focus(9, 5);
    update();
    const samples = {},
      original = SpriteRenderer.draw;
    SpriteRenderer.draw = function (...args) {
      const unit = game.units.find((unit) => unit.model === args[1]);
      if (unit) samples[Rules.modelOf(unit).prefabId] = args[4];
      return original.apply(this, args);
    };
    try {
      drawMap(performance.now());
    } finally {
      SpriteRenderer.draw = original;
    }
    return game.units.map((unit) => {
      const model = Rules.modelOf(unit);
      const baseline =
        ((mapGeo.tile / Rules.mapCellPixels) *
          model.presentation.mapScale *
          BattleScene.settings().mapScale) /
        (ART.presentation.mapCellScale || 1);
      return {
        id: model.prefabId,
        factor: samples[model.prefabId] / baseline,
        footprint: model.footprint,
      };
    });
  });
  expect(result).toHaveLength(5);
  for (const row of result) expect(row.factor, row.id).toBeCloseTo(1.5, 6);
  expect(result.find((row) => row.id === "PegasusClass").footprint).toEqual({
    width: 2,
    height: 2,
  });
  await page.screenshot({ path: "tmp/verification/screenshots/compact-battle-scale.png" });
});
