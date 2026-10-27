const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function open(page) {
  await page.addInitScript(() => {
    if (localStorage.getItem("production-test-seeded")) return;
    localStorage.setItem("production-test-seeded", "yes");
    localStorage.setItem(
      "projectgreed.economy.v1",
      JSON.stringify({ money: 5000, supplies: 10000, inventory: {}, kits: {} }),
    );
    localStorage.setItem("projectgreed.combatFaction", "PMC");
    localStorage.setItem(
      "slg-formations-v1.PMC",
      JSON.stringify({
        version: 3,
        squads: [
          {
            name: "套件编组",
            units: Array.from({ length: 4 }, () => ({ unitId: "MS_06F", kitId: "machine_gun" })),
          },
        ],
      }),
    );
  });
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    Development.grantUnit("ZEON", "MS_06F");
  });
}
for (const width of [1280, 390, 360])
  test(`base production, batch kits, preview tabs and separate checkout at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.locator("#openProduction").click();
    await page.locator("#productionSearch").fill("MS_06F");
    await page.locator('#productionList [data-unit-id="MS_06F"]').click();
    const row = page.locator('#productionList [data-unit-id="MS_06F"]');
    await expect(row).toContainText("0079");
    await expect(row.locator(".faction-tag")).toHaveText("ZEON");
    await expect(row.locator(".era-tag")).toContainText("0079");
    await expect(row.locator(".unit-summary-tag.ground")).toContainText("地面");
    await expect(row.locator(".unit-summary-tag.space")).toContainText("宇宙");
    await expect(row.locator(".production-batch-count")).toHaveText("+3");
    await expect(row.locator(".production-batch-count")).toHaveCSS("color", "rgb(255, 255, 255)");
    const order = await row.evaluate((card) => {
      const cost = card.querySelector(".production-unit-price .cost").getBoundingClientRect();
      const money = card.querySelector(".resource-money").getBoundingClientRect();
      return {
        costRight: cost.right,
        moneyLeft: money.left,
        costMiddle: cost.y + cost.height / 2,
        moneyMiddle: money.y + money.height / 2,
      };
    });
    expect(order.costRight).toBeLessThan(order.moneyLeft);
    expect(Math.abs(order.costMiddle - order.moneyMiddle)).toBeLessThan(2);
    await expect(row).toContainText("COST");
    await expect(row).toContainText("资金 800");
    await expect(row).toContainText("物资 1,600");
    await expect(page.locator("#productionKit")).toHaveValue("machine_gun");
    await expect(page.locator("#productionKit")).toBeEnabled();
    await expect(page.locator(".production-modes")).toHaveCount(0);
    await expect(page.locator("#produceUnit")).toHaveText("生产单位");
    await expect(page.locator("#buyProductionKit")).toHaveText("购买武器套件");
    await expect(page.locator("#productionQuantity")).toContainText("每批 3 台");
    expect(
      await page
        .locator("#productionPreview")
        .evaluate((c) =>
          [...c.getContext("2d").getImageData(0, 0, c.width, c.height).data].some(
            (v, i) => i % 4 === 3 && v > 0,
          ),
        ),
    ).toBe(true);
    await page.locator("#produceUnit").click();
    await expect(page.locator("#productionQuantity")).toContainText("已持有 3 台");
    await expect(page.locator("#productionResources")).toContainText("资金 4,200");
    await page.locator("#productionKit").selectOption("bazooka");
    await expect(page.locator("#productionKit")).toHaveValue("bazooka");
    await expect(page.locator("#productionKitQuantity")).toContainText("每批 3 套");
    await expect(page.locator("#productionKitPrice .resource-supplies")).toHaveText("600");
    await expect(page.locator("#productionPrice .resource-supplies")).toHaveText("1,600");
    await page.locator("#buyProductionKit").click();
    await expect(page.locator("#productionKitQuantity")).toContainText("已持有 3 套");
    await page.locator("#productionWeaponsTab").click();
    await expect(page.locator("#productionInfo")).toContainText("火箭筒");
    await expect(page.locator("#productionBaseKitName")).toHaveText("生产单位");
    const back = await page.locator("#closeProduction").boundingBox();
    const settings = await page.locator("#openClientSettings").boundingBox();
    expect(
      back.x + back.width <= settings.x ||
        back.y >= settings.y + settings.height ||
        back.y + back.height <= settings.y,
    ).toBe(true);
    const geometry = await page.evaluate(() => {
      const r = (id) => byId(id).getBoundingClientRect();
      const info = r("productionInfo"),
        price = r("productionPrice"),
        preview = r("productionPreview");
      const tabs = ["productionStatsTab", "productionWeaponsTab", "productionAbilitiesTab"].map(r);
      const money = byId("productionPrice")
        .querySelector(".resource-money")
        .getBoundingClientRect();
      const supplies = byId("productionPrice")
        .querySelector(".resource-supplies")
        .getBoundingClientRect();
      const details = document.querySelector(".production-details").getBoundingClientRect();
      const footer = document.querySelector(".production-order").getBoundingClientRect();
      const dialog = document.querySelector(".production-dialog").getBoundingClientRect();
      const heading = document.querySelector(".production-heading").getBoundingClientRect();
      return {
        gap: price.top - info.bottom,
        infoHeight: info.height,
        previewRight: preview.right,
        tabLeft: tabs[0].left,
        tabTops: tabs.map((t) => t.top),
        resourceLine: Math.abs(money.y + money.height / 2 - supplies.y - supplies.height / 2),
        footerGap: details.bottom - footer.bottom,
        footerBottom: footer.bottom,
        headingGap: heading.top - dialog.top,
        overflow: document.documentElement.scrollWidth - innerWidth,
      };
    });
    expect(geometry.gap).toBeGreaterThan(0);
    expect(geometry.infoHeight).toBeGreaterThan(180);
    expect(geometry.tabLeft).toBeGreaterThan(geometry.previewRight);
    expect(geometry.tabTops[0]).toBeLessThan(geometry.tabTops[1]);
    expect(geometry.tabTops[1]).toBeLessThan(geometry.tabTops[2]);
    expect(geometry.resourceLine).toBeLessThan(1);
    expect(geometry.footerGap).toBeLessThan(14);
    expect(geometry.headingGap).toBeLessThan(16);
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    await page.locator("#productionStatsTab").click();
    expect(
      await page.locator(".production-order").evaluate((el) => el.getBoundingClientRect().bottom),
    ).toBeCloseTo(geometry.footerBottom, 0);
    await page.screenshot({ path: `.openai/production-${width}.png`, fullPage: true });
    expect(await page.evaluate(() => ProfileSave.exportData().economy)).toMatchObject({
      money: 4200,
      supplies: 7800,
      inventory: { MS_06F: 3 },
      kits: { MS_06F__bazooka: 3 },
    });
    await page.reload();
    await page.waitForFunction(() => assetsReady);
    expect(await page.evaluate(() => Economy.quantity("MS_06F"))).toBe(3);
    expect(await page.evaluate(() => Economy.kitQuantity("MS_06F__bazooka"))).toBe(3);
    expect(errors).toEqual([]);
  });

for (const width of [1280, 390])
  test(`formation kit modal reserves stock and buys batches at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await open(page);
    await page.evaluate(() => Economy.buyKit("MS_06F__bazooka", "PMC"));
    await page.locator("#openFormation").click();
    for (let i = 0; i < 4; i++) {
      await page.locator(`[data-formation-index="${i}"] .formation-detail-button`).click();
      await page.locator("#formationDetailKit").selectOption("bazooka");
      await expect(page.locator("#formationDetailKit")).toHaveValue(
        i < 3 ? "bazooka" : "machine_gun",
      );
      if (i === 3) {
        const previewBefore = await page.locator("#formationDetailPreview").boundingBox();
        await page.locator("#openFormationKitShop").click();
        await expect(page.locator("#formationKitPrice")).toContainText("物资 600");
        await expect(page.locator("#formationKitShop")).toBeVisible();
        expect(await page.locator("#formationKitShop").evaluate((d) => d.matches(":modal"))).toBe(
          true,
        );
        await page.screenshot({ path: `.openai/kit-purchase-modal-${width}.png` });
        await page.locator("#formationKitPurchase").press("Escape");
        await expect(page.locator("#formationKitShop")).not.toBeVisible();
        await expect(page.locator("#formationUnitDetail")).toBeVisible();
        await page.locator("#openFormationKitShop").click();
        await page.locator("#buyFormationKit").click();
        expect(await page.locator("#formationDetailPreview").boundingBox()).toEqual(previewBefore);
        await expect(page.locator("#formationKitShop")).not.toBeVisible();
        await expect(page.locator("#formationDetailKit")).toHaveValue("bazooka");
        expect(await page.evaluate(() => Economy.kitQuantity("MS_06F__bazooka"))).toBe(6);
      }
      await page.locator("#formationDetailKit").press("Escape");
    }
    expect(await page.evaluate(() => Formation.current().map((e) => e.kitId))).toEqual(
      Array(4).fill("bazooka"),
    );
    expect(
      await page.evaluate(() => Economy.freeKits("MS_06F__bazooka", Formation.current())),
    ).toBe(2);
  });

test("technology shows both resource costs and rejects research when only technology points are sufficient", async ({
  page,
}) => {
  await open(page);
  const node = await page.evaluate(() => {
    Development.creditAward({
      id: "ui-tech-credit",
      matchId: "ui-tech",
      faction: "EFSF",
      points: 100000,
    });
    const n = Development.nodes("EFSF").find(
      (n) =>
        n.money > Economy.snapshot().money &&
        n.requires.every((id) => Development.unlockedTech("EFSF").includes(id)),
    );
    return { id: n.id, money: n.money, supplies: n.supplies };
  });
  await page.locator("#openDevelopment").click();
  await page.locator(`[data-tech-id="${node.id}"]`).click();
  await expect(page.locator("#developmentDetails .resource-money")).toHaveText(
    "资金 " + node.money.toLocaleString("en-US"),
  );
  await expect(page.locator("#developmentDetails .resource-supplies")).toHaveText(
    "物资 " + node.supplies.toLocaleString("en-US"),
  );
  await expect(page.locator("#developmentDetails > button")).toBeDisabled();
  await expect(page.locator("#developmentDetails")).toContainText("资金或物资不足");
});

test("owned but undeveloped chassis enable kit checkout in production and unit previews", async ({
  page,
}) => {
  await open(page);
  const kit = await page.evaluate(() => {
    const id = "RX_78_2";
    if (Development.allows("PMC", id)) throw Error("fixture must remain undeveloped");
    return Object.keys(Economy.catalog.offers)
      .find((model) => Economy.catalog.offers[model].unitId === id && Economy.kitPrice(model))
      .slice(id.length + 2);
  });
  await page.locator("#openProduction").click();
  await page.locator("#productionSearch").fill("RX_78_2");
  await page.locator('#productionList [data-unit-id="RX_78_2"]').click();
  await page.locator("#productionKit").selectOption(kit);
  await expect(page.locator("#buyProductionKit")).toBeDisabled();
  await page.evaluate(() => {
    Economy.transact({}, { RX_78_2: 1 });
  });
  // Changing selection refreshes the current preview after the externally awarded chassis.
  await page.locator("#productionKit").selectOption(kit);
  await expect(page.locator("#buyProductionKit")).toBeEnabled();
  await expect(page.locator("#produceUnit")).toBeDisabled();
  await page.locator("#buyProductionKit").click();
  expect(await page.evaluate((kit) => Economy.kitQuantity("RX_78_2__" + kit), kit)).toBeGreaterThan(
    0,
  );
  await page.locator("#closeProduction").click();
  await page.locator("#openFormation").click();
  await page.locator("#openFormationPicker").click();
  await page.locator("#formationSearch").fill("RX_78_2");
  await page.locator('[data-detail-unit-id="RX_78_2"]').click();
  await expect(page.locator("#openFormationKitShop")).toBeEnabled();
  await page.locator("#openFormationKitShop").click();
  await page.locator("#formationKitPurchase").selectOption(kit);
  await expect(page.locator("#buyFormationKit")).toBeEnabled();
  await page.locator("#buyFormationKit").click();
  await page.evaluate(() => {
    Economy.sellUnit("RX_78_2");
  });
  await page.locator("#closeFormationDetail").click();
  await page.locator("#formationStock").selectOption("all");
  await page.locator('[data-detail-unit-id="RX_78_2"]').click();
  await expect(page.locator("#openFormationKitShop")).toBeDisabled();
});
