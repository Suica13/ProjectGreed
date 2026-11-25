const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test(`floating ship rotation controls freely set final heading at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await expect(page.locator('#openSkirmish')).toBeEnabled();
 if(await page.locator('#profileOnboardingConfirm').isVisible()){
  await page.locator('#profileCompanyName').fill('旋转测试');await page.locator('#profileOnboardingConfirm').click();
 }
 await page.evaluate(async()=>{
  Net.leave();session++;
  game=Rules.create(false,1,[[{unitId:'SalamisClass',kitId:'standard'}],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{mapId:'asteroid_crossing_1v1',costLimit:99999,fogMode:'disabled'});
  game.tiles.forEach(row=>row.fill('plain'));game.deployment=null;
  Object.assign(game.units[0],{x:10,y:10,angle:0});Object.assign(game.units[1],{x:25,y:25});
  phase='idle';pending=moving=battleView=null;selected=game.units[0].id;mode='select';
  await SpriteRenderer.ensureModels(game.units.map(u=>u.model));setPageView('game');update();MapCamera.focus(2,2);
 });
 const command=page.locator('#hudUnitCommands [data-ship-turn]');await expect(command).toHaveCount(1);await expect(command).toHaveText('旋转');await command.click();
 const dialog=page.locator('#shipRotationDialog'),angle=page.locator('#shipRotationAngle');await expect(dialog).toBeVisible();await expect(dialog).toContainText('旋转后无法移动');
 await expect(page.locator('dialog[open]')).toHaveCount(0);expect(await dialog.evaluate(node=>node.tagName)).toBe('SECTION');
 const focused=await page.evaluate(()=>{const p=mapPosition(game.units[0].x,game.units[0].y),box=byId('map').getBoundingClientRect();return {x:p.x,y:p.y,width:box.width,height:box.height};});
 expect(focused.x).toBeCloseTo(focused.width/2,0);expect(focused.y).toBeCloseTo(focused.height/2,0);
 await angle.fill('137');await angle.dispatchEvent('input');await expect(dialog.locator('output')).toHaveText('137°');
 expect(await page.evaluate(()=>BattleHUD.rotationAngle(game.units[0].id))).toBe(137);
 const first=await dialog.locator('[data-arc-group]').first().getAttribute('data-arc-group');
 const expected=await page.evaluate(id=>{const m=Rules.modelOf(game.units[0]),w=m.weapons.find(w=>w.id===id);return [...new Set(w.attack.strikes.map(s=>s.moduleId).filter(Boolean))].map(id=>{const m=Rules.modelOf(game.units[0]).modules.find(m=>m.id===id);return {id,heading:String(((137+m.idleDir)%360+360)%360),arc:String(m.arc)};});},first);
 for(const module of expected){const row=dialog.locator(`[data-arc-module="${module.id}"]`);await expect(row).toHaveAttribute('data-arc-heading',module.heading);await expect(row).toHaveAttribute('data-arc-half-angle',module.arc);}
 const groupCount=await dialog.locator('[data-arc-group]').count();expect(groupCount).toBeGreaterThan(1);
 await dialog.locator('[data-arc-group]').last().click();await expect(dialog.locator('[data-arc-group]').last()).toHaveAttribute('aria-pressed','true');
 expect(await page.evaluate(()=>[game.units[0].angle,!!game.units[0].pendingMove,!!game.units[0].rotated,game.units[0].moved])).toEqual([0,false,false,false]);
 const bounds=await dialog.boundingBox();expect(bounds.x).toBeGreaterThanOrEqual(0);expect(bounds.x+bounds.width).toBeLessThanOrEqual(width);
 const footer=await dialog.getByRole('button',{name:'确定旋转',exact:true}).boundingBox();expect(footer.y+footer.height).toBeLessThanOrEqual(bounds.y+bounds.height);expect(footer.y).toBeGreaterThanOrEqual(bounds.y);
 await page.screenshot({path:`tmp/verification/screenshots/ship-rotation-preview-${width}.png`,fullPage:true});
 await dialog.getByRole('button',{name:'取消',exact:true}).click();expect(await page.evaluate(()=>[game.units[0].angle,!!game.units[0].pendingMove])).toEqual([0,false]);
 const heading=await page.evaluate(()=>{
  const ship=game.units[0];ship.angle=90;Rules.previewMove(game,ship,ship.x,ship.y-1);const preview=ship.pendingMove.angle;Rules.cancelMove(game,ship);
  const angles=[],original=SpriteRenderer.draw,now=performance.now();
  moving={id:ship.id,path:[{x:ship.x,y:ship.y-1}],from:{x:ship.x,y:ship.y},start:now-50,step:200};
  SpriteRenderer.draw=function(...args){if(args[1]===ship.model)angles.push(args[5]);return original.apply(this,args);};
  try{drawMap(now);}finally{SpriteRenderer.draw=original;moving=null;}
  return {preview,angles,original:ship.angle};
 });
 expect(heading.preview).toBe(0);expect(heading.original).toBe(90);expect(heading.angles.length).toBeGreaterThan(0);expect(heading.angles.every(angle=>angle===0)).toBe(true);
 // A moved ship can still make its final heading correction.
 await page.evaluate(()=>{const ship=game.units[0],point=[...Rules.reachable(game,ship).values()].find(p=>p.path.length===1);Rules.move(game,ship,point.x,point.y);mode='select';update();});
 await expect(command).toBeEnabled();await command.click();await angle.fill('137');await angle.dispatchEvent('input');
 await dialog.getByRole('button',{name:'确定旋转',exact:true}).click();await expect(dialog).not.toBeVisible();
 expect(await page.evaluate(()=>[game.units[0].angle,!!game.units[0].pendingMove,game.units[0].rotated,game.units[0].moved])).toEqual([137,false,true,true]);
 await expect(command).toBeDisabled();await expect(page.locator('#hudUnitCommands [data-unit-command="move"]')).toBeDisabled();
 await page.evaluate(()=>{
  const ship=game.units[0];ship.acted=false;ship.moved=false;delete ship.rotated;game.deployment=[false,false];
  game.spawns=Rules.getMap(game.mapId).spawns;
  game.deploymentAreas=Rules.getMap(game.mapId).spawns.map(()=>({x:0,y:0,width:Rules.mapWidth(game),height:Rules.mapHeight(game)}));
  phase='deployment';mode='select';update();
 });
 await expect(page.locator('#deploymentTurnLeft,#deploymentTurnRight')).toHaveCount(0);
 const deploy=page.locator('#deploymentRotate');await expect(deploy).toBeVisible();await expect(deploy).toHaveText('旋转');await deploy.click();
 await expect(dialog).toContainText('部署旋转不消耗首回合移动机会');await angle.fill('23');await angle.dispatchEvent('input');
 await page.screenshot({path:`tmp/verification/screenshots/ship-deployment-arcs-${width}.png`,fullPage:true});
 await dialog.getByRole('button',{name:'确定旋转',exact:true}).click();
 expect(await page.evaluate(()=>[game.units[0].angle,!!game.units[0].rotated,game.units[0].moved])).toEqual([23,false,false]);await expect(deploy).toBeEnabled();
 await deploy.click();await dialog.getByRole('button',{name:'取消',exact:true}).click();
 expect(errors).toEqual([]);
});
