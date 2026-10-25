const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("a formation can pass 12 units, save, reopen and survive reload", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(() => {
    localStorage.setItem(
      "slg-formations-v1",
      JSON.stringify([
        {
          name: "大编组",
          units: Array.from({ length: 12 }, (_, i) => ({
            unitId: "RGM_79",
            kitId: "machine_gun",
            customName: "机体" + i,
          })),
        },
      ]),
    );
    localStorage.setItem("slg-formations-v1-active", "0");
  });
  await page.reload();
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator('.catalog-unit[data-unit-id="RGM_79"]').click();
  await page.locator("#addFormationUnit").click();
  await page.locator("#closeFormationPicker").click();
  await expect(page.locator(".formation-row")).toHaveCount(13);
  await page.locator("#saveFormation").click();
  await page.locator("#openFormation").click();
  await expect(page.locator(".formation-row")).toHaveCount(13);
  await page.reload();
  await page.locator("#openFormation").click();
  await expect(page.locator(".formation-row")).toHaveCount(13);
  expect(errors).toEqual([]);
});
