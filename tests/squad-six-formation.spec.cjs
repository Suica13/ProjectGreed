const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('two-row squad controls and portrait swaps at '+width+'px',async({page})=>{
 await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await expect(page.locator('#openSkirmish')).toBeEnabled();
 if(await page.locator('#profileOnboardingConfirm').isVisible()){
  await page.locator('#profileCompanyName').fill('六机编组测试');
  await page.locator('#profileOnboardingConfirm').click();
 }
 await page.evaluate(async()=>{
   Net.leave();session++;
   const e={unitId:'Type61',kitId:'standard'};game=Rules.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
   const source=game.units[0],enemy=game.units[1];
   const members=Array.from({length:6},(_,i)=>({...structuredClone(source),id:'ui-'+i,x:5,y:5,squadId:'six',squadSlot:i}));
   Object.assign(enemy,{x:5,y:8});game.units=[...members,enemy];game.tiles.forEach(row=>row.fill('plain'));game.deployment=null;
   phase='idle';pending=moving=battleView=null;selected=members[0].id;mode='select';squadSingleMove=false;
   await SpriteRenderer.ensureModels(game.units.map(u=>u.model));setPageView('game');update();
 });
 const strip=page.locator('.battle-squad-strip');await expect(strip).toBeVisible();
 await expect(strip.locator('[data-squad-member]')).toHaveCount(6);
 await expect(page.locator('#squadArrange')).toHaveCount(0);
 await expect(strip.locator('.squad-row-label')).toHaveCount(6);
 await expect(strip.locator('[data-row=front]')).toHaveCount(3);
 await expect(strip.locator('[data-row=rear]')).toHaveCount(3);
 const all=await page.locator('#squadSelectAll').boundingBox(),portraits=await strip.locator('.squad-portraits').boundingBox();
 expect(all.x+all.width).toBeLessThanOrEqual(portraits.x);
 await strip.locator('[data-squad-member="ui-4"]').click();
 expect(await page.evaluate(()=>({id:selected,single:squadSingleMove}))).toEqual({id:'ui-4',single:true});
 await page.locator('#squadSelectAll').click();expect(await page.evaluate(()=>squadSingleMove)).toBe(false);
 expect(await strip.locator(':scope > button').count()).toBe(0);
 await expect(strip).toContainText('6/6 · 6/12');
 await strip.locator('[data-squad-member="ui-4"]').click();
 await page.locator('#squadSwap').click();await expect(page.locator('#squadSwap')).toHaveAttribute('aria-pressed','true');
 await strip.locator('[data-squad-member="ui-1"]').click();
 expect(await page.evaluate(()=>[getUnit('ui-4').squadSlot,getUnit('ui-1').squadSlot,getUnit('ui-4').acted,getUnit('ui-4').moved])).toEqual([1,4,false,false]);
 await expect(strip.locator('[data-squad-member="ui-4"]')).toHaveAttribute('data-row','front');
 await expect(strip.locator('[data-squad-member="ui-1"]')).toHaveAttribute('data-row','rear');
 const fronts=await strip.locator('[data-row=front]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));
 const rears=await strip.locator('[data-row=rear]').evaluateAll(nodes=>nodes.map(n=>n.getBoundingClientRect().y));
 expect(new Set(fronts).size).toBe(1);expect(new Set(rears).size).toBe(1);expect(rears[0]).toBeGreaterThan(fronts[0]);
 const cells=await strip.locator('[data-squad-member]').evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height};}));
 const allBox=await page.locator('#squadSelectAll').boundingBox(),fightBox=await page.locator('#squadCombatMode').boundingBox(),swapBox=await page.locator('#squadSwap').boundingBox();
 for(const button of [allBox,fightBox,swapBox]){expect(button.width).toBeCloseTo(cells[0].width,2);expect(button.height).toBeCloseTo(cells[0].height,2);}
 expect(fightBox.x).toBeCloseTo(allBox.x,2);expect(allBox.y).toBeCloseTo(fronts[0],2);expect(fightBox.y).toBeCloseTo(rears[0],2);
 expect(swapBox.y).toBeCloseTo(fronts[0],2);expect(swapBox.x).toBeGreaterThan(Math.max(...cells.filter(cell=>cell.y===fronts[0]).map(cell=>cell.x+cell.width)));
 const mode=page.locator('#squadCombatMode');await expect(mode).toHaveText('格斗战');await mode.click();await expect(mode).toHaveText('射击战');await mode.click();await expect(mode).toHaveText('突击');await mode.click();await expect(mode).toHaveText('格斗战');
 await page.locator('#squadSwap').click();await page.locator('#squadSwap').click();
 await expect(page.locator('#squadSwap')).toHaveAttribute('aria-pressed','false');
 const box=await strip.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);
 const mapBox=await page.locator('#mapWrap').boundingBox(),terrain=await page.locator('#hudTerrainInfo').boundingBox(),phaseBox=await page.locator('.phase-row').boundingBox();
 expect(box.x-mapBox.x).toBeCloseTo(8,0);expect(mapBox.y+mapBox.height-box.y-box.height).toBeCloseTo(8,0);
 expect(terrain.y).toBeGreaterThanOrEqual(phaseBox.y+phaseBox.height);expect(terrain.y-phaseBox.y-phaseBox.height).toBeLessThan(20);
 const camera=await page.evaluate(()=>{MapCamera.setZoom(1e6);MapCamera.focus(5,5,{preserveZoom:true});const b=byId('map').getBoundingClientRect();return {tile:mapGeo.tile,target:Math.max(b.width/4,b.height/2)};});
 expect(camera.tile).toBeCloseTo(camera.target,1);
 await page.screenshot({path:`tmp/verification/screenshots/two-row-swap-${width}.png`,fullPage:true});
 await page.evaluate(()=>{const allies=game.units.filter(u=>u.team===0);game.units=game.units.filter(u=>u.team!==0).concat(allies.slice(0,2));selected=allies[0].id;mode='select';update();});
 await expect(strip.locator('[data-squad-member]')).toHaveCount(2);await expect(strip.locator('[data-squad-empty]')).toHaveCount(4);
 const empties=await strip.locator('[data-squad-empty]').all();for(const empty of empties){await expect(empty).toBeDisabled();await expect(empty.locator('img')).toHaveCount(1);}
 await page.screenshot({path:`tmp/verification/screenshots/squad-empty-slots-${width}.png`,fullPage:true});
 expect(errors).toEqual([]);
});
