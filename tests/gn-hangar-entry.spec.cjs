const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('bundled client can deploy and launch all four CB units directly from a warship',async({page})=>{
 test.setTimeout(90000);
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 const result=await page.evaluate(()=>{
  const G=Rules,ids=['GN_001','GN_002','GN_003','GN_005'];
  const h=G.models.PegasusClass__standard.hangars.find(h=>h.kind!=='sfs');
  const entries=[{unitId:'PegasusClass',kitId:'standard'},...ids.map(unitId=>({unitId,kitId:'default',preload:{carrierIndex:0,hangarId:h.id}}))];
  const plan=G.planFormation(entries,99999,{requiresCarriers:true,fleetLimit:1});
  const g=G.create(false,1,[entries,[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{costLimit:99999,unitCostLimit:99999});
  g.tiles.forEach(row=>row.fill('plain'));g.deployment=null;
  const carrier=g.units.find(u=>G.modelOf(u).prefabId==='PegasusClass');
  Object.assign(carrier,{x:10,y:10});G.hangars.sync(g);
  const launched=ids.map(id=>{
   const u=g.units.find(u=>G.modelOf(u).prefabId===id),direct=u.embarked?.carrierId===carrier.id;
   const target=G.hangars.launchCells(g,u)[0];G.hangars.launch(g,u,target.x,target.y);
   return {id,direct,onMap:G.onMap(u),embarked:!!u.embarked};
  });
  return {disabled:plan.disabled,launched};
 });
 expect(result.disabled).toEqual([]);
 expect(result.launched).toEqual(['GN_001','GN_002','GN_003','GN_005'].map(id=>({id,direct:true,onMap:true,embarked:false})));
});
