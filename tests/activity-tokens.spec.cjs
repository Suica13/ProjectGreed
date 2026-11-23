const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");

for (const width of [1280, 390]) test(`activity tokens persist atomically after a failed claim at ${width}px`, async ({ page, context }) => {
  test.setTimeout(120000);
  const app=createServer({host:"127.0.0.1",port:0}),address=await app.listen();
  const base=`http://127.0.0.1:${address.port}`,errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.setViewportSize({width,height:960});
  try {
    await page.goto(base);await page.waitForFunction(()=>assetsReady);
    await page.evaluate(()=>{
      const profile=Economy.initial("EFSF");profile.supplyTestGrant=true;
      profile.itemInventory={"0079t1-token":100};
      localStorage.setItem(Economy.key,SaveCodec.stringify(profile));
    });
    await page.reload();await page.waitForFunction(()=>assetsReady);
    await page.evaluate(base=>{I18n.setLanguage("zh");Lobby.reconnect(base);},base);
    await expect(page.locator("#openServerActivities")).toBeEnabled();
    const admin=await context.newPage();await admin.setViewportSize({width,height:960});
    await admin.goto(base+"/admin/activities.html");
    await expect(admin.locator("#activities button").first()).toBeVisible();
    await admin.locator("#title").fill("代币赠送测试");
    await admin.locator("#mode").selectOption("online_now");
    await admin.locator("#supplyTokens").fill("123");
    await admin.locator("#publish").click();
    await expect(admin.locator("#status")).toContainText("活动已发布");
    await page.locator("#openServerActivities").click();
    await page.locator(".server-activities-list button").filter({hasText:"代币赠送测试"}).click();
    await expect(page.locator(".server-activities-detail")).toContainText("0079年代补给代币 ×123");
    expect(await page.locator("#serverActivitiesDialog").evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true);
    await page.evaluate(()=>{
      const original=Storage.prototype.setItem;let failed=false;
      Storage.prototype.setItem=function(key,value){
        if(!failed&&key==="projectgreed.developmentProgress.v1"){failed=true;throw Error("token save failed");}
        return original.call(this,key,value);
      };
    });
    await page.locator("#acceptServerActivity").click();
    await expect(page.locator("#serverActivityStatus")).toContainText("token save failed");
    expect(await page.evaluate(()=>Economy.snapshot().itemInventory["0079t1-token"])).toBe(100);
    await page.locator("#acceptServerActivity").click();
    await expect(page.locator("#acceptServerActivity")).toHaveText("已接受");
    expect(await page.evaluate(()=>Economy.snapshot().itemInventory["0079t1-token"])).toBe(223);
    await page.screenshot({path:`tmp/verification/screenshots/activity-tokens-${width}.png`});
    await page.reload();await page.waitForFunction(()=>assetsReady);
    await page.evaluate(base=>{I18n.setLanguage("zh");Lobby.reconnect(base);},base);
    await expect(page.locator("#openServerActivities")).toBeEnabled();
    await page.locator("#openServerActivities").click();
    await page.locator(".server-activities-list button").filter({hasText:"代币赠送测试"}).click();
    await expect(page.locator("#acceptServerActivity")).toHaveText("已接受");
    expect(await page.evaluate(()=>Economy.snapshot().itemInventory["0079t1-token"])).toBe(223);
    await page.locator("#serverActivitiesDialog").getByRole("button",{name:"关闭",exact:true}).click();
    await page.locator("#shellHangar").click();await page.locator("#shellItemStorage").click();
    await page.locator("#warehouseItemsTab").click();
    await expect(page.locator(".item-storage-detail")).toContainText("0079年代补给代币");
    await expect(page.locator(".item-storage-count")).toHaveText("×223");
    expect(errors).toEqual([]);await admin.close();
  } finally { await app.close(); }
});
