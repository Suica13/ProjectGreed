const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`revised parts vendors, level gates, icons and fitted mechanics at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(120000);
    await page.setViewportSize({ width, height: 1000 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.locator("#profileCompanyName").fill("Parts PMC");
    await page.locator("#profileOnboardingConfirm").click();
    const stockId = await page.evaluate(() => {
      I18n.setLanguage("zh");
      Economy.meetLiaison();
      Economy.creditActivity({
        id: "parts",
        matchId: "parts",
        money: 200000,
        supplies: 0,
        inventory: { RX_78_2: 1 },
      });
      const item = Economy.snapshot().storage.units.find((u) => u.unitId === "RX_78_2");
      const model = Object.values(UnitModels).find(
        (m) =>
          m.prefabId === item.unitId &&
          m.weapons.some((w) => WeaponClasses.classify(w) === "beam_rifle"),
      );
      Economy.changeStoredKit(item.id, model.kitId);
      return item.id;
    });
    await page.locator("#shellMissions").click();
    await page.locator("#shellContactMerchants").click();
    const terminal = page.locator("#merchantTerminal");
    async function shop(id) {
      await page.locator(`[data-merchant-id="${id}"] .merchant-portrait`).click();
      await terminal.getByRole("button", { name: "购买", exact: true }).click();
    }
    await shop("anaheim");
    await expect(terminal.locator('[data-plugin-id="ambac"]')).toContainText("0079T2");
    await expect(terminal.locator('[data-plugin-id="ambac"] > button')).toBeEnabled();
    await expect(terminal.locator('[data-plugin-id="minovsky"] > button')).toBeDisabled();
    await expect(terminal.locator('[data-plugin-id="v_data"]')).toHaveCount(0);
    await terminal.locator('[data-plugin-id="frame"] > button').click();
    expect(await page.evaluate(() => Economy.pluginQuantity("frame"))).toBe(1);
    await terminal.getByRole("button", { name: "关闭", exact: true }).click();
    await shop("efsf");
    await expect(terminal.locator('[data-plugin-id="v_data"] > button')).toBeDisabled();
    await expect(terminal.locator('[data-plugin-id="frame"]')).toHaveCount(0);
    await terminal.getByRole("button", { name: "关闭", exact: true }).click();
    await page.evaluate(() => {
      const p = ProfileSave.encodeData();
      p.economy.contactAffinity = 800;
      p.economy.merchantAffinities.anaheim = 800;
      ProfileSave.importData(p);
    });
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    await page.locator("#shellMissions").click();
    await page.locator("#shellContactMerchants").click();
    await shop("efsf");
    await terminal.locator('[data-plugin-id="beam_generator"] > button').click();
    await terminal.getByRole("button", { name: "关闭", exact: true }).click();
    await shop("anaheim");
    for (const id of ["minovsky", "concealment", "ms_database"])
      await terminal.locator(`[data-plugin-id="${id}"] > button`).click();
    expect(
      await terminal.locator(".merchant-product img").evaluateAll(async (images) => {
        await Promise.all(images.map((i) => i.decode()));
        return images.every((i) => i.naturalWidth === 64 && i.naturalHeight === 64);
      }),
    ).toBe(true);
    await page.screenshot({ path: `tmp/verification/screenshots/plugin-market-${width}.png` });
    await terminal.getByRole("button", { name: "关闭", exact: true }).click();
    await page.locator("#shellHangar").click();
    await page.locator(`#warehouseBays [data-stock-id="${stockId}"]`).click();
    for (const [slot, id] of [
      "beam_generator",
      "minovsky",
      "concealment",
      "ms_database",
    ].entries()) {
      await page.locator(`[data-plugin-slot="${slot}"]`).click();
      await page.locator(`#warehouseDialog .plugin-picker-choice[data-plugin-id="${id}"]`).click();
    }
    await page
      .locator("#warehouseDialog")
      .getByRole("button", { name: "武装列表", exact: true })
      .click();
    await expect(page.locator("#warehouseWeaponList .plugin-modified-value").first()).toBeVisible();
    await page
      .locator("#warehouseDialog")
      .getByRole("button", { name: "技能列表", exact: true })
      .click();
    await expect(page.locator("#warehouseSkillList")).toContainText("米诺夫斯基粒子散布[S]");
    await expect(page.locator("#warehouseSkillList")).toContainText("无视隐蔽");
    const saved = await page.evaluate(
      (id) => Economy.snapshot().storage.units.find((u) => u.id === id).plugins,
      stockId,
    );
    expect(saved).toEqual(["beam_generator", "minovsky", "concealment", "ms_database"]);
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    expect(
      await page.evaluate(
        (id) => Economy.snapshot().storage.units.find((u) => u.id === id).plugins,
        stockId,
      ),
    ).toEqual(saved);
    expect(errors).toEqual([]);
  });
