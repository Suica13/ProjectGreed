const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(
    "merchants sell parts only and contact tasks do not refer to tactical missions " + width,
    async ({ page }) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: 1000 });
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
      await page.waitForFunction(() => assetsReady);
      const original = await page.evaluate(() => {
        I18n.setLanguage("zh");
        Economy.creditActivity({
          id: "merchant-ui-funds",
          matchId: "merchant-ui-funds",
          money: 100000,
          supplies: 100000,
          inventory: { RGM_79: 1 },
        });
        const saved = Economy.snapshot();
        saved.contactIntro=true;
        saved.contactTasks = [{ merchantId: "efsf", mapId: "mission_no_fool", status: "accepted" }];
        localStorage.setItem(Economy.key, SaveCodec.stringify(saved));
        return { money: saved.money, supplies: saved.supplies, id: saved.storage.units[0].id };
      });
      await page.reload();
      await page.waitForFunction(() => assetsReady);
      expect(await page.evaluate(() => Economy.snapshot().contactTasks)).toEqual([]);
      expect(
        await page.evaluate(() => SaveCodec.parse(localStorage.getItem(Economy.key)).contactTasks),
      ).toEqual([]);
      await page.locator("#shellMissions").click();
      await expect(page.locator("#contactTasks")).toContainText("暂无已接受任务");
      await expect(page.locator("#contactTasks .contact-task-item")).toHaveCount(0);
      await page.locator("#shellContactMerchants").click();
      await expect(page.locator(".merchant-card")).toHaveCount(3);
      await page.locator('[data-merchant-id="efsf"] .merchant-portrait').click();
      const terminal = page.locator("#merchantTerminal");
      await terminal.getByRole("button", { name: "任务", exact: true }).click();
      await expect(terminal).toContainText("首秀");
      await expect(terminal.locator("[data-task-id]")).toHaveCount(6);
      await expect(terminal.locator("[data-task-map]")).toHaveCount(0);
      await expect(terminal).not.toContainText("绝不上当");
      await terminal.getByRole("button", { name: "返回", exact: true }).click();
      await expect(terminal.getByRole("button", { name: "购买", exact: true })).toHaveCount(0);
      await terminal.getByRole("button", { name: "关闭", exact: true }).click();
      await page.locator('[data-merchant-id="anaheim"] .merchant-portrait').click();
      await terminal.getByRole("button", { name: "购买", exact: true }).click();
      await expect(terminal.locator(".merchant-plugin")).toHaveCount(18);
      expect(await page.evaluate(()=>Economy.pluginOffer("anaheim","generator").money)).toBe(6000);
      expect(await page.evaluate(()=>Economy.pluginOffer("anaheim","tem_ray").money)).toBe(9000);
      await expect(terminal.locator('.merchant-unit,[data-shop-tab="units"]')).toHaveCount(0);
      await expect(terminal).not.toContainText("购买单位");
      await terminal.getByRole("searchbox", { name: "搜索商品" }).fill("强化骨架");
      await expect(terminal.locator(".merchant-plugin")).toHaveCount(1);
      await terminal.getByRole("searchbox", { name: "搜索商品" }).fill("");
      await terminal
        .locator('.merchant-plugin[data-plugin-id="frame"]')
        .getByRole("button", { name: "购买", exact: true })
        .click();
      expect(await page.evaluate(() => Economy.snapshot().money)).toBe(original.money - 3000);
      expect(await page.evaluate(() => Economy.snapshot().supplies)).toBe(original.supplies);
      expect(await page.evaluate(() => Economy.pluginQuantity("frame"))).toBe(1);
      await page.screenshot({
        path: "tmp/verification/screenshots/merchant-parts-only-" + width + ".png",
      });
      await terminal.getByRole("button", { name: "关闭", exact: true }).click();
      await page.locator("#shellHangar").click();
      await page.locator('#warehouseBays [data-stock-id="' + original.id + '"]').click();
      await page.locator('[data-plugin-slot="0"]').click();
      await expect(
        page.locator('.plugin-picker-choice[data-plugin-id="generator"]'),
      ).toBeDisabled();
      await page.locator('.plugin-picker-choice[data-plugin-id="frame"]').click();
      expect(await page.evaluate(() => Economy.pluginQuantity("frame"))).toBe(0);
      await page.locator('[data-plugin-slot="0"]').click();
      await page.getByRole("button", { name: "卸下零件", exact: true }).click();
      expect(await page.evaluate(() => Economy.pluginQuantity("frame"))).toBe(1);
      await page.locator("#warehouseClose").click();
      await page.locator("#shellMissions").click();
      await page.locator("#shellContactMerchants").click();
      await page.locator('[data-merchant-id="anaheim"] .merchant-portrait').click();
      await terminal.getByRole("button", { name: "购买", exact: true }).click();
      await expect(terminal.locator(".merchant-plugin")).toHaveCount(18);
      expect(await page.evaluate(()=>Economy.pluginOffer("anaheim","generator").money)).toBe(6000);
      expect(await page.evaluate(()=>Economy.pluginOffer("anaheim","tem_ray").money)).toBe(9000);
      expect(await terminal.evaluate((n) => n.scrollWidth <= n.clientWidth + 1)).toBe(true);
      expect(
        await page.evaluate(
          () => Object.values(Rules.catalog.maps).filter((map) => map.mission).length,
        ),
      ).toBe(6);
      expect(errors).toEqual([]);
    },
  );
