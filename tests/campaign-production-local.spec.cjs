const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");
test("regional orders and reserved production slots update immediately",async({page})=>{
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 await expect(page.locator("#openSkirmish")).toBeEnabled();
 await page.evaluate(()=>{const factory=createRoomEngine;createRoomEngine=options=>(window.testEngine=factory(options));});
 await page.locator("#openSkirmish").click();await page.locator("#offlineRoomMode").selectOption("campaign");
 await page.locator("#createOfflineRoom").click();await page.locator("#startRoomGame").click();
 await page.locator(".campaign-setup button").last().click();await expect(page.locator("#campaignScreen")).toBeVisible();
 await expect.poll(()=>page.evaluate(()=>Net.awaiting)).toBe(null);
 await page.evaluate(()=>{
  const room=[...testEngine.rooms.values()][0],s=room.campaign,ctx={G:Rules,world:CAMPAIGN_WORLD,production:PRODUCTION_CATALOG,development:Development};
  CampaignRules.action(ctx,s,room.seats.filter(Boolean),0,{action:"campaign_produce",turn:s.turn,region:"jaburo",unitId:"Type61"});
  CampaignRules.action(ctx,s,room.seats.filter(Boolean),0,{action:"campaign_produce",turn:s.turn,region:"belfast",unitId:"FF_B2"});
  room.revision++;testEngine.broadcast(room);
 });
 await page.locator(".campaign-detail .campaign-tabs").getByRole("button",{name:"订单",exact:true}).click();
 await expect(page.locator(".campaign-detail .campaign-order-list .campaign-order")).toHaveCount(1);
 await expect(page.locator(".campaign-detail .campaign-order-list")).toContainText("贾布罗");
 await expect(page.locator(".campaign-detail .campaign-order-list")).not.toContainText("贝尔法斯特");
 await page.locator(".campaign-detail").getByRole("button",{name:"生产",exact:true}).click();
 const workspace=page.locator("#campaignWorkspace");
 await expect(workspace).toBeVisible();
 await expect(workspace.locator('.campaign-purchase')).toContainText("并行生产槽位 1/5");
 await workspace.locator('[data-unit-id="Type61"]').click();
 await workspace.getByRole("button",{name:"提交生产请求",exact:true}).click();
 await expect(workspace.locator('.campaign-purchase')).toContainText("并行生产槽位 2/5");
});
