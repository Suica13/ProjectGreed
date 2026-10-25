const { test, expect } = require("@playwright/test");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("ended-action E stays above the health bar right edge at every zoom and is hidden throughout playback", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  const result = await page.evaluate(() => {
    const unit = game.units[0];
    game.units.forEach((u) => (u.acted = false));
    unit.acted = true;
    const ctx = byId("map").getContext("2d"),
      fillText = ctx.fillText,
      fillRect = ctx.fillRect,
      samples = [];
    let markers = [],
      bars = [];
    ctx.fillText = function (text, x, y, ...rest) {
      if (text === "E" && this.fillStyle === "#efd568") {
        const m = this.measureText(text);
        markers.push({
          right: x + m.actualBoundingBoxRight,
          bottom: y + m.actualBoundingBoxDescent,
          font: this.font,
        });
      }
      return fillText.call(this, text, x, y, ...rest);
    };
    ctx.fillRect = function (x, y, w, h) {
      if (this.fillStyle === "#07141c" && h === 4) bars.push({ right: x + w, top: y });
      return fillRect.call(this, x, y, w, h);
    };
    try {
      for (const zoom of [1, 3, 5]) {
        MapCamera.setZoom(zoom);
        markers = [];
        bars = [];
        drawMap(performance.now());
        samples.push({ zoom, markers, bars });
      }
      phase = "battle";
      markers = [];
      drawMap(performance.now());
      const beforeFrame = markers.length;
      phase = "idle";
      battleView = { mapBattle: true };
      markers = [];
      drawMap(performance.now());
      const playback = markers.length;
      battleView = null;
      phase = "idle";
      markers = [];
      drawMap(performance.now());
      return { samples, beforeFrame, playback, restored: markers.length };
    } finally {
      ctx.fillText = fillText;
      ctx.fillRect = fillRect;
    }
  });
  for (const sample of result.samples) {
    expect(sample.markers).toHaveLength(1);
    const e = sample.markers[0],
      bar = sample.bars[0];
    expect(bar.right - e.right).toBeGreaterThanOrEqual(0);
    expect(bar.right - e.right).toBeLessThanOrEqual(2);
    expect(bar.top - e.bottom).toBeGreaterThanOrEqual(1);
    expect(bar.top - e.bottom).toBeLessThanOrEqual(3);
    expect(e.font).toContain("11px");
  }
  expect(result.beforeFrame).toBe(0);
  expect(result.playback).toBe(0);
  expect(result.restored).toBe(1);
  await page.evaluate(() => {
    const u = game.units[0],
      c = Rules.center(u);
    MapCamera.focus(c.x, c.y, { preserveZoom: true });
  });
  await page.screenshot({ path: ".openai/action-marker-right-edge.png" });
  expect(errors).toEqual([]);
});
