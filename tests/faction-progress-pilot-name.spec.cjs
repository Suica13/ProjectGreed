const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path"),P=require("../shared/pilots.js");
const url=pathToFileURL(path.resolve("public/client.html")).href;
test("menu technology progress follows faction and PMC combines both",async({page})=>{
 await page.goto(url);await page.waitForFunction(()=>assetsReady);
 for(const faction of ["EFSF","ZEON","PMC","EFSF"]){
  await page.locator("#menuFactionSelect").selectOption(faction);
  const values=await page.evaluate(faction=>{
   const factions=faction==="PMC"?["EFSF","ZEON"]:[faction],bar=byId("menuTechProgressBar");
   return {current:Number(bar.getAttribute("aria-valuenow")),total:Number(bar.getAttribute("aria-valuemax")),expectedCurrent:factions.reduce((sum,f)=>sum+Development.unlockedTech(f).length,0),expectedTotal:factions.reduce((sum,f)=>sum+Development.nodes(f).length,0)};
  },faction);
  expect(values.current).toBe(values.expectedCurrent);expect(values.total).toBe(values.expectedTotal);
 }
});
for(const width of [1280,390])test(`pilot names scroll without resizing action buttons at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});
 const pilots=[P.createCustom("custom-marquee-long","超长驾驶员名字用于验证自动滚动不会改变按钮宽度",null,"EFSF"),P.createCustom("custom-marquee-short","A",null,"EFSF")];
 await page.addInitScript(pilots=>{
  localStorage.setItem("projectgreed.combatFaction","EFSF");
  localStorage.setItem("projectgreed.custom-pilots.v3.shared",JSON.stringify({pilots,awards:[]}));
  localStorage.setItem("slg-formations-v1.EFSF",JSON.stringify({version:3,squads:[{name:"Marquee",units:pilots.map(customPilot=>({unitId:"Type61",kitId:"standard",customPilot}))}]}));
 },pilots);
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.goto(url);await page.waitForFunction(()=>assetsReady);await page.evaluate(()=>I18n.setLanguage("zh"));await page.locator("#openFormation").click();
 const result=await page.evaluate(()=>{
  const rows=[...document.querySelectorAll("#formationList [data-formation-index]")];
  const target=rows.length?rows:[...document.querySelectorAll("[data-formation-index]")];
  const dimensions=target.slice(0,2).map(row=>[...row.querySelectorAll(".formation-row-actions button")].map(button=>button.getBoundingClientRect().width));
  const names=target.slice(0,2).map(row=>{const text=row.querySelector(".pilot-name-scroll"),viewport=row.querySelector(".pilot-name-viewport");const animation=text.getAnimations()[0];animation.pause();animation.currentTime=6000;return {overflow:text.offsetWidth>viewport.clientWidth,transform:getComputedStyle(text).transform};});
  return {dimensions,names,overflow:document.documentElement.scrollWidth>innerWidth};
 });
 expect(result.dimensions[0]).toEqual(result.dimensions[1]);expect(result.names[0].overflow).toBe(true);expect(result.names[0].transform).not.toBe("matrix(1, 0, 0, 1, 0, 0)");expect(result.names[1].overflow).toBe(false);expect(result.overflow).toBe(false);expect(errors).toEqual([]);
});
