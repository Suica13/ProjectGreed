const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
async function openCampaign(page, width) {
  await page.setViewportSize({width,height:900});
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(()=>{const factory=createRoomEngine;createRoomEngine=options=>(window.testEngine=factory(options));});
  await page.locator("#openSkirmish").click();await page.locator("#offlineRoomMode").selectOption("campaign");
  await page.locator("#createOfflineRoom").click();await page.locator("#startRoomGame").click();
  await page.locator(".campaign-setup button").last().click();await expect(page.locator("#campaignScreen")).toBeVisible();
  await expect.poll(()=>page.evaluate(()=>Net.awaiting)).toBe(null);
}
for(const width of [1440,390]) test(`compact strategic labels preserve intelligence and avoid SVG rewrites at ${width}px`, async({page})=>{
  await openCampaign(page,width);
  const labels=page.locator(".campaign-region-count");await expect(labels).toHaveCount(43);
  await expect(page.locator('[data-region-label="jaburo"] .campaign-region-name')).toHaveText("贾布罗");
  await expect(page.locator('[data-region-label="jaburo"] .campaign-region-count')).toContainText(/台\(\d+\)\/[\d,]+C/);
  await expect(page.locator('[data-region-label="odessa"] .campaign-region-count')).toContainText("约");
  expect(await labels.first().getAttribute("font-size")).toBe("9");
  const result=await page.evaluate(()=>{
    const svg=document.querySelector(".campaign-map-scroll svg"),observer=new MutationObserver(()=>{});
    observer.observe(svg,{attributes:true,childList:true,subtree:true});
    document.querySelector('[data-region="alaska"]').dispatchEvent(new MouseEvent("click",{bubbles:true}));
    const mutations=observer.takeRecords().length;observer.disconnect();
    return {mutations,reused:svg===document.querySelector(".campaign-map-scroll svg")};
  });
  expect(result.reused).toBe(true);expect(result.mutations).toBeLessThan(100);
  const before=await page.locator('[data-region-label="jaburo"] .campaign-region-count').textContent();
  await page.evaluate(()=>{
    const room=[...testEngine.rooms.values()][0];
    CampaignRules.addUnit({G:Rules,production:PRODUCTION_CATALOG},room.campaign,0,"jaburo","Type61");
    room.campaign.teams[0].intelligence.progress=10;room.revision++;testEngine.broadcast(room);
  });
  await expect(page.locator('[data-region-label="jaburo"] .campaign-region-count')).not.toHaveText(before);
  await expect(page.locator('[data-region-label="odessa"] .campaign-region-count')).toContainText("未知");
  await page.evaluate(()=>{const room=[...testEngine.rooms.values()][0];room.campaign.teams[0].intelligence.progress=75;room.revision++;testEngine.broadcast(room);});
  await expect(page.locator('[data-region-label="odessa"] .campaign-region-count')).not.toContainText(/约|未知/);
  await page.screenshot({path:`tmp/campaign-compact-labels-${width}.png`});
  if(width===1440) {
    await page.evaluate(()=>{
      const room=[...testEngine.rooms.values()][0],s=room.campaign;
      CampaignRules.addUnit({G:Rules,production:PRODUCTION_CATALOG},s,1,"jaburo","MS_06F");
      s.phase="encounters";s.encounters=[{region:"jaburo",turn:0,battleSave:null,roster:{},settled:[]}];
      room.revision++;testEngine.broadcast(room);
    });
    await expect(page.locator(".campaign-encounter-particle")).toHaveCount(16);
    await page.setViewportSize({width:390,height:900});
    await expect(page.locator(".campaign-encounter-particle")).toHaveCount(4);
  }
});

test("mobile map batches wheel input and uses four particles sharing one exact coastline",async({page})=>{
  await openCampaign(page,390);
  const result=await page.evaluate(async()=>{
    const scroll=document.querySelector(".campaign-map-scroll"),svg=scroll.querySelector("svg");
    const before=svg.getBoundingClientRect().width,rect=scroll.getBoundingClientRect();
    const observer=new MutationObserver(()=>{});observer.observe(svg,{attributes:true,attributeFilter:["style"]});
    for(let i=0;i<8;i++) scroll.dispatchEvent(new WheelEvent("wheel",{deltaY:-20,clientX:rect.x+rect.width/2,clientY:rect.y+rect.height/2,cancelable:true}));
    await new Promise(requestAnimationFrame);
    const writes=observer.takeRecords().length;observer.disconnect();
    return {writes,ratio:svg.getBoundingClientRect().width/before};
  });
  expect(result.writes).toBeLessThanOrEqual(2);expect(result.ratio).toBeCloseTo(Math.exp(.24),2);
  const scroll=page.locator(".campaign-map-scroll"),bounds=await scroll.boundingBox();
  const beforePan=await scroll.evaluate(el=>el.scrollLeft);
  const cdp=await page.context().newCDPSession(page);
  await cdp.send("Emulation.setTouchEmulationEnabled",{enabled:true});
  const startX=bounds.x+bounds.width*.7,y=bounds.y+bounds.height*.45;
  await cdp.send("Input.dispatchTouchEvent",{type:"touchStart",touchPoints:[{x:startX,y}]});
  for(let i=1;i<=6;i++) await cdp.send("Input.dispatchTouchEvent",{type:"touchMove",touchPoints:[{x:startX-i*20,y}]});
  await cdp.send("Input.dispatchTouchEvent",{type:"touchEnd",touchPoints:[]});
  await expect.poll(()=>scroll.evaluate(el=>el.scrollLeft)).toBeGreaterThan(beforePan);
  expect(await scroll.locator("svg").evaluate(svg=>svg.animationsPaused())).toBe(false);
  await page.evaluate(()=>{
    const room=[...testEngine.rooms.values()][0],s=room.campaign;
    const enemy=CampaignRules.addUnit({G:Rules,production:PRODUCTION_CATALOG},s,1,"jaburo","MS_06F");enemy.entryFrom="andes";
    s.phase="encounters";s.encounters=[{region:"jaburo",turn:0,battleSave:null,roster:{},settled:[]}];room.revision++;testEngine.broadcast(room);
  });
  await expect(page.locator("#campaignEncounterDialog")).toBeVisible();
  await expect(page.locator(".campaign-encounter-particle")).toHaveCount(4);
  expect(await page.locator(".campaign-encounter-particle animateMotion").evaluateAll(nodes=>nodes.every(node=>{
    const path=document.querySelector(node.querySelector("mpath").getAttribute("href"));
    return !node.hasAttribute("path")&&path?.getAttribute("d")===document.querySelector('[data-region="jaburo"] .campaign-region-surface').getAttribute("d");
  }))).toBe(true);
});
