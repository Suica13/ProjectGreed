const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("formation rows and catalog show native Rick Dom icon and all three adaptation labels", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openFormation").click();
  for (const [id, label] of [
    ["MS_09R", "宇宙"],
    ["MS_09", "地面"],
    ["RGM_79", "地面/宇宙"],
  ]) {
    const card = page.locator(`[data-unit-id="${id}"]`);
    await expect(card.locator("small")).toContainText(label);
    expect(await card.locator("img").evaluate((img) => img.complete && img.naturalWidth > 0)).toBe(
      true,
    );
    await card.click();
    await page.locator("#addFormationUnit").click();
    const row = page.locator(".formation-row").last();
    await expect(row.locator(".formation-row-kit")).toHaveText(
      new RegExp(`COST [0-9]+ · ${label}$`),
    );
    if (id === "MS_09R") {
      await row.click();
      await expect(page.locator("#formationDetailStats")).toContainText("反应系数 110");
      await expect(page.locator("#formationDetailStats")).toContainText("命中系数 115%");
      await page.evaluate(() => I18n.setLanguage("en"));
      await expect(page.locator("#formationDetailStats")).toContainText("Accuracy multiplier 115%");
      await page.evaluate(() => I18n.setLanguage("zh"));
      await expect(page.locator("#formationDetailStats")).toContainText("地面适应性 50%");
      await expect(page.locator("#formationDetailStats")).toContainText("宇宙适应性 100%");
      await page.locator("#formationDetailKit").selectOption("machine_gun");
      await page.locator("#closeFormationDetail").click();
      await expect(row.locator(".formation-row-kit")).toHaveText(/COST 475 · 宇宙$/);
    }
  }
  await page.evaluate(() => I18n.setLanguage("en"));
  await expect(page.locator('[data-unit-id="MS_09R"]')).toContainText("Space");
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.screenshot({ path: ".openai/rick-dom-formation.png" });
  expect(errors).toEqual([]);
});
