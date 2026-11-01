const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
test("spectator host explicitly ends AI-only strategic planning", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#openSkirmish").click();
  await page.locator("#offlineRoomMode").selectOption("campaign");
  await page.locator("#createOfflineRoom").click();
  await page.evaluate(() => Net.request("add_ai", { seat: 2 }));
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  await page.locator("#startRoomGame").click();
  await page.locator(".campaign-setup button").last().click();
  await expect(page.locator("#campaignScreen")).toBeVisible();
  await page.locator(".campaign-header-utilities").getByRole("button", { name: "玩家席位", exact: true }).click();
  await page.locator("#campaignBecomeSpectator").click();
  await expect.poll(() => page.evaluate(() => Net.seat)).toBe(null);
  await page.locator("#campaignSeatsDialog").getByRole("button", { name: "关闭", exact: true }).click();
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => Net.snapshot.campaign.turn)).toBe(1);
  const finish=page.locator('.campaign-end-turn');await expect(finish).toBeEnabled();
  await finish.click();await page.locator('#gameDialog').getByRole('button',{name:'确定',exact:true}).click();
  await expect.poll(() => page.evaluate(() => Net.snapshot.campaign.turn), { timeout: 10000 }).toBeGreaterThan(1);
  expect(await page.evaluate(() => Net.snapshot.members.filter(m => Number.isInteger(m.seat)).every(m => m.bot))).toBe(true);
});


test("host-started AI local battles show one centered start button and then the battlefield", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    const factory=createRoomEngine;
    createRoomEngine=options=>(window.testEngine=factory(options));
  });
  await page.locator("#openSkirmish").click();
  await page.locator("#offlineRoomMode").selectOption("campaign");
  await page.locator("#createOfflineRoom").click();
  await page.evaluate(() => Net.request("add_ai", { seat: 2 }));
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  await page.locator("#startRoomGame").click();
  await page.locator(".campaign-setup button").last().click();
  await expect(page.locator("#campaignScreen")).toBeVisible();
  await page.evaluate(() => {
    const room=[...testEngine.rooms.values()][0];
    room.campaignLobby=true;
    Net.request("switch_seat",{seat:null});
  });
  await expect.poll(() => page.evaluate(() => Net.seat)).toBe(null);
  await page.evaluate(() => {
    const room=[...testEngine.rooms.values()][0],s=room.campaign;
    CampaignRules.addUnit({G:Rules,production:PRODUCTION_CATALOG},s,2,"canada_east","Type61");
    const enemy=CampaignRules.addUnit({G:Rules,production:PRODUCTION_CATALOG},s,1,"canada_east","MS_06F");
    enemy.entryFrom="new_york";
    s.phase="encounters";
    s.encounters=[{region:"canada_east",turn:0,battleSave:null,roster:{},settled:[]}];
    room.campaignLobby=false;room.revision++;testEngine.broadcast(room);
  });
  const drawer=page.locator('#campaignEncounterDialog');await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('button',{name:'AI委任',exact:true})).toHaveCount(0);
  await expect(drawer.getByRole('button',{name:'手动指挥',exact:true})).toHaveCount(0);
  const start=drawer.getByRole('button',{name:'开始交战',exact:true});await expect(start).toBeEnabled();
  await page.waitForTimeout(800);expect(await page.evaluate(()=>Net.started)).toBe(false);
  await start.click();
  await expect.poll(() => page.evaluate(() => Net.started)).toBe(true);
  await expect(page.locator("#gameScene")).toBeVisible();
  await expect(page.locator("#roomPreparation")).toBeHidden();
  await expect(page.locator("#campaignSeatsDialog")).not.toBeVisible();
  await page.locator("#roomSettings").click();
  await expect(page.locator("#roomPreparation")).toBeVisible();
});
