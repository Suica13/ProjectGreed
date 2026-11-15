const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test('ship barrage preloads native bullets, skips destroyed guns and captures hits once',async({page})=>{
  const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  const result=await page.evaluate(async()=>{
    const model=Object.values(ART.models).find(m=>m.prefabId==='SalamisClass');
    const skill=model.skills.find(s=>s.id==='ShipAntiAirVolley');
    const unit={id:'aa',model:Object.keys(ART.models).find(id=>ART.models[id]===model)};
    const keys=SpriteRenderer.battleKeys({game:{units:[unit]}});
    await SpriteRenderer.ensureAssets(keys);
    const canvas=document.createElement('canvas');canvas.width=canvas.height=600;
    const ctx=canvas.getContext('2d'),draw=ctx.drawImage.bind(ctx);
    let bullets=0,captures=0,done=0;
    ctx.drawImage=(...args)=>{bullets++;draw(...args);};
    const capture=MapEffects.capture;
    MapEffects.capture=()=>captures++;
    try{
      IrradiationFX.reset();
      IrradiationFX.start({...skill,id:'aa-test',unitId:unit.id,model:unit.model,
        from:{x:5,y:5},to:{x:5,y:4},radialRange:2,
        moduleHp:{[skill.barrageModules[0]]:0}},()=>done++);
      IrradiationFX.draw(ctx,0,(x,y)=>({x:x*30,y:y*30}),30);
      IrradiationFX.draw(ctx,1000,(x,y)=>({x:x*30,y:y*30}),30);
      return {bullets,captures,expected:(skill.muzzle.mounts.length-1)*6,
        loaded:skill.barrageProjectiles.every(p=>keys.includes(p.asset)),active:IrradiationFX.active};
    }finally{MapEffects.capture=capture;IrradiationFX.reset();}
  });
  expect(result.loaded).toBeTruthy();
  expect(result.bullets).toBe(result.expected);
  expect(result.captures).toBe(1);
  expect(result.active).toBeFalsy();
  expect(errors).toEqual([]);
});
