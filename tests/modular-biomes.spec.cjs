const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
test("all modular biomes load and render their actual terrain layers", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellSettings").waitFor({ state: "visible" });
  const results = await page.evaluate(async () => {
    const painter = TileMapView.create();
    for (const id of ["tropical", "temperate", "desert", "snow", "urban", "space"])
      painter.image("asset:biome-" + id);
    await new Promise((resolve, reject) => {
      let n = 0;
      const check = () => {
        if (
          ["tropical", "temperate", "desert", "snow", "urban", "space"].every((id) =>
            painter.image("asset:biome-" + id),
          )
        )
          resolve();
        else if (n++ > 300) reject(Error("atlas load timed out"));
        else setTimeout(check, 20);
      };
      check();
    });
    const ids = [
      "serpentine_rainforest_3v3",
      "coastal_supply_2v2",
      "frontier_1v1",
      "open_dunes_1v1",
      "crossroads_2v2",
      "asteroid_crossing_1v1",
      "battlefield_frontline",
      "battlefield_twin_ridges",
      "battlefield_ruined_basin",
    ];
    document.body.style.cssText = "background:#111;display:block;overflow:auto";
    const results = [];
    for (const id of ids) {
      const m = Rules.getMap(id),
        c = document.createElement("canvas");
      c.id = id;
      c.width = m.width * 24;
      c.height = m.height * 24;
      c.style.cssText = "position:fixed;inset:0;z-index:999999;background:#111";
      document.body.append(c);
      painter.draw(c.getContext("2d"), m.tileMap, "below", {
        ox: 0,
        oy: 0,
        cellWidth: 24,
        cellHeight: 24,
        width: c.width,
        height: c.height,
      });
      const colors = new Set(),
        p = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let opaque = 0;
      for (let i = 0; i < p.length; i += 4) {
        if (p[i + 3] === 255) opaque++;
        if (i % 100 === 0) colors.add(p[i] + "," + p[i + 1] + "," + p[i + 2]);
      }
      results.push({ id, colors: colors.size, opaque: opaque / (p.length / 4) });
    }
    return results;
  });
  for (const r of results) {
    expect(r.opaque, r.id).toBe(1);
    // The tactical style deliberately uses fewer colours and broad silhouettes.
    // Still require multiple terrain/edge colours rather than a flat placeholder.
    expect(r.colors, r.id).toBeGreaterThan(20);
    await page.evaluate((id) => {
      document.querySelectorAll("canvas").forEach((c) => {
        if (c.id) c.style.display = c.id === id ? "block" : "none";
      });
    }, r.id);
    await page
      .locator("#" + r.id)
      .screenshot({ path: "tmp/verification/screenshots/biome-" + r.id + ".png" });
  }
  expect(errors).toEqual([]);
});

test("clean terrain and decoration variants are stable and visibly distinct", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const results = await page.evaluate(() => {
    const sheet = document.createElement("canvas");
    sheet.id = "terrainVariants";
    sheet.width = 552;
    sheet.height = 480;
    sheet.style.cssText = "position:fixed;inset:0;z-index:999999";
    document.body.append(sheet);
    const target = sheet.getContext("2d");
    target.fillStyle = "#142632";
    target.fillRect(0, 0, 552, 480);
    return ["plain", "forest", "rock", "rubble", "water", "details"].map((role, row) => {
      const signatures = new Set();
      let stable = true;
      target.fillStyle = "#dcebf2";
      target.font = "14px sans-serif";
      target.fillText(role, 8, row * 80 + 36);
      for (let x = 0; x < 500 && signatures.size < 6; x++) {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext("2d");
        const paint = () => {
          ctx.clearRect(0, 0, 64, 64);
          BiomeTiles.drawAtlasTile(
            ctx,
            null,
            { biomeRole: role },
            { image: "asset:biome-temperate" },
            0,
            0,
            64,
            64,
            x,
            7,
          );
        };
        paint();
        const signature = canvas.toDataURL();
        if (!ctx.getImageData(0, 0, 64, 64).data.some((v, i) => i % 4 === 3 && v > 0)) continue;
        paint();
        stable &&= canvas.toDataURL() === signature;
        if (signatures.has(signature)) continue;
        target.drawImage(canvas, 120 + signatures.size * 72, row * 80 + 6);
        signatures.add(signature);
      }
      return { role, count: signatures.size, stable };
    });
  });
  for (const r of results) {
    expect(r.count, r.role).toBe(6);
    expect(r.stable, r.role).toBe(true);
  }
  await page
    .locator("#terrainVariants")
    .screenshot({ path: "tmp/verification/screenshots/terrain-variants-shadows.png" });
});
