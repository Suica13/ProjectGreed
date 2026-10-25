const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function chooseLanguage(page, language) {
  await page.locator("#openClientSettings").click();
  await page.locator("#settingsLanguage").selectOption(language);
  await page.locator("#closeClientSettings").click();
}
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
      await expect(page.locator("#languageSwitch")).toHaveCount(0);
      await expect(page.locator("#settingsLanguage")).toHaveCount(1);
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
    await chooseLanguage(page, "ja");
    await expect(page.locator("#openSkirmish")).toHaveText("スカーミッシュ");
    await page.reload();
    await expect(page.locator("#openRooms")).toHaveText("サーバーに接続");
    await page.locator("#openClientSettings").click();
    await expect(page.locator("#settingsLanguage")).toHaveValue("ja");
    await page.locator("#closeClientSettings").click();
    await page.locator("#openFormation").click();
    await page.locator("#openFormationPicker").click();
    await expect(page.locator('[data-unit-id="RGM_79"]')).toContainText("ジム");
    await page.locator("#closeFormationPicker").click();
    await page.locator("#formationName").fill("主菜单 回避");
    await page.locator("#saveFormation").click();
    await chooseLanguage(page, "en");
    await page.locator("#openFormation").click();
    await expect(page.locator("#formationName")).toHaveValue("主菜单 回避");
    await expect(page.locator("#formationSelect option").first()).toHaveText("主菜单 回避");
    await page.locator("#openFormationPicker").click();
    await expect(page.locator('[data-unit-id="RGM_79"]')).toContainText("GM");
    await page.locator("#closeFormationPicker").click();
    await expect(page.locator("#saveFormation")).toHaveText("Save and use");
    await page.screenshot({ path: ".openai/formation-en.png" });
    await page.locator("#saveFormation").click();
    await openPresentationFixture(page, false);
    await expect(page.locator("#confirmDeployment")).toHaveText("Confirm deployment");
    await page.locator("#confirmDeployment").click();
    await page.locator("#confirmDeployment").click();
    await page.evaluate(() => endTurn());
    await expect(page.locator("#turnCutinCard")).toHaveText("Team 1 ends its turn");
    await expect(page.locator("#turnCutinCard")).toHaveText("Turn 2", { timeout: 2500 });
    await expect(page.locator("#turnCutinCard")).toHaveText("Team 2 begins its turn", {
      timeout: 2500,
    });
    await expect(page.locator("#turnCutin")).toBeHidden();
    await page.evaluate(() => openMenu());
    await chooseLanguage(page, "zh");
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
  await chooseLanguage(page, "en");
  await expect(page.locator("#openFormation")).toHaveText("Squad");
  await chooseLanguage(page, "ja");
  await expect(page.locator("#openFormation")).toHaveText("編成");
});
