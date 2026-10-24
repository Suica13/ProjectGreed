const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const { openPresentationFixture } = require("./presentation-fixture.cjs");

test("deployment confirmation occupies end-turn position and switches only after both teams confirm", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#endTurn")).toBeHidden();
  await openPresentationFixture(page, false);
  await expect(page.locator("#confirmDeployment")).toBeVisible();
  await expect(page.locator("#endTurn")).toBeHidden();
  const before = await page.locator("#confirmDeployment").boundingBox();
  expect(
    await page
      .locator("#confirmDeployment")
      .evaluate((el) => el.parentElement.classList.contains("phase-row")),
  ).toBe(true);
  await page.locator("#confirmDeployment").click();
  await expect(page.locator("#endTurn")).toBeHidden();
  await page.locator("#confirmDeployment").click();
  await expect(page.locator("#confirmDeployment")).toBeHidden();
  await expect(page.locator("#endTurn")).toBeVisible();
  const after = await page.locator("#endTurn").boundingBox();
  expect(Math.abs(before.x + before.width - after.x - after.width)).toBeLessThan(2);
  expect(await page.evaluate(() => phase)).toBe("idle");
});
