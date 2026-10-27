const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function production(page) {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openProduction").click();
  await page.locator("#productionSearch").fill("Type61");
  await page.locator('#productionList [data-unit-id="Type61"]').click();
}
test("early production inventory is backed up and migrated before producing again", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("legacy-stock-seeded")) return;
    localStorage.setItem("legacy-stock-seeded", "yes");
    localStorage.setItem(
      "projectgreed.economy.v1",
      JSON.stringify({ money: 4321, supplies: 8765, inventory: { Type61__standard: 3 } }),
    );
  });
  await production(page);
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(3);
  expect(await page.evaluate(() => Economy.snapshot().money)).toBe(4321);
  await page.locator("#produceUnit").click();
  await expect(page.locator("#productionStatus")).toContainText("生产完成");
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(6);
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem(Economy.key + ".before-unit-inventory")).inventory,
    ),
  ).toEqual({ Type61__standard: 3 });
  await page.reload();
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(6);
});
test("preview storage restrictions report the actual cause without changing money or stock", async ({
  page,
}) => {
  await production(page);
  const before = await page.evaluate(() => Economy.snapshot());
  await page.evaluate(() => {
    window.originalStorageWrite = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key === Economy.key) throw new DOMException("Preview storage denied", "SecurityError");
      return window.originalStorageWrite.call(this, key, value);
    };
  });
  await page.locator("#produceUnit").click();
  await expect(page.locator("#productionStatus")).toContainText("当前预览禁止访问本地存储");
  expect(await page.evaluate(() => Economy.snapshot())).toEqual(before);
  await page.evaluate(() => (Storage.prototype.setItem = window.originalStorageWrite));
  await page.locator("#produceUnit").click();
  await expect(page.locator("#productionStatus")).toContainText("生产完成");
});
test("a preview rendering exception after saving never falsely reports failed production", async ({
  page,
}) => {
  await production(page);
  const before = await page.evaluate(() => Economy.quantity("Type61"));
  await page.evaluate(
    () =>
      (Formation.renderPreview = () => {
        throw Error("preview-render-test");
      }),
  );
  await page.locator("#produceUnit").click();
  await expect(page.locator("#productionStatus")).toContainText("生产完成");
  await expect(page.locator("#productionStatus")).toContainText(
    "界面刷新失败：preview-render-test",
  );
  expect(await page.evaluate(() => Economy.quantity("Type61"))).toBe(before + 3);
});
