const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("map renders stationary aircraft thrust and all stationary space units without startup flashes", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const samples = await page.evaluate(async () => {
    await SpriteRenderer.load();
    Net.leave();
    game = Rules.create(false, 1, [
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
    ]);
    const u = game.units[0];
    game.units[1].hp = 0;
    Object.assign(u, { x: 10, y: 10, acted: true, moved: true });
    selected = null;
    phase = "idle";
    mode = "select";
    setPageView("game");
    const ctx = byId("map").getContext("2d"),
      original = ctx.drawImage,
      samples = [];
    const burst = SpriteRenderer.images[ART.effects.Boost_Start.asset];
    try {
      for (const id of ["RGM_79", "FF_X7", "Type61", "SalamisClass"]) {
        u.model = Object.keys(UnitModels).find((k) => UnitModels[k].prefabId === id);
        const layer = SpriteRenderer.models[u.model].decals.find((l) =>
            UnitModels[u.model].ship ? l.visibleWhen?.thrustActive : l.visibleWhen?.sustainedThrust,
          ),
          image = SpriteRenderer.images[layer.asset];
        for (const environment of ["ground", "space"]) {
          game.environment = u.environment = environment;
          let loops = 0,
            starts = 0;
          ctx.drawImage = function (img, ...args) {
            if (img === image) loops++;
            if (img === burst) starts++;
            return original.call(this, img, ...args);
          };
          drawMap(performance.now());
          samples.push({ id, environment, loops, starts });
        }
      }
    } finally {
      ctx.drawImage = original;
    }
    return samples;
  });
  for (const s of samples) {
    expect(s.starts).toBe(0);
    expect(s.loops).toBe(s.environment === "space" || s.id === "FF_X7" ? 1 : 0);
  }
  expect(errors).toEqual([]);
});
