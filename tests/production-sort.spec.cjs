const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const width of [1280, 390])
  test(`production search layout and shared sorting at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#openProduction").click();
    await expect(page.locator("#productionSort")).toHaveCount(0);
    const filters = await page.locator(".production-filters").boundingBox();
    const search = await page.locator("#productionSearch").boundingBox();
    expect(filters.y + filters.height).toBeLessThanOrEqual(search.y);
    expect(search.x + search.width).toBeLessThanOrEqual(width);
    const cards = page.locator("#productionList .production-unit");
    const values = await cards.evaluateAll((nodes) =>
      nodes.map((node) => {
        const p = Rules.catalog.prefabs.find((p) => p.id === node.dataset.unitId);
        return {
          faction: p.faction,
          cost: Math.min(...p.weaponKits.map((k) => p.stats.cost + k.cost)),
        };
      }),
    );
    expect(values).toEqual(
      [...values].sort((a, b) => a.faction.localeCompare(b.faction, "en") || a.cost - b.cost),
    );
    await page.locator("#productionFaction").selectOption("ZEON");
    expect(
      await cards.evaluateAll((cards) =>
        cards.every(
          (card) =>
            Rules.catalog.prefabs.find((p) => p.id === card.dataset.unitId).faction === "ZEON",
        ),
      ),
    ).toBe(true);
    await page.locator("#productionSearch").fill("MS_06F");
    expect(await cards.count()).toBeGreaterThan(0);
    expect(
      await cards.evaluateAll((cards) =>
        cards.every((card) => card.dataset.unitId.toLowerCase().includes("ms_06f")),
      ),
    ).toBe(true);
    await expect(page.locator("#productionSort")).toHaveCount(0);
  });

test("default faction sorting prioritizes the active faction in production and formation", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  for (const faction of ["ZEON", "EFSF", "PMC"]) {
    await page.locator("#menuFactionSelect").selectOption(faction);
    await page.locator("#openProduction").click();
    await expect(page.locator("#productionSort")).toHaveCount(0);
    const firstFaction = async (selector) =>
      page
        .locator(selector)
        .first()
        .evaluate(
          (card) => Rules.catalog.prefabs.find((p) => p.id === card.dataset.unitId).faction,
        );
    expect(await firstFaction("#productionList .production-unit")).toBe(
      faction === "PMC" ? "EFSF" : faction,
    );
    await page.locator("#closeProduction").click();
    await page.locator("#openFormation").click();
    await page.locator("#openFormationPicker").click();
    await page.locator("#formationStock").selectOption("all");
    await expect(page.locator("#formationSort")).toHaveCount(0);
    expect(await firstFaction("#formationCatalog .catalog-unit")).toBe(
      faction === "PMC" ? "EFSF" : faction,
    );
    await page.locator("#closeFormationPicker").click();
    await page.locator("#saveFormation").click();
  }
});
