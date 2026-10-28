const {test,expect} = require("@playwright/test");
const {pathToFileURL} = require("node:url"),path=require("node:path");
for (const entry of ["client","developer"]) test(entry+" displays learning computer as an active passive",async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/"+entry+".html")).href);
  await page.waitForFunction(()=>assetsReady);
  await page.locator("#shellHangar").click();
  await page.evaluate(()=>Formation.previewUnit("RX_78_2"));
  const card=page.locator("#formationDetailMechanics .formation-weapon-detail").filter({hasText:"学习型电脑"});
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("驾驶员经验获取×1.1");
  await expect(card).toContainText("回合制改编");
  const labels=await page.evaluate(()=>{
    I18n.setLanguage("en");const en=I18n.text("学习型电脑：驾驶员经验获取×1.1");
    I18n.setLanguage("ja");const ja=I18n.text("学习型电脑：驾驶员经验获取×1.1");
    return {en,ja};
  });
  expect(labels.en).toBe("Learning Computer: pilot experience ×1.1");
  expect(labels.ja).toBe("学習型コンピューター：パイロット経験値×1.1");
  expect(errors).toEqual([]);
});
