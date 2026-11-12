const {test,expect}=require("@playwright/test"),{pathToFileURL}=require("node:url"),path=require("node:path");
const P=require("../shared/pilots");
for(const width of [1440,390]) test(`rebirth payment and second skill UI persist at ${width}px`,async({page})=>{
  test.setTimeout(60000);
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.setViewportSize({width,height:950});
  const pilots=[P.custom({...P.createCustom("custom-cap","Capped"),level:8,experience:30000}),
    P.learnSkill(P.custom({...P.createCustom("custom-twelve","Twelve"),level:12,reincarnations:4}),P.skillChoices[0].id),
    P.custom({...P.createCustom("custom-ready","Ready"),level:1,reincarnations:1,experience:2000})];
  await page.addInitScript(pilots=>{
    if(localStorage.getItem("rebirth-seeded"))return;
    localStorage.setItem("rebirth-seeded","yes");
    localStorage.setItem("projectgreed.language","zh");
    localStorage.setItem("projectgreed.economy.v1",JSON.stringify({money:500000,supplies:100000,inventory:{},kits:{}}));
    localStorage.setItem("projectgreed.custom-pilots.v3.shared",JSON.stringify({pilots,awards:[]}));
  },pilots);
  async function open(){
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(()=>assetsReady);
    await page.locator("#shellHangar").click();
    await page.locator("#shellSubnav").getByRole("button",{name:"驾驶员",exact:true}).click();
  }
  await open();
  const ready=page.locator("#customPilotList > li, #customPilotList > div").filter({has:page.getByRole("button",{name:"管理驾驶员 Ready",exact:true})});
  expect(await ready.locator(".pilot-training-points").allTextContents()).toEqual(["一转","可升职","强化点+"]);
  expect(await ready.evaluate(el=>{
    const progress=el.querySelector(".pilot-roster-progress").getBoundingClientRect(), skills=el.querySelector(".pilot-list-skills").getBoundingClientRect();
    return progress.bottom<=skills.top+1;
  })).toBe(true);
  await page.getByRole("button",{name:"管理驾驶员 Capped",exact:true}).click();
  await expect(page.locator("#customPilotOriginFaction")).toBeHidden();
  await expect(page.locator("#editPilotDialogue")).toBeVisible();
  await expect(page.locator("#upgradePilot")).toContainText("转生");
  await expect(page.locator("#upgradePilot")).toContainText("80000");
  const money=await page.evaluate(()=>Economy.snapshot().money);
  await page.locator("#upgradePilot").click();
  await page.locator("#gameDialog button").last().click();
  await expect(page.locator("#customPilotProgress")).toContainText("Lv.0");
  expect(await page.evaluate(()=>Economy.snapshot().money)).toBe(money-80000);
  const saved=await page.evaluate(()=>Formation.exportPilotStores().PMC.pilots.find(p=>p.name==="Capped"));
  expect(saved).toMatchObject({level:0,reincarnations:1,experience:0,points:80});
  await page.locator("#finishCustomPilot").click();
  await page.getByRole("button",{name:"管理驾驶员 Twelve",exact:true}).click();
  await expect(page.locator("#upgradePilot")).toBeHidden();
  await page.locator("#learnPilotSkill").click();
  await expect(page.locator("[data-pilot-skill-choice]")).toHaveCount(5);
  await page.locator("[data-pilot-skill-choice]").first().click();
  await page.locator("#confirmPilotSkill").click();
  await expect(page.locator("#learnPilotSkill")).toHaveText("查看驾驶员技能");
  await page.locator("#finishCustomPilot").click();
  await page.screenshot({path:`tmp/verification/screenshots/pilot-rebirth-${width}.png`});
  await open();
  expect(await page.evaluate(()=>Formation.exportPilotStores().PMC.pilots.find(p=>p.name==="Twelve").selectedSecondSkillId)).toBeTruthy();
  expect((await page.locator("#customPilotList .pilot-cost-tag").allTextContents()).every(text=>!text.includes("+"))).toBe(true);
  expect(errors).toEqual([]);
});
