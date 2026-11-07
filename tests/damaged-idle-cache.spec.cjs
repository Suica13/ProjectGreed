const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");

test("damaged MS idle caches distinguish lost limbs and restore the original silhouette", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(async () => {
    const model = "RGM_79__machine_gun";
    await SpriteRenderer.ensureModels([model]);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 192;
    const ctx = canvas.getContext("2d");
    function render(parts) {
      SpriteRenderer.beginFrame();
      ctx.clearRect(0, 0, 192, 192);
      SpriteRenderer.draw(
        ctx,
        model,
        96,
        96,
        0.6,
        0,
        "Common_Idle",
        0,
        null,
        true,
        true,
        false,
        parts,
        0,
        false,
        false,
        "ground",
        null,
        null,
        false,
        null,
        false,
        false,
        [],
        512,
      );
      let hash = 2166136261;
      for (const value of ctx.getImageData(0, 0, 192, 192).data)
        hash = Math.imul(hash ^ value, 16777619);
      return { hash: hash >>> 0, caches: SpriteRenderer.cacheStats().idle };
    }
    const broken = render({ head: true }),
      missingArm = render({ leftArm: true });
    const restored = render({ head: true });
    return { broken, missingArm, restored, pixels: SpriteRenderer.cacheStats().idlePixels };
  });
  expect(result.broken.caches).toBeGreaterThan(0);
  expect(result.missingArm.caches).toBeGreaterThan(result.broken.caches);
  expect(result.broken.hash).not.toBe(result.missingArm.hash);
  expect(result.restored.hash).toBe(result.broken.hash);
  expect(result.pixels).toBeLessThanOrEqual(16 * 1024 * 1024);
});

test("overlapping parts keep one 25 percent shadow in the damaged idle cache", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    SpriteRenderer.releaseBattleResources();
    const model = "Type61__standard",
      body = document.createElement("canvas");
    body.width = body.height = 20;
    const paint = body.getContext("2d");
    paint.fillStyle = "#fff";
    paint.fillRect(0, 0, 20, 20);
    SpriteRenderer.images["shadow-opacity-probe"] = body;
    Object.assign(SpriteRenderer.models[model], {
      bones: { root: { x: 0, y: 0, parent: null, dir: 0 } },
      animations: { Probe: { duration: 1, curves: {} } },
      decals: [0, 1, 2].map((i) => ({
        name: "part" + i,
        bone: "root",
        asset: "shadow-opacity-probe",
      })),
    });
    ClientSettings.unitShadows = () => true;
    globalThis.ProjectGreedMapLighting = {
      enabled: true,
      direction: "lower",
      horizontalAngle: 0,
      distance: 2,
      intensity: 0.25,
    };
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 500;
    const ctx = canvas.getContext("2d");
    function measure(raster) {
      SpriteRenderer.beginFrame();
      ctx.clearRect(0, 0, 500, 500);
      SpriteRenderer.draw(
        ctx,
        model,
        250,
        250,
        1,
        0,
        "Probe",
        0,
        null,
        true,
        true,
        false,
        { head: true },
        0,
        false,
        false,
        "ground",
        null,
        null,
        false,
        null,
        false,
        false,
        [],
        raster,
      );
      const data = ctx.getImageData(0, 0, 500, 500).data;
      let max = 0,
        count = 0;
      for (let i = 0; i < data.length; i += 4)
        if (data[i] < 5 && data[i + 1] < 5 && data[i + 2] < 5 && data[i + 3]) {
          max = Math.max(max, data[i + 3]);
          count++;
        }
      return { max, count };
    }
    return { direct: measure(0), cached: measure(1024), caches: SpriteRenderer.cacheStats().idle };
  });
  for (const row of [result.direct, result.cached]) {
    expect(row.max).toBeGreaterThanOrEqual(63);
    expect(row.max).toBeLessThanOrEqual(65);
    expect(row.count).toBeGreaterThan(100);
  }
  expect(result.caches).toBeGreaterThan(0);
});
