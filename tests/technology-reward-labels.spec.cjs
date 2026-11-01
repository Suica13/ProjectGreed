const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");
test("technology notifications match each faction's credited balance and do not duplicate awards",async({page})=>{
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 await expect(page.locator("#openSkirmish")).toBeEnabled();
 await page.evaluate(()=>I18n.setLanguage("zh"));
 for(const [faction,name]of [["EFSF","地球联邦军"],["ZEON","吉翁公国军"],["AEUG","奥古"],["TITANS","提坦斯"],["NEO_ZEON","新吉翁"]]){
  const balances=await page.evaluate(faction=>{
   setPageView("menu");setPageView("game");
   const before=Object.fromEntries(Development.factions.map(f=>[f,Development.pointBalance(f)]));
   const snapshot={phase:"idle",matchId:"label-test",techAwards:[{id:"label-"+faction,matchId:"label-test",faction,points:17}]};
   DevelopmentUI.receiveAwards(snapshot);DevelopmentUI.receiveAwards(snapshot);
   return {before,after:Object.fromEntries(Development.factions.map(f=>[f,Development.pointBalance(f)]))};
  },faction);
  await expect(page.locator('#techRewardStack [data-reward-kind="resources"]')).toHaveText(`获得 ${name} 科技点 +17`);
  for(const f of Object.keys(balances.before))expect(balances.after[f]-balances.before[f]).toBe(f===faction?17:0);
 }
});
