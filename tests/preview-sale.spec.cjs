const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
for (const width of [1280, 390]) test(`preview production and half-price sale fit ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await page.addInitScript(() => localStorage.setItem("projectgreed.economy.v1", JSON.stringify({
    schemaVersion: 3, money: 100000, supplies: 100000, licenses: { Type61: true }, inventory: { Type61: 2 }, kits: {},
  })));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => { I18n.setLanguage("zh"); ProductionUI.openUnit("Type61"); });
  async function checkRow(priceSelector, produceSelector, sellSelector) {
    const price = await page.locator(priceSelector).boundingBox();
    const produce = await page.locator(produceSelector).boundingBox();
    const sell = await page.locator(sellSelector).boundingBox();
    expect(price.x + price.width).toBeLessThanOrEqual(produce.x + 1);
    expect(produce.x + produce.width).toBeLessThanOrEqual(sell.x + 1);
    expect(sell.x + sell.width).toBeLessThanOrEqual(width);
    expect(Math.abs(produce.y + produce.height / 2 - sell.y - sell.height / 2)).toBeLessThan(2);
  }
  await expect(page.locator("#produceUnit")).toBeVisible();
  await checkRow("#productionPrice", "#produceUnit", "#sellProductionUnit");
  const before = await page.evaluate(() => ({ stock: Economy.quantity("Type61"), money: Economy.snapshot().money,
    supplies: Economy.snapshot().supplies, price: Economy.unitOffer("Type61") }));
  await page.locator("#sellProductionUnit").click();
  await expect(page.locator("#gameDialog")).toBeVisible();
  await page.locator("#gameDialog").getByRole("button", { name: "取消", exact: true }).click();
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(before.stock);
  await page.locator("#sellProductionUnit").click();
  await page.locator("#gameDialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Economy.quantity("Type61"))).toBe(before.stock - 1);
  expect(await page.evaluate(() => Economy.snapshot().money)).toBe(before.money + Math.floor(before.price.money / 2));
  expect(await page.evaluate(() => Economy.snapshot().supplies)).toBe(before.supplies + Math.floor(before.price.supplies / 2));
  await page.evaluate(() => Formation.previewUnit("Type61"));
  await checkRow("#formationInventorySale .resource-balance", "#producePreviewUnit", "#sellPreviewUnit");
  await page.locator("#sellPreviewUnit").click();
  await page.locator("#gameDialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect.poll(() => page.evaluate(() => Economy.quantity("Type61"))).toBe(0);
  await expect(page.locator("#sellPreviewUnit")).toBeDisabled();
  expect(await page.evaluate(() => Economy.hasLicense("Type61"))).toBe(true);
  await page.screenshot({ path: `tmp/verification/screenshots/preview-sale-${width}.png` });
});
