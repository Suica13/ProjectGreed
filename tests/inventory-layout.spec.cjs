const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
for (const [width, height] of [[1440, 960], [1280, 720], [390, 844], [844, 390]])
  test(`inventory cells, gold rentals and supply scroll boundaries ${width}x${height}`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    page.setDefaultTimeout(12000);
    await page.evaluate(() => {
      I18n.setLanguage("zh");
      const profile = Economy.initial("EFSF");
      profile.pluginInventory = Object.fromEntries(UnitPlugins.catalog.map(part => [part.id, 2]));
      profile.itemInventory = { "0079t1-token": 100 };profile.supplyTestGrant = true;
      localStorage.setItem(Economy.key, SaveCodec.stringify(profile));
    });
    await page.reload();await page.waitForFunction(() => assetsReady);
    await page.locator("#shellHangar").click();await page.locator("#shellItemStorage").click();
    const list = page.locator(".item-storage-list"), detail = page.locator(".item-storage-detail");
    for (const [id, name] of [["warehousePartsTab", "零件"], ["warehouseItemsTab", "道具"], ["warehouseMaterialsTab", "材料"]]) {
      await page.locator("#" + id).click();
      await expect(page.locator("#" + id)).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator(".item-storage-grid")).toHaveAttribute("aria-label", name);
      expect(await page.locator(".item-storage-slot").count()).toBeGreaterThanOrEqual(24);
      const a = await list.boundingBox(), b = await detail.boundingBox();
      expect(a.x + a.width).toBeLessThanOrEqual(b.x);
      expect(Math.abs(a.y - b.y)).toBeLessThan(2);
      expect(await page.locator(".item-storage-body").evaluate(node => node.scrollHeight <= node.clientHeight + 1)).toBe(true);
      if (name === "零件") {
        await list.evaluate(node => node.scrollTop = node.scrollHeight);
        await page.locator('[data-plugin-id]').last().click();
        await expect(detail.locator(".plugin-card")).toBeVisible();
      }
      await page.screenshot({ path: `tmp/verification/screenshots/inventory-${id}-${width}-${height}.png` });
    }
    await expect(detail).toContainText("材料获取暂未开放");
    const rentalId = await page.evaluate(() => {
      Economy.creditActivity({ id:"layout-rental", matchId:"layout-rental", money:0, supplies:0, rentals:[{unitId:"RX_78_5",count:1,uses:5}] });
      const item = Economy.snapshot().storage.units.find(item => item.rentalUses);
      WarehouseUI.open();WarehouseUI.openItem(item.id);return item.id;
    });
    const badge = page.locator("#warehouseDialog .warehouse-condition.rental");
    await expect(badge).toHaveText("剩余次数:5次");
    expect(await badge.evaluate(node => getComputedStyle(node).backgroundImage)).toContain("linear-gradient");
    await page.locator("#warehouseClose").click();
    await page.locator("#shellMissions").click();await page.locator("#shellContactSupply").click();
    await page.evaluate(() => {
      const list = document.querySelector(".supply-pool-list"), card = list.querySelector(".supply-pool-card");
      for(let i=0;i<15;i++) list.append(card.cloneNode(true));
    });
    const panels = await page.evaluate(() => {
      const content=document.querySelector(".contact-content"), right=document.querySelector(".supply-detail"), list=document.querySelector(".supply-pool-list");
      const bounds=content.getBoundingClientRect(), action=document.querySelector("#supplyDrawTen").getBoundingClientRect();
      list.scrollTop=list.scrollHeight;
      return { outer:content.scrollHeight<=content.clientHeight+1, right:right.scrollHeight<=right.clientHeight+1,
        list:list.scrollTop>0, bottom:action.bottom<=bounds.bottom+1, visible:action.height>0, page:document.documentElement.scrollWidth<=innerWidth };
    });
    expect(panels).toEqual({outer:true,right:true,list:true,bottom:true,visible:true,page:true});
    await page.screenshot({ path: `tmp/verification/screenshots/supply-fixed-${width}-${height}.png` });
    await page.locator("#shellContactTasks").click();
    await expect(page.locator(".contact-content")).not.toHaveClass(/is-supply/);
    expect(errors).toEqual([]);
  });
