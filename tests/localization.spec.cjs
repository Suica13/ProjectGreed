const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
test("browser environment selects Japanese or English and unsupported locales fall back to English", async ({
  browser,
}) => {
  for (const [locale, expected, label] of [
    ["ja-JP", "ja", "サーバーに接続"],
    ["en-US", "en", "Connect to server"],
    ["fr-FR", "en", "Connect to server"],
    ["zh-TW", "zh-CN", "连接服务器"],
  ]) {
    const context = await browser.newContext({ locale });
    try {
      const page = await context.newPage();
      await page.goto(url);
      await expect(page.locator("#openRooms")).toHaveText(label);
      expect(await page.locator("html").getAttribute("lang")).toBe(expected);
      await expect(page.locator("#languageSwitch button")).toHaveCount(3);
      await expect(page.locator("#languageSwitch svg")).toHaveCount(3);
    } finally {
      await context.close();
    }
  }
});
test("manual language selection persists offline and covers formation, deployment, unit names and turn cutins", async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: "en-US" });
  await context.setOffline(true);
  try {
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.locator('[data-language="ja"]').click();
    await expect(page.locator("#openSkirmish")).toHaveText("スカーミッシュ");
    await page.reload();
    await expect(page.locator("#openRooms")).toHaveText("サーバーに接続");
    await expect(page.locator('[data-language="ja"]')).toHaveAttribute("aria-pressed", "true");
    await page.locator("#openFormation").click();
    await expect(page.locator(".formation-row").first()).toContainText("ジム");
    await expect(page.locator(".formation-row").first()).toContainText("ビーム・スプレーガン");
    await page.locator("#formationName").fill("主菜单 回避");
    await page.locator("#saveFormation").click();
    await page.locator('[data-language="en"]').click();
    await page.locator("#openFormation").click();
    await expect(page.locator("#formationName")).toHaveValue("主菜单 回避");
    await expect(page.locator("#formationSelect option").first()).toHaveText("主菜单 回避");
    await expect(page.locator(".formation-row").first()).toContainText("GM");
    await expect(page.locator(".formation-row").first()).toContainText("Beam Spray Gun");
    await expect(page.locator("#saveFormation")).toHaveText("Save and use");
    await page.screenshot({ path: ".openai/formation-en.png" });
    await page.locator("#saveFormation").click();
    await openPresentationFixture(page, false);
    await expect(page.locator("#confirmDeployment")).toHaveText("Confirm deployment");
    await page.locator("#confirmDeployment").click();
    await page.locator("#confirmDeployment").click();
    await page.locator("#allies .roster-unit").first().click();
    await expect(page.locator("#unitPanel")).toContainText("Beam Spray Gun");
    await expect(page.locator("#unitPanel")).toContainText("Protection");
    await page.evaluate(() => endTurn());
    await expect(page.locator("#turnCutinCard")).toHaveText("Team 1 ends its turn");
    await expect(page.locator("#turnCutinCard")).toHaveText("Turn 2", { timeout: 2500 });
    await expect(page.locator("#turnCutinCard")).toHaveText("Team 2 begins its turn", {
      timeout: 2500,
    });
    await expect(page.locator("#turnCutin")).toBeHidden();
    await page.evaluate(() => openMenu());
    await page.locator('[data-language="zh"]').click();
    await expect(page.locator("#openSkirmish")).toHaveText("遭遇战");
    await expect(page.locator("#openFormation")).toHaveText("编组");
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});
test("storage denial still permits language selection in the current session", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw Error("Denied");
    };
    Storage.prototype.setItem = () => {
      throw Error("Denied");
    };
  });
  await page.goto(url);
  await page.locator('[data-language="en"]').click();
  await expect(page.locator("#openFormation")).toHaveText("Squad");
  await page.locator('[data-language="ja"]').click();
  await expect(page.locator("#openFormation")).toHaveText("編成");
});
