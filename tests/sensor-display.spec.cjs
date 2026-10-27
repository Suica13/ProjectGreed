const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1280, 390])
  test(`preview and battle unit details display sight and detection distances at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript(() => localStorage.setItem("projectgreed.combatFaction", "PMC"));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => {
      I18n.setLanguage("zh");
      Formation.previewUnit("MS_06S");
    });
    await expect(page.locator("#formationDetailStats")).toContainText("视野距离 8 格");
    await expect(page.locator("#formationDetailStats")).toContainText("侦察距离 9.5 格");
    await page.locator("#closeFormationDetail").click();
    const values = await page.evaluate(() => {
      const entry = { unitId: "Type61", kitId: "standard" };
      game = Rules.create(false, 1, [[entry], [entry]], false, {
        costLimit: 99999,
        unitCostLimit: 99999,
      });
      const unit = game.units[0];
      selected = unit.id;
      phase = "idle";
      setPageView("game");
      renderPanel();
      const ranges = Rules.sensors.ranges(unit, game);
      return { sight: formatDistance(ranges.sight), radar: formatDistance(ranges.radar) };
    });
    await expect(page.locator('#unitPanel [data-sensor-range="sight"]')).toContainText(
      values.sight,
    );
    await expect(page.locator('#unitPanel [data-sensor-range="radar"]')).toContainText(
      values.radar,
    );
    const damaged = await page.evaluate(() => {
      const unit = game.units[0];
      unit.brokenParts.head = true;
      renderPanel();
      const ranges = Rules.sensors.ranges(unit, game);
      return { sight: formatDistance(ranges.sight), radar: formatDistance(ranges.radar) };
    });
    await expect(page.locator('#unitPanel [data-sensor-range="sight"]')).toContainText(
      damaged.sight,
    );
    await expect(page.locator('#unitPanel [data-sensor-range="radar"]')).toContainText(
      damaged.radar,
    );
  });
