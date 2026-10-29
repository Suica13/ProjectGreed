const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function chooseLanguage(page, language) {
  await page.locator("#shellSettings:visible, #openClientSettings:visible").first().click();
  await page.locator("#settingsLanguage").selectOption(language);
  await page.locator("#closeClientSettings").click();
}
test("browser environment selects Japanese or English and unsupported locales fall back to English", async ({
  browser,
}) => {
  for (const [locale, expected, label] of [
    ["ja-JP", "ja", "オンライン · サーバー接続"],
    ["en-US", "en", "Online · Connect to server"],
    ["fr-FR", "en", "Online · Connect to server"],
    ["zh-TW", "zh-CN", "联机 · 连接服务器"],
  ]) {
    const context = await browser.newContext({ locale });
    try {
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
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
  await context.addInitScript(() => {
    if (!localStorage.getItem("localization-test-seeded")) {
      localStorage.setItem(
        "projectgreed.economy.v1",
        JSON.stringify({ money: 5000, supplies: 10000, inventory: { RGM_79: 4 }, kits: {} }),
      );
      localStorage.setItem("localization-test-seeded", "1");
    }
  });
  try {
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.setDefaultTimeout(10000);
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => Development.grantUnit("EFSF", "RGM_79"));
    await chooseLanguage(page, "ja");
    await expect(page.locator("#openSkirmish")).toHaveText("戦闘開始");
    await page.reload();
    await expect(page.locator("#openRooms")).toHaveText("オンライン · サーバー接続");
    await page.locator("#shellSettings:visible, #openClientSettings:visible").first().click();
    await expect(page.locator("#settingsLanguage")).toHaveValue("ja");
    await page.locator("#closeClientSettings").click();
    await page.locator("#shellHangar").click();
    await page.locator("#openFormationPicker").click();
    await expect(page.locator('[data-unit-id="RGM_79"]')).toContainText("ジム");
    await page.locator("#closeFormationPicker").click();
    await page.locator("#formationName").fill("主菜单 回避");
    await page.locator("#shellLobby").click();
    await chooseLanguage(page, "en");
    await page.locator("#shellHangar").click();
    await expect(page.locator("#formationName")).toHaveValue("主菜单 回避");
    await expect(page.locator("#formationSelect option").first()).toHaveText("主菜单 回避");
    await page.locator("#openFormationPicker").click();
    await expect(page.locator('[data-unit-id="RGM_79"]')).toContainText("GM");
    await page.locator("#closeFormationPicker").click();
    await expect(page.locator("#saveFormation")).toHaveText("Back");
    await page.screenshot({ path: ".openai/formation-en.png" });
    await page.locator("#shellLobby").click();
    await openPresentationFixture(page, false);
    await expect(page.locator("#confirmDeployment")).toHaveText("Confirm deployment (B)");
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
    await expect(page.locator("#openSkirmish")).toHaveText("开始战斗");
    await expect(page.locator("#openFormation")).toHaveText("编成");
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
  page.setDefaultTimeout(10000);
  await page.goto(url);
  await chooseLanguage(page, "en");
  await expect(page.locator("#openFormation")).toHaveText("Formation");
  await chooseLanguage(page, "ja");
  await expect(page.locator("#openFormation")).toHaveText("編成");
});

for (const width of [390, 1280])
  test(`Japanese catalog and ACE biography refresh without changing custom names (${width}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("ja"));
    const results = await page.evaluate(() => ({
      missing: ART.prefabs
        .filter((p) => !p.localization?.ja?.name || !p.localization?.ja?.description)
        .map((p) => p.id),
      names: ["MSM_03", "MSM_03C", "MS_18E", "RX_78GP03D"].map(
        (id) => ART.prefabs.find((p) => p.id === id).name,
      ),
      custom: I18n.pilotName({ custom: true, name: "高达 阿姆罗·雷" }),
      weapon: ART.prefabs.find((p) => p.id === "MSM_03").weapons.ZN_MSM_03_ChestBeam.name,
    }));
    expect(results.missing).toEqual([]);
    expect(results.names).toEqual([
      "ゴッグ",
      "ハイゴッグ",
      "ケンプファー",
      "ガンダム試作3号機デンドロビウム",
    ]);
    expect(results.custom).toBe("高达 阿姆罗·雷");
    expect(results.weapon).toBe("胸部拡散ビーム砲");
    await page.evaluate(() => Formation.openAceRecruitment("Pilot_EFSF_0079_N_ACE_AMR"));
    await expect(page.locator(".ace-biography")).toContainText("白い流星");
    await page.evaluate(() => I18n.setLanguage("en"));
    await expect(page.locator(".ace-biography")).toContainText("White Meteor");
    await page.evaluate(() => I18n.setLanguage("zh"));
    await expect(page.locator(".ace-biography")).toContainText("白色流星");
  });
