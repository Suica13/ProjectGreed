const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("workshop forms, family outfit textures, Blitz PS states and simultaneous Big Zam ports render", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(async () => {
    const all = UnitCatalog.select("", {}, () => true).map((p) => p.id);
    const ids = [
      "GAT_X207__standard",
      "GAT_X105__standard",
      "GAT_X105__variant_GAT_X105_L",
      "MA_08__standard",
    ];
    await SpriteRenderer.ensureModels(ids);
    await SpriteRenderer.ensureAssets(
      Object.entries(ART.effects)
        .filter(([id]) => id.startsWith("Irradiation_"))
        .map(([, effect]) => effect.asset),
    );
    const layers = (id, ps = true) =>
      SpriteRenderer.visibleLayers(
        id,
        null,
        true,
        false,
        "Common_Idle",
        0,
        true,
        {},
        false,
        false,
        "ground",
        null,
        null,
        false,
        false,
        ps,
      );
    const on = layers(ids[0]),
      off = layers(ids[0], false);
    const base = layers(ids[1]).map((l) => l.texture),
      launcher = layers(ids[2]).map((l) => l.texture);
    Net.leave();
    game = Rules.create(
      false,
      17,
      [[{ unitId: "MA_08", kitId: "standard" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { costLimit: 99999, unitCostLimit: 99999, fogMode: "disabled" },
    );
    game.deployment = null;
    game.tiles.forEach((r) => r.fill("plain"));
    const a = game.units[0];
    Object.assign(a, { x: 8, y: 8 });
    Object.assign(game.units[1], { x: 10, y: 8 });
    const event = Rules.useSkill(game, a, "AllRoundBeam", a.x, a.y);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 700;
    const ctx = canvas.getContext("2d"),
      draw = ctx.drawImage.bind(ctx);
    let count = 0,
      captures = 0;
    ctx.drawImage = (...args) => {
      count++;
      draw(...args);
    };
    const capture = MapEffects.capture;
    MapEffects.capture = () => {
      captures++;
    };
    try {
      IrradiationFX.reset();
      IrradiationFX.start(event);
      const pos = (x, y) => ({ x: x * 30, y: y * 30 });
      IrradiationFX.draw(ctx, 0, pos, 30);
      count = 0;
      IrradiationFX.draw(ctx, 600, pos, 30);
    } finally {
      MapEffects.capture = capture;
      IrradiationFX.reset();
    }
    return {
      all,
      on: on.map((l) => l.texture),
      off: off.map((l) => l.texture),
      opaque: [...on, ...off]
        .filter((l) => l.visibleWhen?.phaseShiftActive !== undefined)
        .every((l) => (l.alpha ?? 1) === 1),
      base,
      launcher,
      count,
      captures,
    };
  });
  expect(result.all).toContain("RGZ_91_MA");
  expect(result.all).not.toContain("RGZ_91");
  expect(result.all).toContain("RGZ_91B");
  expect(result.all).not.toContain("RGZ_91B_MA");
  expect(result.all).not.toContain("RX_81ST");
  expect(result.all).not.toContain("GAT_X105_L");
  expect(result.opaque).toBeTruthy();
  expect(result.on.some((t) => t.startsWith("PS__"))).toBeTruthy();
  expect(result.on.some((t) => t.startsWith("NoPS__"))).toBeFalsy();
  expect(result.off.some((t) => t.startsWith("NoPS__"))).toBeTruthy();
  expect(result.off.some((t) => t.startsWith("PS__"))).toBeFalsy();
  expect(result.base).not.toEqual(result.launcher);
  expect(result.count).toBe(14 * 3);
  expect(result.captures).toBe(1);
  expect(errors).toEqual([]);
});
