const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`Zeon liaison portrait, independent intro, missions and facilities at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.locator("#profileCompanyName").fill("狮鹫PMC");
    await page.locator("#profileOnboardingConfirm").click();
    await page.evaluate(() => {
      I18n.setLanguage("zh");
      Economy.creditActivity({
        id: "zeon-test-funds",
        matchId: "zeon-test-funds",
        money: 100000,
        supplies: 100000,
        inventory: {},
      });
    });
    await page.locator("#shellMissions").click();
    await page.locator("#shellContactMerchants").click();
    await expect(page.locator(".merchant-card")).toHaveCount(5);
    const portrait = page.locator('[data-merchant-id="zeon"] img');
    await expect(portrait).toHaveAttribute("src", /^data:image\/png;base64,/);
    expect(
      await portrait.evaluate(async (image) => {
        await image.decode();
        return image.naturalWidth;
      }),
    ).toBe(512);
    const open = () => page.locator('[data-merchant-id="zeon"] .merchant-portrait').click();
    const terminal = page.locator("#merchantTerminal");
    await open();
    await expect(terminal).toContainText("接通的是公国军");
    await terminal.getByRole("button", { name: "关闭", exact: true }).click();
    expect(await page.evaluate(() => ContactTasks.met(Economy.snapshot(), "zeon"))).toBe(false);
    await open();
    const lines = await page.evaluate(() => ZeonContact.intro.length);
    let company = false;
    for (let i = 0; i < lines; i++) {
      if ((await terminal.textContent()).includes("狮鹫PMC")) company = true;
      await page.locator("#liaisonDialogueNext").click();
    }
    expect(company).toBe(true);
    expect(
      await page.evaluate(() => [
        ContactTasks.met(Economy.snapshot(), "zeon"),
        Economy.snapshot().contactIntro,
        Economy.hasLicense("MS_06J"),
      ]),
    ).toEqual([true, false, true]);
    await terminal.getByRole("button", { name: "任务", exact: true }).click();
    await expect(terminal.locator("[data-task-id]")).toHaveCount(11);
    await terminal.locator('[data-task-id="zeon-8"]').click();
    await expect(terminal).toContainText('机动扎古指挥官机');
    expect(await page.evaluate(()=>{
      const t=ContactTasks.byId.get('zeon-8');
      return [t.difficulty,t.kind,t.enemyFaction,t.targetUnits.length,t.targetLeaderPilot.grade,t.targetPilotGrade];
    })).toEqual([5,'command','ZEON',6,'ace','elite']);
    await terminal.locator('[data-task-id="zeon-2"]').click();
    await expect(page.locator("#contactTaskAction")).toBeDisabled();
    await expect(terminal.locator(".contact-task-requirements")).toContainText("友好姿态");
    await terminal.locator('[data-task-id="zeon-9"]').click();
    expect(await page.evaluate(()=>ContactTasks.planIds(ContactTasks.byId.get('zeon-9')))).toEqual(['Tech_ZEON_0079_NewGroundTypeMSDevelopmentPlan']);
    const latePlanName=await page.evaluate(()=>DEVELOPMENT_TREE.ZEON.find(p=>p.id==='Tech_ZEON_0079_ZakuIILateTypeDevelopmentPlan').name);
    await expect(terminal.locator('.contact-technology-reward')).not.toContainText(latePlanName);
    await terminal.locator('[data-task-id="zeon-1"]').click();
    await expect(terminal).toContainText("歼灭地球联邦军MS 0/6");
    await page.locator("#contactTaskAction").click();
    await page.evaluate(() =>
      Economy.creditAward({
        id: "zeon-ui-proof",
        matchId: "zeon-ui-proof",
        money: 0,
        supplies: 0,
        contactProgress: [{ id: "zeon-1", amount: 6 }],
      }),
    );
    await page.locator("#contactTaskAction").click();
    await expect(terminal.locator(".liaison-dialogue-text h3")).toHaveText("吉翁联络人");
    for (let i = 0; i < 3; i++) await page.locator("#liaisonDialogueNext").click();
    expect(
      await page.evaluate(() => [Economy.merchantAffinity("zeon"), Economy.liaisonAffinity()]),
    ).toEqual([100, 0]);
    await page.evaluate(() => {
      for (const task of ContactTasks.tasks.filter(
        (t) => t.contactId === "zeon" && t.number >= 2 && t.number <= 6,
      )) {
        Economy.acceptContactTask(task.id);
        Economy.creditAward({
          id: "zeon-ui-" + task.id,
          matchId: "zeon-ui-" + task.id,
          money: 0,
          supplies: 0,
          contactProgress: [{ id: task.id, amount: task.required }],
        });
        Economy.completeContactTask(task.id);
      }
    });
    expect(
      await page.evaluate(() => ({
        facility: Economy.facilityUpgradeOffer("hq").available,
        efsf: Economy.snapshot().contactIntro,
      })),
    ).toEqual({ facility: true, efsf: false });
    await terminal.getByRole("button", { name: "任务", exact: true }).click();
    await terminal.locator('[data-task-id="zeon-6"]').click();
    await expect(terminal).toContainText("允许HQ、工厂、巨型工厂、士官学院升级到2级");
    const geometry = await terminal.evaluate((n) => {
      const r = n.getBoundingClientRect();
      return { w: r.width, h: r.height, overflow: n.scrollWidth > n.clientWidth + 1 };
    });
    expect(geometry.overflow).toBe(false);
    expect(geometry.h).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
    await page.screenshot({ path: `tmp/verification/screenshots/zeon-contact-${width}.png` });
    await terminal.getByRole("button", { name: "关闭", exact: true }).click();
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    expect(
      await page.evaluate(() => [
        ContactTasks.met(Economy.snapshot(), "zeon"),
        Economy.merchantAffinity("zeon"),
        Economy.facilityUpgradeOffer("hq").available,
      ]),
    ).toEqual([true, 600, true]);
    expect(errors).toEqual([]);
  });
