const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`liaison affinity threshold and separate facility requirements at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 960 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.locator("#profileCompanyName").fill("Affinity PMC");
    await page.locator("#profileOnboardingConfirm").click();
    await page.evaluate(() => {
      const p = ProfileSave.encodeData();
      p.economy.contactAffinity = 799.9;
      p.economy.contactIntro = true;
      p.economy.contactTasks = [{ id: "efsf-1", status: "ready", progress: 6 }];
      ProfileSave.importData(p);
    });
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    await page.locator("#shellMissions").click();
    await page.locator("#shellContactMerchants").click();
    const merchant = page.locator('[data-merchant-id="efsf"]');
    await expect(merchant).toContainText("Lv1");
    await expect(merchant).toContainText("799.9");
    await page.locator("#shellContactTasks").click();
    await page.locator('#contactTasks [data-task-id="efsf-1"]').click();
    await page.locator("#acceptedContactTaskAction").click();
    await page.locator("#liaisonDialogueNext").click();
    await page.locator("#liaisonDialogueNext").click();
    const terminal = page.locator("#merchantTerminal");
    await expect(terminal.locator(".contact-terminal-nav")).toContainText("Lv2");
    expect(await page.evaluate(() => Economy.liaisonAffinity())).toBe(899.9);
    await terminal.getByRole("button", { name: "关闭", exact: true }).click();
    await page.evaluate(() => {
      const p = ProfileSave.encodeData();
      p.economy.money = 100000;
      p.economy.supplies = 100000;
      p.economy.baseFacilities.levels.hq = 2;
      p.economy.contactTasks = ContactTasks.tasks.map((t) => ({
        id: t.id,
        status: "claimed",
        progress: t.required,
      }));
      ProfileSave.importData(p);
    });
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    expect(await page.evaluate(() => Economy.liaisonLevel())).toBe(2);
    await page.evaluate(() => BaseFacilitiesUI.open());
    await page.locator('[data-facility-upgrade="factory"]').click();
    const dialog = page.locator("#facilityDialog"),
      requirements = dialog.locator(".facility-upgrade-requirements");
    await expect(requirements).toContainText("完成联邦联络任务：绿色通道");
    await expect(dialog.locator(".facility-cost")).not.toContainText("绿色通道");
    const cost = await dialog.locator(".facility-cost").boundingBox(),
      rule = await requirements.boundingBox();
    expect(rule.y).toBeGreaterThanOrEqual(cost.y + cost.height);
    await expect(page.locator("#confirmFacilityUpgrade")).toBeEnabled();
    await page.screenshot({
      path: `tmp/verification/screenshots/facility-requirements-${width}.png`,
    });
    await page.locator("#closeFacilityDialog").click();
    await page.locator('[data-facility-upgrade="beacon"]').click();
    await expect(requirements).toContainText("信标暂未开放升级");
    await expect(page.locator("#confirmFacilityUpgrade")).toBeDisabled();
    await expect(dialog.locator(".facility-cost dd")).toHaveText(["-", "-"]);
    expect(await dialog.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
    expect(errors).toEqual([]);
  });
