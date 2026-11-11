const {test,expect}=require("@playwright/test"),{pathToFileURL}=require("node:url"),path=require("node:path");
const P=require("../shared/pilots");
for(const width of [1440,390]) test(`PMC dialogue editing, cancellation and JSON round trip at ${width}px`,async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.setViewportSize({width,height:920});
  const pilot=P.createCustom("custom-dialogue-ui","Dialogue UI");
  await page.addInitScript(p=>{
    if(localStorage.getItem("dialogue-seeded"))return;
    localStorage.setItem("dialogue-seeded","yes");
    localStorage.setItem("projectgreed.language","zh");
    localStorage.setItem("projectgreed.custom-pilots.v3.shared",JSON.stringify({pilots:[p],awards:[]}));
  },pilot);
  async function open(){
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(()=>assetsReady);
    await page.locator("#shellHangar").click();
    await page.locator("#shellSubnav").getByRole("button",{name:"驾驶员",exact:true}).click();
    await page.getByRole("button",{name:"管理驾驶员 Dialogue UI",exact:true}).click();
    if(await page.locator("#customPilotPersonality").inputValue() !== "custom") {
      await expect(page.locator("#editPilotDialogue")).toBeHidden();
      await page.locator("#customPilotPersonality").selectOption("custom");
    }
    await page.locator("#editPilotDialogue").click();
  }
  await open();
  await page.locator("#pilotDialogueLines").fill("攻击台词一\n攻击台词二");
  await page.locator("#pilotDialogueEvent").selectOption("kill");
  await page.locator("#pilotDialogueLines").fill("击破确认");
  await page.locator("#savePilotDialogue").click();
  expect(await page.evaluate(()=>Formation.exportPilotStores().PMC.pilots[0].dialogue)).toEqual({attack:["攻击台词一","攻击台词二"],kill:["击破确认"]});
  await open();
  await expect(page.locator("#pilotDialogueLines")).toHaveValue("攻击台词一\n攻击台词二");
  const box=await page.locator("#pilotDialogueEditor").boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
  const downloadPromise=page.waitForEvent("download");await page.locator("#exportPilotDialogue").click();
  const download=await downloadPromise;const fs=require("node:fs");
  const saved=JSON.parse(fs.readFileSync(await download.path(),"utf8"));
  expect(saved.format).toBe("projectgreed.pilot-dialogue");
  await page.locator("#pilotDialogueLines").fill("取消的台词");
  await page.locator("#cancelPilotDialogue").click();
  await page.locator("#editPilotDialogue").click();
  await expect(page.locator("#pilotDialogueLines")).toHaveValue("攻击台词一\n攻击台词二");
  await page.locator("#pilotDialogueFile").setInputFiles({name:"invalid.json",mimeType:"application/json",buffer:Buffer.from('{"format":"wrong"}')});
  await expect(page.locator("#pilotDialogueStatus")).toContainText("格式或版本无效");
  await expect(page.locator("#pilotDialogueLines")).toHaveValue("攻击台词一\n攻击台词二");
  const imported={...saved,dialogue:{passengerLaunch:["开始出击","保持警戒"]}};
  await page.locator("#pilotDialogueFile").setInputFiles({name:"dialogue.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(imported))});
  await expect(page.locator("#pilotDialogueStatus")).toContainText("点击保存后生效");
  expect(await page.evaluate(()=>Formation.exportPilotStores().PMC.pilots[0].dialogue)).toEqual(saved.dialogue);
  await page.locator("#savePilotDialogue").click();
  await open();
  await page.locator("#pilotDialogueEvent").selectOption("passengerLaunch");
  await expect(page.locator("#pilotDialogueLines")).toHaveValue("开始出击\n保持警戒");
  expect(await page.evaluate(()=>Formation.exportPilotStores().PMC.pilots[0].stats)).toEqual(pilot.stats);
  await page.locator("#cancelPilotDialogue").click();
  await page.locator("#customPilotPersonality").selectOption("calm");
  await expect(page.locator("#editPilotDialogue")).toBeHidden();
  await page.locator("#customPilotPersonality").selectOption("custom");
  await page.locator("#editPilotDialogue").click();
  await page.locator("#pilotDialogueEvent").selectOption("passengerLaunch");
  await expect(page.locator("#pilotDialogueLines")).toHaveValue("开始出击\n保持警戒");
  expect(errors).toEqual([]);
});
