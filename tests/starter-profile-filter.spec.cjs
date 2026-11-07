const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
for (const width of [1280, 390]) test(`licensed picker filters and COST order at ${width}px`, async ({page}) => {
 await page.setViewportSize({width,height:900});
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 await page.waitForFunction(()=>assetsReady);
 const initial=await page.evaluate(()=>({money:Economy.snapshot().money,supplies:Economy.snapshot().supplies,units:Economy.starterFormation().length}));
 expect(initial).toEqual({money:10000,supplies:20000,units:18});
 await page.evaluate(()=>localStorage.setItem(Economy.key,JSON.stringify({schemaVersion:3,money:1234,supplies:5678,licenses:{},inventory:{RGM_79:2},kits:{RGM_79__beam_spray:2}})));
 await page.reload();await page.waitForFunction(()=>assetsReady);
 await page.locator("#shellHangar").click();
 await page.locator("#openFormationPicker").click();
 await expect(page.locator("#formationStock option")).toHaveCount(3);
 await page.locator("#formationStock").selectOption("owned");
 const cards=page.locator("#formationCatalog .catalog-unit");
 expect(await cards.evaluateAll(nodes=>nodes.map(n=>n.dataset.unitId))).toEqual(["RGM_79"]);
 await page.locator("#formationStock").selectOption("licensed");
 const rows=await cards.evaluateAll(nodes=>nodes.map(n=>{
  const p=Rules.catalog.prefabs.find(p=>p.id===n.dataset.unitId);
  return {id:p.id,licensed:Economy.hasLicense(p.id),cost:Math.min(...p.weaponKits.map(k=>p.stats.cost+k.cost))};
 }));
 expect(rows.length).toBeGreaterThan(10);expect(rows.every(r=>r.licensed)).toBe(true);
 expect(rows.some(r=>r.id==="RGM_79")).toBe(false);
 expect(rows.map(r=>r.cost)).toEqual(rows.map(r=>r.cost).sort((a,b)=>a-b));
 const boxes=await cards.evaluateAll(nodes=>nodes.slice(0,6).map(n=>{const b=n.getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left};}));
 for(let i=1;i<boxes.length;i++) if(boxes[i].left===boxes[i-1].left) expect(boxes[i].top).toBeGreaterThanOrEqual(boxes[i-1].bottom-1);
 expect(await page.evaluate(()=>({money:Economy.snapshot().money,supplies:Economy.snapshot().supplies,stock:Economy.quantity("Type61")}))).toEqual({money:1234,supplies:5678,stock:0});
});
