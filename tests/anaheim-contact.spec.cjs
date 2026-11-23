const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`Anaheim original dialogue, ten commissions and task-gated shop at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.locator("#profileCompanyName").fill("灰狐PMC");
    await page.locator("#profileOnboardingConfirm").click();
    await page.evaluate(() => {
      I18n.setLanguage("zh");
      Economy.creditActivity({
        id: "ae-ui-funds",
        matchId: "ae-ui-funds",
        money: 100000,
        supplies: 0,
        inventory: {},
      });
    });
    await page.locator("#shellMissions").click();
    await page.locator("#shellContactMerchants").click();
    await page.locator('[data-merchant-id="anaheim"] .merchant-portrait').click();
    const terminal = page.locator("#merchantTerminal");
    await expect(terminal).toContainText("灰狐PMC");
    await expect(terminal).toContainText("碰坏按全新价赔");
    const length = await page.evaluate(() => AnaheimContact.intro.length);
    for (let i = 0; i < length; i++) await page.locator("#liaisonDialogueNext").click();
    await terminal.getByRole("button", { name: "购买", exact: true }).click();
    await expect(terminal.locator("[data-plugin-id]")).toHaveCount(19);
    await expect(terminal.locator('[data-plugin-id="frame"] button')).toBeDisabled();
    await expect(terminal.locator('[data-plugin-id="frame"]')).toContainText("不问来路");
    await expect(terminal.locator('[data-plugin-id="frame"] .plugin-origin')).toContainText("前提任务：不问来路");
    await terminal.getByRole("button", { name: "返回", exact: true }).click();
    await terminal.getByRole("button", { name: "任务", exact: true }).click();
    await expect(terminal.locator("[data-task-id]")).toHaveCount(10);
    await terminal.locator('[data-task-id="anaheim-3"]').click();
    await expect(terminal).toContainText("0079T1");
    await expect(terminal).toContainText("无友军");
    await expect(terminal).toContainText("强化骨架");
    await terminal.locator('[data-task-id="anaheim-1"]').click();
    await page.locator("#contactTaskAction").click();
    await page.evaluate(() =>
      Economy.creditAward({
        id: "ae-ui-proof",
        matchId: "ae-ui-proof",
        money: 0,
        supplies: 0,
        contactProgress: [{ id: "anaheim-1", amount: 1 }],
      }),
    );
    await page.locator("#contactTaskAction").click();
    await expect(terminal).toContainText("清单没少，印章也在");
    const lines = await page.evaluate(
      () => ContactTasks.byId.get("anaheim-1").ending.split("\n").length,
    );
    for (let i = 0; i < lines; i++) await page.locator("#liaisonDialogueNext").click();
    await terminal.getByRole("button", { name: "购买", exact: true }).click();
    await expect(terminal.locator('[data-plugin-id="frame"] button')).toBeEnabled();
    await expect(terminal.locator('[data-plugin-id="generator"] button')).toBeDisabled();
    await terminal.locator('[data-plugin-id="frame"] button').click();
    expect(await page.evaluate(() => Economy.pluginQuantity("frame"))).toBe(1);
    const bounds = await terminal.evaluate((e) => [e.scrollWidth, e.clientWidth]);
    expect(bounds[0]).toBeLessThanOrEqual(bounds[1] + 1);
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    expect(
      await page.evaluate(() => [
        Economy.pluginOffer("anaheim", "frame").available,
        Economy.pluginOffer("anaheim", "generator").available,
        Economy.pluginQuantity("frame"),
      ]),
    ).toEqual([true, false, 1]);
    expect(errors).toEqual([]);
  });
