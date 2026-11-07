const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
for (const width of [1280, 390])
  test(`activity unit picker, kit quantities and published editing at ${width}px`, async ({
    page,
  }, testInfo) => {
    const app = createServer({ host: "127.0.0.1", port: 0 }),
      address = await app.listen();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    const choose = async (id) => {
      await page.locator("#rewardUnitSearch").fill(id);
      await page.locator(`#rewardUnitList [data-unit-id="${id}"]`).click();
    };
    try {
      await page.goto(`http://127.0.0.1:${address.port}/admin/activities.html`);
      await expect(page.locator("#activities button")).toHaveCount(5);
      await page.locator("#title").fill("Configurable stock");
      await page.locator("#addChassisStock").click();
      const names = await page
        .locator("#rewardUnitList button")
        .evaluateAll((buttons) => buttons.map((b) => b.firstChild.textContent));
      expect(names).toEqual(
        [...names].sort(new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" }).compare),
      );
      await page.locator("#rewardUnitSearch").fill("MS_06F");
      await page.locator("#rewardUnitFaction").selectOption("EFSF");
      await expect(page.locator('#rewardUnitList [data-unit-id="MS_06F"]')).toHaveCount(0);
      await page.locator("#rewardUnitFaction").selectOption("ZEON");
      await page.locator("#rewardUnitEra").selectOption("0079T1");
      await page.locator("#rewardUnitType").selectOption("MS");
      await choose("MS_06F");
      await expect(page.locator("#rewardBaseKit")).toHaveValue("MS_06F__machine_gun");
      expect(
        await page
          .locator("#extraKitRows input")
          .evaluateAll((inputs) => inputs.every((i) => i.value === "0")),
      ).toBe(true);
      await page.locator("#rewardChassisCount").fill("9");
      await page.locator("#cancelRewardConfig").click();
      await expect(page.locator("#stockRewards .reward-summary")).toHaveCount(0);
      await choose("MS_06F");
      await page.screenshot({path:testInfo.outputPath("reward-config.png")});
      await page.locator("#rewardChassisCount").fill("2");
      await page.locator("#rewardBaseKit").selectOption("MS_06F__bazooka");
      await page.locator('#extraKitRows [data-kit-id="MS_06F__machine_gun"] input').fill("3");
      await page.locator('#extraKitRows [data-kit-id="MS_06F__bazooka"] input').fill("4");
      await page.locator("#rewardKitSearch").fill("machine_gun");
      await expect(page.locator('#extraKitRows [data-kit-id="MS_06F__bazooka"]')).toBeHidden();
      await page.locator("#confirmRewardConfig").click();
      await expect(page.locator('#stockRewards [data-unit-id="MS_06F"]')).toContainText("机体 ×2");
      await page.locator("#publish").click();
      await expect(page.locator("#status")).toContainText("活动已发布");
      const event = app.activities.adminSnapshot().activities.at(-1);
      expect(event.rewards.inventory).toEqual({ MS_06F: 2 });
      expect(event.rewards.kits).toEqual({ MS_06F__machine_gun: 3, MS_06F__bazooka: 6 });
      await page
        .locator('#stockRewards [data-unit-id="MS_06F"]')
        .getByRole("button", { name: "编辑", exact: true })
        .click();
      await expect(page.locator("#rewardBaseKit")).toHaveValue("MS_06F__bazooka");
      await page.locator("#rewardChassisCount").fill("8");
      await page.locator("#cancelRewardConfig").click();
      await expect(page.locator('#stockRewards [data-unit-id="MS_06F"]')).toContainText("机体 ×2");
      await page.locator("#money").fill("765");
      await page
        .locator('#stockRewards [data-unit-id="MS_06F"]')
        .getByRole("button", { name: "编辑", exact: true })
        .click();
      await page.locator("#rewardChassisCount").fill("4");
      await page.locator("#confirmRewardConfig").click();
      await page.locator("#saveCopy").click();
      await expect(page.locator("#status")).toContainText("活动修改已保存");
      expect(app.activities.adminSnapshot().activities.at(-1).id).toBe(event.id);
      expect(app.activities.adminSnapshot().activities.at(-1).rewards.money).toBe(765);
      expect(app.activities.adminSnapshot().activities.at(-1).rewards.inventory).toEqual({
        MS_06F: 4,
      });
      await page.reload();
      await page.locator("#activities button").filter({ hasText: "Configurable stock" }).click();
      await expect(page.locator("#money")).toHaveValue("765");
      await expect(page.locator('#stockRewards [data-unit-id="MS_06F"]')).toContainText("机体 ×4");
      await page.locator("#newActivity").click();
      await expect(page.locator("#stockRewards .reward-summary")).toHaveCount(0);
      await expect(page.locator("#money")).toHaveValue("0");
      await page.locator("#addKitStock").click();
      await choose("MS_06F");
      await expect(page.locator("#rewardChassisCount")).toHaveValue("0");
      await page.locator('#extraKitRows [data-kit-id="MS_06F__machine_gun"] input').fill("5");
      await page.locator("#confirmRewardConfig").click();
      await expect(page.locator('#stockRewards [data-unit-id="MS_06F"]')).toContainText("机体 ×0");
      expect(errors).toEqual([]);
    } finally {
      await app.close();
    }
  });
