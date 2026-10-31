const { test, expect } = require("@playwright/test"),
  assert = require("node:assert/strict"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  { openPresentationFixture } = require("./presentation-fixture.cjs");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("encounter choices open in a centered modal and language is only available in settings", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__copiedText = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (value) => window.__copiedText.push(value) },
    });
  });
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await expect(page.locator("#releaseWarning .release-warning-icon")).toHaveText("⚠");
  await expect(page.locator("#releaseWarning .release-warning-text")).toHaveText(
    "目前版本:V11,注意！测试版不代表最终品质",
  );
  const warningLayout = await page.locator("#releaseWarning").evaluate((element) => {
    const icon = element.querySelector(".release-warning-icon").getBoundingClientRect();
    const text = element.querySelector(".release-warning-text").getBoundingClientRect();
    const style = getComputedStyle(element);
    return { iconRight: icon.right, textLeft: text.left, border: style.borderTopColor };
  });
  assert(warningLayout.iconRight <= warningLayout.textLeft);
  assert.notEqual(warningLayout.border, "rgba(0, 0, 0, 0)");
  await expect(page.locator("#languageSwitch")).toHaveCount(0);
  await expect(
    page.getByText("离线房间无需服务器。全部素材已内置，可直接打开本地客户端开始遭遇战。"),
  ).toHaveCount(0);
  await expect(page.getByText("原始素材已就绪 · 选择模式开始")).toHaveCount(0);
  await expect(page.locator("#start .start-brand .logo")).toHaveText("P");
  await expect(page.locator("#startTitle")).toHaveText("ProjectGreed");
  await expect(page.locator("#start .start-brand .eyebrow")).toContainText("V11");
  await expect(page.locator("#copyQqGroup")).toHaveText("QQ群:783420192");
  const contactLayout = await page.locator("#copyQqGroup").evaluate((button) => {
    const panel = button.closest("#start > .modal").getBoundingClientRect();
    const box = button.getBoundingClientRect();
    return { rightGap: panel.right - box.right, bottomGap: panel.bottom - box.bottom };
  });
  assert(contactLayout.rightGap >= 0 && contactLayout.rightGap <= 30);
  assert(contactLayout.bottomGap >= 0 && contactLayout.bottomGap <= 72);
  await page.locator("#copyQqGroup").click();
  await expect(page.locator("#toast")).toHaveText("已复制");
  expect(await page.evaluate(() => window.__copiedText)).toEqual(["783420192"]);
  await page.locator("#openClientSettings").click();
  await expect(page.locator("#settingsLanguage")).toBeVisible();
  await page.locator("#closeClientSettings").click();
  const before = await page
    .locator("#start > .modal")
    .evaluate((element) => element.getBoundingClientRect().height);
  await page.locator("#openSkirmish").click();
  await expect(page.locator("#skirmishSetup")).toBeVisible();
  await expect(page.locator("#createOfflineRoom")).toBeFocused();
  await expect(page.locator("#skirmishSetupTitle")).toHaveText("遭遇战");
  await expect(page.locator("#skirmishSetup")).toContainText(
    "创建离线房间与 AI 对战，或连接服务器加入多人房间。",
  );
  await expect(page.locator("#skirmishSetup .net-buttons button")).toHaveText([
    "创建离线房间",
    "连接服务器",
    "返回",
  ]);
  const geometry = await page.locator("#skirmishSetup .skirmish-dialog").evaluate((element) => {
    const box = element.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
  });
  assert(
    geometry.left >= 0 && geometry.right <= 844 && geometry.top >= 0 && geometry.bottom <= 390,
  );
  const after = await page
    .locator("#start > .modal")
    .evaluate((element) => element.getBoundingClientRect().height);
  assert(Math.abs(before - after) < 1);
  await page.locator("#createOfflineRoom").press("Escape");
  await expect(page.locator("#skirmishSetup")).toBeHidden();
  await expect(page.locator("#openSkirmish")).toBeFocused();
});

test("unit display ignores legacy random names and LOG uses formation positions", async ({
  page,
}) => {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await openPresentationFixture(page, false);
  const probe = await page.evaluate(() => {
    const unit = game.units[0];
    unit.customName = "Legacy[X99]";
    Chat.setLog([logUnit(unit) + " 行动"]);
    update();
    return { id: unit.id, actual: Rules.modelOf(unit).name };
  });
  const row = page.locator(`.roster-unit[data-unit-id="${probe.id}"]`);
  await expect(row.locator(".roster-unit-name")).toHaveText(probe.actual);
  await expect(row).not.toContainText("[X99]");
  await expect(page.locator("#log")).toContainText("[No.1]");
  await page.locator("#openClientSettings").click();
  await expect(page.locator("#settingsTrueUnitNames")).toHaveCount(0);
});
