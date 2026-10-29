const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url");
const path=require("node:path");
test("new empty squads persist and cannot start a room",async({page})=>{
 const errors=[]; page.on("pageerror",e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 await page.locator("#shellHangar").click();
 await page.locator("#newFormation").click();
 expect(await page.evaluate(()=>Formation.current())).toEqual([]);
 await page.reload();
 await page.locator("#shellHangar").click();
 expect(await page.evaluate(()=>Formation.current())).toEqual([]);
 await page.locator("#shellLobby").click();
 await page.locator("#openSkirmish").click();
 await page.locator("#createOfflineRoom").click();
 await expect(page.locator("#startRoomGame")).toBeDisabled();
 expect(await page.evaluate(()=>Net.snapshot.settings.unitCostLimit)).toBe(250);
 expect(errors).toEqual([]);
});
