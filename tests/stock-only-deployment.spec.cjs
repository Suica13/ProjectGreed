const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");
for(const width of [1280,390])test(`unlicensed stock switches existing kits and cannot buy or replenish at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:960});
 await page.addInitScript(()=>{
 localStorage.setItem("projectgreed.combatFaction","PMC");
 localStorage.setItem("projectgreed.economy.v1",JSON.stringify({schemaVersion:3,money:1000000,supplies:1000000,licenses:{},inventory:{MS_14A:2},kits:{MS_14A__beam_rifle:1,MS_14A__bazooka:1}}));
 localStorage.setItem("slg-formations-v1.PMC",JSON.stringify({version:3,squads:[{name:"Stock only",units:[{unitId:"MS_14A",kitId:"beam_rifle"},{unitId:"MS_14A",kitId:"bazooka"}]}]}));
 });
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 await page.waitForFunction(()=>typeof assetsReady!=="undefined"&&assetsReady);
 await page.evaluate(()=>{I18n.setLanguage("zh");MenuShell.go("formation")});
 expect(await page.evaluate(()=>Development.allows("PMC","MS_14A"))).toBe(false);
 expect(await page.evaluate(()=>Economy.purchasePlan([{unitId:"MS_14A",kitId:"beam_rifle"},{unitId:"MS_14A",kitId:"bazooka"}]).items.length)).toBe(0);
 await page.locator("#formationUnits .formation-detail-button").first().click();
 await expect(page.locator("#buyPreviewKit")).toBeDisabled();
 await expect(page.locator("#producePreviewUnit")).toBeDisabled();
 await expect(page.locator("#formationDetailKit")).toBeEnabled();
 await page.locator("#formationDetailKit").selectOption("bazooka");
 await expect(page.locator("#formationDetailKit")).toHaveValue("bazooka");
 await expect(page.locator("#buyPreviewKit")).toBeDisabled();
 await page.locator("#closeFormationDetail").click();
 const before=await page.evaluate(()=>JSON.stringify(Economy.snapshot()));
 await page.locator("#produceMissingFormation").click();
 await expect(page.locator("dialog[open]")).toContainText("无法补充库存");
 await expect(page.locator("dialog[open]")).toContainText("尚未开发");
 expect(await page.evaluate(()=>JSON.stringify(Economy.snapshot()))).toBe(before);
});
