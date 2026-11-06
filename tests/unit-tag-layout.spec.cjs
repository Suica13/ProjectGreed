const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const defaultKit = require("../shared/production-data.cjs").defaultKits.Type74;
async function open(page) {
  await page.addInitScript((kit) => {
    localStorage.setItem(
      "slg-formations-v1.PMC",
      JSON.stringify({
        version: 3,
        squads: [{ name: "标签检查", units: [{ unitId: "Type74", kitId: kit }] }],
      }),
    );
    localStorage.setItem(
      "projectgreed.economy.v1",
      JSON.stringify({
        schemaVersion: 3,
        money: 10000,
        supplies: 20000,
        licenses: { Type74: true },
        inventory: { Type74: 1 },
        kits: { ["Type74__" + kit]: 1 },
      }),
    );
  }, defaultKit);
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => typeof assetsReady !== "undefined" && assetsReady);
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    MenuShell.go("encyclopedia");
  });
}
for (const width of [1440, 390])
  test(`ordered and bounded catalog tags with a complete panel at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await open(page);
    await page.locator("#encyclopediaSearch").fill("RGC_80");
    const common = page.locator('#encyclopediaList [data-unit-id="RGC_80"]');
    await expect(common).toBeVisible();
    expect(
      await common.locator("[data-tag]").evaluateAll((tags) => tags.map((t) => t.dataset.tag)),
    ).toEqual(["EFSF", "AEUG", "TITANS", "0079L", "ground", "space", "mediumUnit", "MS"]);
    await expect(common.locator(".ground")).toHaveText("地面");
    await expect(common.locator(".cost")).toHaveCount(1);
    await expect(common.locator(".unit-tags-more")).toHaveCount(0);
    await page.locator("#encyclopediaSearch").fill("Type74");
    const carrier = page.locator('#encyclopediaList [data-unit-id="Type74"]');
    await expect(carrier.locator("[data-tag]")).toHaveCount(8);
    await expect(carrier.locator(".cost")).toBeVisible();
    await expect(carrier.locator(".space")).toContainText("%");
    await carrier.screenshot({path: `.openai/unit-tag-card-${width}.png`});
    await carrier.locator(".unit-tags-more").click();
    const dialog = page.locator("#unitTagsDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-tag]")).toHaveCount(9);
    await expect(dialog.locator('[data-tag="Transport"]')).toBeVisible();
    await dialog.screenshot({path: `.openai/unit-tag-panel-${width}.png`});
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(carrier.locator(".unit-tags-more")).toBeFocused();
    const geometry = await carrier.evaluate((card) => ({
      overflow: card.scrollWidth > card.clientWidth,
      count: card.querySelectorAll("[data-tag]").length,
    }));
    expect(geometry.overflow).toBe(false);
    expect(errors).toEqual([]);
  });

test("formation and workshop share the eight-tag budget and nested more buttons do not select a unit", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  await page.evaluate(() => MenuShell.go("formation"));
  const row = page.locator("#formationUnits > .formation-row").first();
  await expect(row.locator("[data-tag]")).toHaveCount(8);
  await expect(row.locator(".cost")).toHaveCount(1);
  await row.locator(".unit-tags-more").click();
  await expect(page.locator("#unitTagsDialog [data-tag]")).toHaveCount(10);
  await page.locator("#unitTagsDialog").getByRole("button", { name: "关闭", exact: true }).click();
  await page.locator("#openFormationPicker").click();
  await page.locator("#formationSearch").fill("Type");
  await page.locator('#formationCatalog [data-unit-id="Type61"]').click();
  const pickerValue = await page.locator("#formationPrefab").inputValue();
  const pickerCarrier = page.locator('#formationCatalog [data-unit-id="Type74"]');
  await expect(pickerCarrier.locator("[data-tag]")).toHaveCount(8);
  await pickerCarrier.locator(".unit-tags-more").click();
  await expect(page.locator("#unitTagsDialog")).toBeVisible();
  expect(await page.locator("#formationPrefab").inputValue()).toBe(pickerValue);
  await page.keyboard.press("Escape");
  await page.locator("#closeFormationPicker").click();
  await page.evaluate(() => MenuShell.go("production"));
  await page.locator("#productionSearch").fill("Type");
  await page.locator('#productionList [data-unit-id="Type61"]').click();
  const selected = await page.locator("#productionUnitName").textContent();
  const carrier = page.locator('#productionList [data-unit-id="Type74"]');
  await expect(carrier.locator("[data-tag]")).toHaveCount(8);
  await carrier.locator(".unit-tags-more").click();
  await expect(page.locator("#unitTagsDialog")).toBeVisible();
  expect(await page.locator("#productionUnitName").textContent()).toBe(selected);
  await expect(carrier).toHaveAttribute("aria-selected", "false");
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
