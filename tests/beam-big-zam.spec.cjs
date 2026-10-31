const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const id of ['MA_08','MA_08_DZL'])test(id+' native muzzle assets, directional weapon UI and rotation confirmation',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 const result=await page.evaluate(async id=>{
  const model=id+'__standard',m=UnitModels[model],w=m.weapons.find(w=>w.id==='ZN_MA_08_AA_BeamCannon');
  const a={id:'a',model,x:10,y:10,hp:m.hp,en:m.en,angle:0,team:0,shield:0,actionPoints:5};
  await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({units:[a]}));
  const muzzles=w.attack.strikes.map(s=>{
   const pose=WeaponSequence.pose(w,s.at);
   return SpriteRenderer.muzzle(model,w,{x:300,y:300,angle:0,scale:1},pose.clip,pose.time,s.shotIndex);
  });
  const c=Rules.center(a),targets=[{x:c.x,y:c.y-4},{x:c.x+4,y:c.y},{x:c.x,y:c.y+4}].map(p=>({...p,id:'b',model:'Type61__standard',hp:1000000,shield:0,en:500,team:1,angle:0}));
  const counts=targets.map(target=>{
   const summary=WeaponInfo.summary(w,{unit:a,target});
   return {count:summary.querySelector('.weapon-hit-count')?.textContent,total:summary.querySelector('.weapon-total-damage').textContent};
  });
  game={units:[a,targets[0]],tiles:Array.from({length:30},()=>Array(30).fill('plain')),round:1,team:0,winner:null,fogMode:'disabled',seed:1,environment:'ground'};
  const canRotate=Rules.canRotate(game,a,1);
  Rules.previewRotate(game,a,1,0);const pending=!!a.pendingMove&&a.angle===0;
  Rules.cancelMove(game,a);const canceled=a.angle===0&&!a.pendingMove;
  Rules.previewRotate(game,a,1,0);Rules.confirmMove(game,a);
  return {muzzles,counts,canRotate,pending,canceled,heading:a.angle,large:Rules.unitSize(m)};
 },id);
 expect(new Set(result.muzzles.map(p=>p.x.toFixed(3)+','+p.y.toFixed(3))).size).toBe(14);
 expect(result.counts.map(s=>s.count)).toEqual(['2','1','2']);
 expect(result.counts.map(s=>s.total.replace(/,/g,''))).toEqual(['5000','2500','5000']);
 expect(result).toMatchObject({canRotate:true,pending:true,canceled:true,heading:90,large:'large'});
 expect(errors).toEqual([]);
});
