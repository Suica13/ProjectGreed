const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
async function open(page){
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
}
for(const height of [844,667])test('portrait unit information clears the squad dock at 390x'+height,async({page})=>{
 await page.setViewportSize({width:390,height});await open(page);
 await page.evaluate(async()=>{
   Net.leave();session++;I18n.setLanguage('zh');
   const e={unitId:'RGM_79',kitId:'machine_gun'};game=Rules.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
   const [a,b]=game.units;game.units=Array.from({length:3},(_,i)=>({...structuredClone(a),id:'s-'+i,squadId:'s',squadSlot:i,x:5,y:5})).concat(b);
   game.deployment=null;phase='idle';pending=moving=battleView=null;selected='s-0';mode='select';squadSingleMove=false;
   await SpriteRenderer.ensureModels([a.model]);setPageView('game');update();
 });
 await page.locator('[data-unit-command="info"]').click();
 const info=page.locator('#hudUnitPanel'),strip=page.locator('.battle-squad-strip');await expect(info).toBeVisible();
 await expect.poll(async()=>{
   const panel=await info.boundingBox(),dock=await strip.boundingBox();return panel.y+panel.height<=dock.y;
 }).toBe(true);
 expect(await info.evaluate(el=>Number(getComputedStyle(el).zIndex))).toBeGreaterThan(await strip.evaluate(el=>Number(getComputedStyle(el).zIndex)));
 expect(await info.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.bottom-12));})).toBe(true);
});

test('large armies draw each visible hull and health bar once and use bounded layout reads, including offscreen combat actors',async({page})=>{
 await open(page);
 const result=await page.evaluate(async()=>{
   Net.leave();session++;
   const e={unitId:'RGM_79',kitId:'machine_gun'};game=Rules.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
   const a=game.units[0];game.units=Array.from({length:240},(_,i)=>({...structuredClone(a),id:'many-'+i,x:2+i%20,y:2+Math.floor(i/20),acted:false}));
   game.tiles.forEach(r=>r.fill('plain'));game.deployment=null;game.winner=null;
   phase='idle';pending=moving=battleView=null;selected=null;mode='select';
   await SpriteRenderer.ensureModels([a.model]);setPageView('game');MapCamera.fit();MapCamera.setZoom(MapCamera.zoom*1.01);update();
   const canvas=byId('map'),ctx=canvas.getContext('2d'),draw=SpriteRenderer.draw,rect=canvas.getBoundingClientRect.bind(canvas),fill=ctx.fillRect.bind(ctx);
   let draws=0,reads=0,bars=0;const stamps=new Set();
   SpriteRenderer.draw=(...args)=>{draws++;stamps.add([args[1],args[2],args[3]].join(':'));return draw(...args);};
   canvas.getBoundingClientRect=()=>{reads++;return rect();};
   ctx.fillRect=(...args)=>{if(ctx.fillStyle==='#83d6ee')bars++;return fill(...args);};
   const samples=[];let visible;
   try {
     for(let i=0;i<16;i++){
       draws=reads=bars=0;stamps.clear();const start=performance.now();drawMap(1000+i*16);samples.push(performance.now()-start);
     }
     visible={draws,reads,bars,unique:stamps.size};
     const units=MapCombat.units;MapCombat.units=()=>game.units.map(u=>({...u,mapPose:{x:1e7,y:1e7,angle:0,clip:null,time:0}}));
     try{draws=bars=0;drawMap(2000);return{...visible,medianMs:samples.sort((a,b)=>a-b)[8],offscreenDraws:draws,offscreenBars:bars};}
     finally{MapCombat.units=units;}
   } finally {SpriteRenderer.draw=draw;canvas.getBoundingClientRect=rect;ctx.fillRect=fill;}
 });
 console.log('ARMY_RENDER_PROFILE '+JSON.stringify(result));
 expect(result.draws).toBeGreaterThan(100);expect(result.draws).toBe(result.unique);expect(result.bars).toBe(result.draws);
 expect(result.reads).toBeLessThanOrEqual(4);expect(result.offscreenDraws).toBe(0);expect(result.offscreenBars).toBe(0);
});

test('evasion faces its incoming attacker and settles facing the unit’s own locked target, with matching weapon aim',async({page})=>{
 await open(page);
 const result=await page.evaluate(async()=>{
   Net.leave();session++;
   const e={unitId:'RGM_79',kitId:'machine_gun'};game=Rules.create(false,1,[[e,e],[e]],false,{fogMode:'disabled',costLimit:99999,unitCostLimit:99999});
   game.tiles.forEach(r=>r.fill('plain'));game.deployment=null;game.winner=null;
   const [defender,decoy,enemy]=game.units;Object.assign(defender,{x:10,y:10,angle:180,aimAngle:180,hp:1e6,en:1e6,shield:0});
   Object.assign(decoy,{x:10,y:8,team:1,hp:1e6,shield:0});Object.assign(enemy,{x:12,y:10,hp:1e6,en:1e6,shield:0});
   const battles=[];
   for(const [from,to,start] of [[defender,decoy,0],[enemy,defender,8]]){
     game.team=from.team;
     const actors=structuredClone([from,to]),w=Rules.modelOf(from).weapons.find(w=>w.type!=='melee'&&w.slot!=='skill');
     const event=Rules.fight(game,from,to,{...w,hit:0},'evade')[0];
     battles.push({id:'dodge-'+start,a:from.id,b:to.id,actors,events:[event],before:Object.fromEntries(actors.map(u=>[u.id,u.hp])),crossfire:true,timelineStart:start});
   }
   await SpriteRenderer.ensureModels(game.units.map(u=>u.model));MapCombat.reset();MapCombat.seed(battles);
   battleView={networkId:'evade-facing',battles,actors:battles.flatMap(b=>b.actors),events:battles.flatMap(b=>b.events)};
   phase='battle';pending=moving=null;setPageView('game');MapCombat.begin(battleView,()=>0);
   const finish=CombatPlayback.finish;CombatPlayback.finish=()=>{};let active=0,maxActiveError=0,settled=null;
   const error=(a,b)=>Math.abs(((a-b+540)%360)-180);let now=performance.now();
   try {
     for(let i=0;i<1600;i++){
       MapCombat.update(now+=10);const units=MapCombat.units(),u=units.find(u=>u.id===defender.id),pose=u.mapPose;
       if(pose?.dodge?.active&&!pose.firing){
         const foe=units.find(u=>u.id===enemy.id),point=foe.mapPose||{x:(foe.x+.5)*Rules.mapCellPixels,y:(foe.y+.5)*Rules.mapCellPixels};
         const angle=Math.atan2(point.x-pose.x,-(point.y-pose.y))*180/Math.PI;
         active++;maxActiveError=Math.max(maxActiveError,error(pose.angle,angle),error(pose.aimAngle,angle));
       }
       if(battleView.completed){settled={angle:pose.angle,aim:pose.aimAngle};break;}
     }
     return{active,maxActiveError,settled};
   } finally {CombatPlayback.finish=finish;MapCombat.reset();battleView=null;}
 });
 expect(result.active).toBeGreaterThan(0);expect(result.maxActiveError).toBeLessThan(.01);
 expect(Math.abs(result.settled.angle)).toBeLessThan(.01);expect(Math.abs(result.settled.aim)).toBeLessThan(.01);
});
