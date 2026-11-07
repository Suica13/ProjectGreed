const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("surface cover is rasterized once across zooms, invalidates by round and skips empty accumulation", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    let reads = 0;
    globalThis.MapDocument = { terrains: {} };
    MapDocument.terrains.cacheProbe = {
      get cover() {
        reads++;
        return { snow: 1, wet: 1, dust: 1 };
      },
    };
    const map = {
      id: "cover-cache-probe",
      width: 64,
      height: 64,
      environment: "ground",
      surfaceCover: true,
      tiles: Array.from({ length: 64 }, () => Array(64).fill("cacheProbe")),
      climate: {
        weather: { allowed: ["snow"], weights: { snow: 1 }, fixed: true },
        time: { allowed: ["noon"], fixed: true },
      },
    };
    const canvas = document.createElement("canvas");
    canvas.width = 600;
    canvas.height = 400;
    const ctx = canvas.getContext("2d");
    let images = 0;
    const image = ctx.drawImage.bind(ctx);
    ctx.drawImage = (...args) => {
      images++;
      return image(...args);
    };
    for (let i = 0; i < 60; i++)
      BattlefieldWeather.draw(ctx, 600, 400, 1000, map, {}, 1, 1, {
        tile: 4 + i * 0.1,
        ox: -i,
        oy: 0,
      });
    const initial = { reads, images };
    BattlefieldWeather.draw(ctx, 600, 400, 1000, map, {}, 2, 1, { tile: 10, ox: 0, oy: 0 });
    const next = { reads, images };
    BattlefieldWeather.draw(ctx, 600, 400, 1000, map, { surfaceCover: false }, 2, 1, {
      tile: 10,
      ox: 0,
      oy: 0,
    });
    const disabled = { reads, images };
    const clear = {
      ...map,
      id: "empty-cover-probe",
      climate: {
        ...map.climate,
        weather: { allowed: ["clear"], weights: { clear: 1 }, fixed: true },
      },
    };
    BattlefieldWeather.draw(ctx, 600, 400, 1000, clear, {}, 1, 1, { tile: 10, ox: 0, oy: 0 });
    return { initial, next, disabled, empty: { reads, images } };
  });
  expect(result.initial).toEqual({ reads: 4096, images: 60 });
  expect(result.next).toEqual({ reads: 8192, images: 61 });
  expect(result.disabled).toEqual(result.next);
  expect(result.empty).toEqual(result.next);
});
