const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");
for(const width of [1440,390])test(`formation picker shows rental and assigned pilot corner badges at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:960});
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  await page.locator("#profileCompanyName").fill("Badge PMC");
  await page.locator("#profileOnboardingConfirm").click();
  await page.evaluate(()=>{
    I18n.setLanguage("zh");
    const pilot=PilotSystem.createCustom("custom-picker-badge","角标测试驾驶员");
    localStorage.setItem("projectgreed.custom-pilots.v3.shared",JSON.stringify({pilots:[pilot],awards:[]}));
    const profile=Economy.snapshot();
    profile.baseFacilities={version:2,levels:{hq:3,factory:2,giantFactory:3,beacon:3,academy:1}};
    localStorage.setItem("projectgreed.economy.v1",JSON.stringify(profile));
  });
  await page.reload();await page.waitForFunction(()=>assetsReady);
  const stock=await page.evaluate(()=>{
    Economy.creditActivity({id:"picker-rental-badge",matchId:"picker-rental-badge",money:0,supplies:0,
      rentals:[{unitId:"RGM_79",kitId:"beam_spray",count:1,uses:7,plugins:[]}]});
    const rental=Economy.snapshot().storage.units.find(item=>item.rentalUses);
    Economy.setStoredPilot(rental.id,"custom-picker-badge");
    MenuShell.go("formation");return rental.id;
  });
  await page.locator("#formationEditorStyle").selectOption("free");
  await page.locator("#openFormationPicker").click();
  const card=page.locator(`#formationCatalog [data-stock-id="${stock}"]`);
  await card.scrollIntoViewIfNeeded();
  await expect(card.locator(".catalog-rental-badge")).toHaveText("租赁 7");
  await expect(card.locator(".catalog-pilot-badge")).toHaveAttribute("data-pilot-id","custom-picker-badge");
  await expect(card.locator(".catalog-pilot-badge")).toHaveAttribute("title",/角标测试驾驶员/);
  const layout=await card.locator(".catalog-unit-portrait").evaluate(frame=>{
    const rect=frame.getBoundingClientRect(),rental=frame.querySelector(".catalog-rental-badge").getBoundingClientRect(),
      pilot=frame.querySelector(".catalog-pilot-badge").getBoundingClientRect(),image=frame.querySelector(".catalog-pilot-badge img");
    const inside=box=>box.left>=rect.left&&box.top>=rect.top&&box.right<=rect.right&&box.bottom<=rect.bottom;
    return {rental:inside(rental),pilot:inside(pilot),separate:rental.bottom<=pilot.top,
      loaded:image.complete&&image.naturalWidth>0};
  });
  expect(layout).toEqual({rental:true,pilot:true,separate:true,loaded:true});
  await page.screenshot({path:`tmp/verification/screenshots/formation-picker-badges-${width}.png`});
  await card.locator(".catalog-unit-info").click();
  await expect(card).toHaveAttribute("aria-selected","true");
  await card.locator(".catalog-unit-portrait").click();
  await expect(page.locator("#warehouseDialog")).toBeVisible();
  expect(errors).toEqual([]);
});
