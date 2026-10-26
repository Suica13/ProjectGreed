const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("weapon details show attack steps, target multipliers and unit size", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(url);
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('[data-detail-unit-id="RGM_79"]').click();
  const card = page.locator("#formationDetailSlots .formation-weapon-detail").first();
  await expect(card).toBeVisible();
  await expect(page.locator("#formationDetailTags .unit-size-tag")).toHaveText("中型");
  await expect(card.locator(":scope > .weapon-effect-tags .weapon-effect-tag")).toHaveCount(4);
  await expect(card.locator(".weapon-effect-tag").first()).toContainText("伤/命");
  await card.locator(".weapon-inspector summary").click();
  await expect(card.locator(".weapon-flow li").first()).toBeVisible();
  await expect(card.locator(".weapon-inspector .weapon-effect-tag")).toHaveCount(7);
  await page.screenshot({ path: ".openai/weapon-inspection.png" });
  expect(errors).toEqual([]);
});
