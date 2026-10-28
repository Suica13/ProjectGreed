const {test,expect}=require("@playwright/test"),{pathToFileURL}=require("node:url"),path=require("node:path");
for(const entry of ["client","developer"])test(entry+" refits owned inventory through a responsive unit preview modal",async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/"+entry+".html")).href);
  await page.waitForFunction(()=>assetsReady);
  await page.locator("#shellHangar").click();
  const before=await page.evaluate(()=>{
    Development.grantUnit("EFSF","Type61A5");
    Formation.previewUnit("Type61");return Economy.snapshot();
  });
  await page.locator("#openFormationRefits").click();
  const modal=page.locator("#unitRefitDialog");await expect(modal).toBeVisible();
  await modal.getByRole("button",{name:"详细",exact:true}).first().click();
  await expect(page.locator("#unitRefitViewer")).toBeVisible();
  await expect(page.locator("#unitRefitViewer .weapon-summary").first()).toBeVisible();
  await page.locator("#unitRefitViewer").getByRole("button",{name:"返回",exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  const box=await modal.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(390);
  await expect(modal.getByRole("button",{name:"改造",exact:true})).toBeEnabled();
  const cost=await page.evaluate(()=>Economy.refitOptions("Type61")[0]);
  await modal.getByRole("button",{name:"改造",exact:true}).click();
  await expect(modal).not.toBeVisible();
  const after=await page.evaluate(()=>Economy.snapshot());
  expect(after.inventory.Type61).toBe(before.inventory.Type61-1);
  expect(after.inventory.Type61A5||0).toBe((before.inventory.Type61A5||0)+1);
  expect(after.money).toBe(before.money-cost.money);expect(after.supplies).toBe(before.supplies-cost.supplies);
  await expect(page.locator("#formationDetailKit")).toHaveValue(await page.evaluate(()=>Economy.baseKit("Type61A5")));
  await expect(page.locator("#formationDetailTitle")).toContainText("61");
  expect(errors).toEqual([]);
});
test("Guncannon loadouts and GP02 shoulder housings select exactly their native variant",async({page})=>{
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  const rows=await page.evaluate(async()=>{
    await SpriteRenderer.load();const rows=[];
    for(const [id,m] of Object.entries(UnitModels).filter(([,m])=>["RX_77_3","RX_78GP02A"].includes(m.prefabId))) {
      for(const moving of [false,true]) {
        const layers=SpriteRenderer.visibleLayers(id,m.weapons[0]?.id,true,moving,null,0,false,{},false,true,"ground").map(l=>l.name);
        rows.push({unit:m.prefabId,id,moving,layers,beam:m.weapons.some(w=>w.id === "EF_RX_77_4_BeamCannon")});
      }
    }
    return rows;
  });
  for(const r of rows)if(r.unit === "RX_77_3") {
    expect(r.layers.includes("RX_77_3_Cannon")).toBe(!r.beam);
    expect(r.layers.includes("RX_77_4_Cannon")).toBe(r.beam);
  }else{
    for(const side of ["L","R"]) {
      expect(r.layers.includes("Shoulder"+side+"_Booster_On")).toBe(r.moving);
      expect(r.layers.includes("Shoulder"+side+"_Booster_Off")).toBe(!r.moving);
    }
  }
});
