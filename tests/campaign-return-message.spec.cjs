const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");
test("annihilation and base capture show objective completion; turn limits retain interruption text",async({page})=>{
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);await expect(page.locator("#openSkirmish")).toBeEnabled();
 await page.clock.install();
 for(const [winner,captured,completed]of [[0,null,true],[null,1,true],[null,null,false]]){
  await page.evaluate(({winner,captured})=>{
   I18n.setLanguage("zh");setPageView("game");
   const now=Date.now();Net.snapshot={started:true,phase:"campaign_paused",serverTime:now,
    game:{winner,campaignBattlefield:{capturedBaseTeam:captured}},
    returnCountdown:{id:"return-"+winner+"-"+captured,at:now+5000,destination:"campaign"}};
   BattlePrompts.receive(Net.snapshot);
  },{winner,captured});
  await expect(page.locator("#roomReturnCountdown")).toBeVisible();
  await expect(page.locator("#roomReturnTitle")).toHaveText(completed?"已经完成战略目的":"战局中断，返回战略地图");
  await expect(page.locator("#roomReturnMessage")).toHaveText(completed?"返回战略大地图剩余5秒":"5秒后所有玩家一起返回战略地图");
  await page.clock.fastForward(1100);
  await expect(page.locator("#roomReturnMessage")).toHaveText(completed?"返回战略大地图剩余4秒":"4秒后所有玩家一起返回战略地图");
 }
 await page.evaluate(()=>{Net.snapshot.returnCountdown=null;BattlePrompts.receive(Net.snapshot)});
 await expect(page.locator("#roomReturnCountdown")).not.toBeVisible();
});
