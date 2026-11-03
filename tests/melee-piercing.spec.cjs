const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');

test('map melee renders native B then F with their own slash effects',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 const result=await page.evaluate(async()=>{
  Net.leave();session++;
  const entry={unitId:'RGM_79L',kitId:'machine_gun'};
  game=Rules.create(false,1,[[entry],[entry]],false,{fogMode:'disabled'});
  game.tiles.forEach(r=>r.fill('plain'));game.deployment=null;
  game.units.forEach((u,i)=>Object.assign(u,{x:5+i,y:5,hp:1000000,en:10000,shield:0}));
  await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({units:game.units}));
  phase='idle';moving=pending=battleView=null;setPageView('game');update();
  const [a,b]=game.units,w=Rules.modelOf(a).weapons.find(w=>w.id==='EF_BeamSaber_BF');
  const event={from:a.id,to:b.id,weapon:w.id,hit:true,damage:0,before:b.hp,after:b.hp,
    strikes:w.attack.strikes.map(s=>({...s,executed:true,hit:true,damage:0,shieldDamage:0}))};
  const battle={a:a.id,b:b.id,actors:structuredClone([a,b]),before:{[a.id]:a.hp,[b.id]:b.hp},events:[event]};
  MapCombat.reset();MapCombat.seed([battle]);battleView={battles:[battle],index:0,completed:false};phase='battle';MapCombat.begin(battleView,()=>0);
  const clips=new Set(),effects=new Set(),draw=SpriteEffects.draw;
  SpriteEffects.draw=function(ctx,id,x,y,scale,age,...args){
   if(age>=0)for(const name of Array.isArray(id)?id:[id])effects.add(name);
   return draw.call(this,ctx,id,x,y,scale,age,...args);
  };
  try{
   const zero=performance.now(),rate=MovementTiming.combatRate(false,false);
   MapCombat.update(zero);
   const ctx=document.createElement('canvas').getContext('2d');
   for(let t=0;t<4;t+=.025){
    MapCombat.update(zero+t*1000/rate);
    clips.add(MapCombat.units().find(u=>u.id===a.id)?.mapPose?.clip);
    MapCombat.draw(ctx,{ox:0,oy:0,tile:Rules.mapCellPixels});
   }
  }finally{SpriteEffects.draw=draw;}
  return {clips:[...clips],effects:[...effects]};
 });
 expect(result.clips).toContain('Common_Melee_B');expect(result.clips).toContain('Common_Melee_F');
 expect(result.effects).toContain('Cqb_Fire_2_Pink_R');expect(result.effects).toContain('Cqb_Fire_1_Pink_L');
});
