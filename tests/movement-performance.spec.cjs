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
