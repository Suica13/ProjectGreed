const {test,expect} = require("@playwright/test");
const {pathToFileURL} = require("node:url"), path = require("node:path");
for (const entry of ["client", "developer"]) test(entry + " shows native pilot gates in preview and battle weapon cards", async ({page}) => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/" + entry + ".html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellHangar").click();
  await page.evaluate(() => Formation.previewUnit("RX_78_2"));
  const card = page.locator("#formationDetailSlots .weapon-card").filter({hasText:"驾驶员要求"});
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("格斗 > 145");
  const result = await page.evaluate(async () => {
    const [id,m] = Object.entries(UnitModels).find(([,m])=>m.prefabId === "RX_78_2");
    const w = m.weapons.find(w=>w.pilotRequirements);
    const unit = {id:"test",model:id,hp:m.hp,en:m.en,shield:m.shield.hp,x:5,y:5,
      pilot:{stats:{shooting:100,melee:145,defense:100,speed:100,accuracy:100,reaction:100,leadership:80,awakening:60}}};
    const locked = WeaponInfo.summary(w,{unit});
    const disabled = locked.querySelector(".weapon-unavailable")?.textContent;
    unit.pilot.stats.melee = 146;
    const unlocked = WeaponInfo.summary(w,{unit});
    I18n.setLanguage("en");
    const english = WeaponInfo.summary(w,{unit}).textContent;
    I18n.setLanguage("ja");
    const japanese = WeaponInfo.summary(w,{unit}).textContent;
    I18n.setLanguage("zh");
    await SpriteRenderer.load();
    const blades = [];
    for (const at of [0,.6,1.4,2.1]) {
      const pose = WeaponSequence.pose(w,at);
      blades.push(SpriteRenderer.visibleLayers(id,w.id,true,false,pose.clip,pose.time,false,{},true,false,"ground",w.id,pose.weaponDisplayIndex)
        .filter(l=>l.name.startsWith("EF_BeamSaber_Double_AALDF")).length);
    }
    return {disabled,unlocked:unlocked.querySelectorAll(".weapon-unavailable").length,english,japanese,blades};
  });
  expect(result.disabled).toContain("当前 145");
  expect(result.unlocked).toBe(0);
  expect(result.english).toContain("Pilot requirement");
  expect(result.japanese).toContain("パイロット条件");
  expect(result.blades).toEqual([2,2,2,2]);
  expect(errors).toEqual([]);
});
