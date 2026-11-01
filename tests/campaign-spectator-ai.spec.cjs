const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
test("spectating an AI-only campaign automatically advances strategic planning", async ({ page }) => {
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
  await expect.poll(() => page.evaluate(() => Net.snapshot.campaign.turn), { timeout: 10000 }).toBeGreaterThan(1);
  expect(await page.evaluate(() => Net.snapshot.members.filter(m => Number.isInteger(m.seat)).every(m => m.bot))).toBe(true);
});


test("automatic local battles show the battlefield instead of forcing spectator seats open", async ({ page }) => {
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
  await expect.poll(() => page.evaluate(() => Net.started)).toBe(true);
  await expect(page.locator("#gameScene")).toBeVisible();
  await expect(page.locator("#roomPreparation")).toBeHidden();
  await expect(page.locator("#campaignSeatsDialog")).not.toBeVisible();
  await page.locator("#roomSettings").click();
  await expect(page.locator("#roomPreparation")).toBeVisible();
});
