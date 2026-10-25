const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");
test("MS-10 missile equipment is static except during its missile attack",async({page})=>{
 await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
 const result=await page.evaluate(async()=>{
  await SpriteRenderer.load();
  const id="MS_10__kit_2",layer=SpriteRenderer.models[id].decals.find(l=>l.name==="ZN_MS_10_MS_MS");
  const image=SpriteRenderer.images[layer.asset];
  const canvas=document.createElement("canvas"),ctx=canvas.getContext("2d"),original=ctx.drawImage.bind(ctx);
  const frames=[];ctx.drawImage=(img,...args)=>{if(img===image)frames.push(args[0]/args[2]);original(img,...args);};
  function draw(time,attacking,weapon,broken={}){
   const before=frames.length;
   SpriteRenderer.draw(ctx,id,100,100,1,0,null,time,"ZN_MS_10_MS_MS",false,true,false,broken,0,attacking,false,"ground",weapon,0);
   return frames.slice(before);
  }
  return {idle:[0,.1,.3,1,20].map(t=>draw(t,false,null)),
   firing:draw(.4,true,"ZN_MS_10_MS_MS"),other:draw(.4,true,"ZN_MS_09_ChestBeam"),
   after:draw(4,false,"ZN_MS_10_MS_MS"),broken:draw(.4,true,"ZN_MS_10_MS_MS",{rightArm:true})};
 });
 expect(result.idle).toEqual([[1],[1],[1],[1],[1]]);
 expect(result.firing).toEqual([0]);expect(result.other).toEqual([1]);
 expect(result.after).toEqual([1]);expect(result.broken).toEqual([]);
});

