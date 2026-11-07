const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');const path=require('node:path');
test('many moving units avoid combat reconstruction and repeat model reads',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 await page.evaluate(async()=>{
 Net.leave();session++;const entry={unitId:'RGM_79',kitId:'machine_gun'};
 game=Rules.create(false,1,[[entry],[entry]],false,{fogMode:'disabled'});
 game.tiles.forEach(row=>row.fill('plain'));const source=game.units[0];
 game.units=Array.from({length:96},(_,i)=>{const group=Math.floor(i/3);return{...structuredClone(source),id:'perf-'+i,
 x:2+(group%8)*2,y:2+Math.floor(group/8)*2,squadId:'perf-squad-'+group,squadSlot:i%3,team:1,ownerSeat:1};});
 game.team=1;game.ai=true;game.deployment=null;phase='idle';selected=null;mode='select';pending=moving=battleView=null;
 await SpriteRenderer.ensureModels([source.model]);setPageView('game');MapCamera.focus(10,6);update();
 });
 const result=await page.evaluate(()=>{
 const original=Rules.modelOf,originalMembers=Rules.squadMembers,originalDraw=SpriteRenderer.draw;
 let calls=0,scans=0,draws=0;SpriteRenderer.draw=(...args)=>{draws++;return originalDraw(...args);};Rules.modelOf=(...args)=>{calls++;return original(...args);};Rules.squadMembers=(...args)=>{scans++;return originalMembers(...args);};
 const samples=[];const base=performance.now();
 const state=JSON.stringify(game.units.map(u=>[u.x,u.y,u.hp,u.en,u.angle,u.squadId]));
 try{
 for(const unit of game.units)PlanningUI.move({unitId:unit.id,from:{x:unit.x,y:unit.y},path:Array.from({length:12},(_,i)=>({x:unit.x+(i%3),y:unit.y})),squadIds:[unit.id]});
 for(let i=0;i<4;i++)drawMap(base+i);
 calls=scans=draws=0;
 for(let i=0;i<24;i++){const start=performance.now();drawMap(base+8+i*8);samples.push(performance.now()-start);}
 const sorted=[...samples].sort((a,b)=>a-b);
 return{count:game.units.length,mean:samples.reduce((a,b)=>a+b,0)/samples.length,p95:sorted[Math.floor(sorted.length*.95)],
 spriteDrawsPerFrame:draws/24,modelReadsPerFrame:calls/24,squadScansPerFrame:scans/24,idleObjectsReused:MapCombat.units()[0]===game.units[0],
 unchanged:state===JSON.stringify(game.units.map(u=>[u.x,u.y,u.hp,u.en,u.angle,u.squadId]))};
 }finally{Rules.modelOf=original;Rules.squadMembers=originalMembers;SpriteRenderer.draw=originalDraw;PlanningUI.reset();game.ai=false;}
 });
 console.log('MOVEMENT_PROFILE',JSON.stringify(result));
 expect(result.unchanged).toBe(true);
 expect(result.idleObjectsReused).toBe(true);
 expect(result.squadScansPerFrame).toBe(0);
 expect(result.modelReadsPerFrame).toBeLessThanOrEqual(result.count*3);
 expect(result.spriteDrawsPerFrame).toBeLessThan(result.count);
});

test('simultaneous movement endings unlock controls once without rebuilding panels', async ({page}) => {
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 const result=await page.evaluate(async()=>{
   Net.leave(); session++;
   const e={unitId:'Type61',kitId:'standard'};
   game=Rules.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
   game.deployment=null; game.ai=false; game.team=0;
   const source=game.units[0];
   game.units=Array.from({length:36},(_,i)=>({...structuredClone(source),id:'end-'+i,
     pendingMove:{seat:0,x:5,y:5},x:2+i%6,y:2+Math.floor(i/6)}));
   phase='idle';mode='move-confirm';selected=game.units[0].id;moving=battleView=null;
   setPageView('game'); PlanningUI.reset(); update();
   const before=JSON.stringify(game.units);
   for(const unit of game.units) PlanningUI.move({unitId:unit.id,from:{x:unit.x,y:unit.y},path:[{x:5,y:5}]});
   BattleHUD.refreshMovement();
   const confirm=byId('hudConfirmMove');
   const disabledBefore=confirm.disabled;
   const originalUpdate=update, originalRefresh=BattleHUD.refreshMovement, originalPanel=renderPanel;
   let updates=0,refreshes=0,panels=0;
   update=()=>{updates++;};renderPanel=()=>{panels++;};
   BattleHUD.refreshMovement=()=>{refreshes++;originalRefresh();};
   try {
     const now=performance.now();
     for(const unit of game.units) PlanningUI.motion(unit,now);
     for(const unit of game.units) PlanningUI.motion(unit,now+100000);
     await new Promise(resolve=>requestAnimationFrame(resolve));
     return {updates,refreshes,panels,disabledBefore,disabledAfter:confirm.disabled,unchanged:before===JSON.stringify(game.units)};
   } finally {update=originalUpdate;renderPanel=originalPanel;BattleHUD.refreshMovement=originalRefresh;PlanningUI.reset();}
 });
 expect(result).toEqual({updates:0,refreshes:1,panels:0,disabledBefore:true,disabledAfter:false,unchanged:true});
});

test('completed move previews can still be cancelled and confirmed through the HUD', async ({page}) => {
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{
    Net.leave();session++;
    const e={unitId:'Type61',kitId:'standard'};
    game=Rules.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
    game.tiles.forEach(row=>row.fill('plain'));
    game.deployment=null;game.ai=false;game.team=0;
    Object.assign(game.units[0],{x:8,y:8});Object.assign(game.units[1],{x:30,y:20});
    selected=game.units[0].id;phase='idle';mode='select';moving=battleView=null;
    setPageView('game');PlanningUI.reset();MapCamera.focus(8,8);update();
  });
  for (const confirm of [false,true]) {
    await page.evaluate(()=>{
      const u=game.units[0],from={x:u.x,y:u.y};
      const path=Rules.previewMove(game,u,9,8,Rules.ownerOf(u),true);
      PlanningUI.move({unitId:u.id,from,path});mode='move-confirm';update();
    });
    await expect(page.locator('#hudConfirmMove')).toBeEnabled();
    await page.locator(confirm?'#hudConfirmMove':'#hudCancelAction').click();
    await expect(page.locator('#hudConfirmMove')).toBeHidden();
    expect(await page.evaluate(()=>game.units[0].x)).toBe(confirm?9:8);
    expect(await page.evaluate(()=>game.units[0].pendingMove||null)).toBe(null);
  }
});
