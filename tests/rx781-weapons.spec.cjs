const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
test('RX-78-1 saber and javelin are mutually exclusive throughout their attacks',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 const results=await page.evaluate(async()=>{
  await SpriteRenderer.load();const rows=[];
  for(const [id,m] of Object.entries(UnitModels).filter(([,m])=>m.prefabId==='RX_78_1'))
   for(const weaponId of ['EF_BeamSaber_AF_Fast_A','EF_BeamJavelin_BF_B']) {
    const w=m.weapons.find(w=>w.id===weaponId);
    for(const time of [0,.3,.6,1,1.5]) {
     const p=WeaponSequence.pose(w,time);
     const visible=broken=>SpriteRenderer.visibleLayers(id,w.id,true,false,p.clip,p.time,false,broken,true,false,'ground',w.id,p.weaponDisplayIndex)
      .filter(l=>['EF_BeamSaber_AF_Fast','EF_BeamJavelin_BF'].includes(l.name)).map(l=>l.name);
     rows.push({weaponId,visible:visible({}),broken:visible({rightArm:true})});
    }
   }
  return rows;
 });
 for(const r of results){expect(r.visible).toEqual([r.weaponId==='EF_BeamSaber_AF_Fast_A'?'EF_BeamSaber_AF_Fast':'EF_BeamJavelin_BF']);expect(r.broken).toEqual([]);}
});
