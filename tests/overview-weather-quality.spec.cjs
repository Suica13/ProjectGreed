const {test,expect}=require("@playwright/test"),{pathToFileURL}=require("node:url"),path=require("node:path");
const url=pathToFileURL(path.resolve("public/client.html")).href;
test("overview cache preserves large texture detail and reuses it across zoom sizes",async({page})=>{
 await page.goto(url);await page.waitForFunction(()=>assetsReady);
 const result=await page.evaluate(()=>{
  const id="Type61__standard",m=SpriteRenderer.models[id];
  const body=document.createElement("canvas");body.width=body.height=512;const paint=body.getContext("2d");
  for(let y=0;y<512;y+=2)for(let x=0;x<512;x+=2){paint.fillStyle=((x+y)/2)%2?"#fff":"#000";paint.fillRect(x,y,2,2);}
  SpriteRenderer.images["quality-body"]=body;
  m.bones={quality:{x:0,y:0,parent:null,dir:0}};m.animations={Quality:{duration:1,curves:{}}};m.decals=[{name:"body",bone:"quality",asset:"quality-body"}];
  const canvas=document.createElement("canvas");canvas.width=canvas.height=700;const ctx=canvas.getContext("2d");
  const original=ctx.drawImage.bind(ctx),surfaces=[];ctx.drawImage=(source,...args)=>{if(source!==body)surfaces.push(source);original(source,...args);};
  const edges=()=>{const pixels=ctx.getImageData(210,350,280,1).data;let count=0;for(let i=4;i<pixels.length;i+=4)if(Math.abs(pixels[i]-pixels[i-4])>100)count++;return count;};
  const draw=(size,scale=.6)=>{ctx.clearRect(0,0,700,700);SpriteRenderer.beginFrame();SpriteRenderer.draw(ctx,id,350,350,scale,0,"Quality",0,null,true,true,false,{},0,false,false,"space",null,null,false,null,false,false,[],size);return edges();};
  const reference=draw(0),low=draw(128),sharp=draw(2048),surface=surfaces.at(-1);
  for(const scale of [.4,.55,.7,.45])draw(2048,scale);
  return {reference,low,sharp,width:surface.width,reused:surfaces.slice(-4).every(item=>item===surface)};
 });
 expect(result.width).toBeGreaterThan(512);expect(result.width).toBeLessThanOrEqual(2048);
 expect(result.sharp).toBeGreaterThan(result.low*1.5);expect(Math.abs(result.sharp-result.reference)).toBeLessThan(5);expect(result.reused).toBe(true);
});
test("storm and day/night visual comparison",async({page})=>{
 await page.goto(url);await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>{
  const canvas=document.createElement("canvas");canvas.width=1000;canvas.height=700;canvas.id="weather-quality";
  Object.assign(canvas.style,{position:"fixed",inset:0,width:"1000px",height:"700px",zIndex:999999});document.body.append(canvas);
  const ctx=canvas.getContext("2d");
  for(const [i,weather,time] of [[0,"heavy_rain","noon"],[1,"blizzard","noon"],[2,"clear","late_night"],[3,"clear","noon"]]){
   const x=i%2*500,y=Math.floor(i/2)*350;ctx.save();ctx.beginPath();ctx.rect(x,y,500,350);ctx.clip();ctx.translate(x,y);
   ctx.fillStyle="#7b9869";ctx.fillRect(0,0,500,350);
   ctx.fillStyle="#b5ab8b";ctx.fillRect(0,135,500,50);ctx.fillStyle="#6e8c9e";ctx.fillRect(190,0,75,350);
   for(let j=0;j<9;j++){ctx.fillStyle=j%2?"#a7abaf":"#d6ceba";ctx.fillRect(35+j%3*145,35+Math.floor(j/3)*100,45,45);}
   const staging=document.createElement("canvas");staging.width=500;staging.height=350;
   BattlefieldWeather.draw(staging.getContext("2d"),500,350,i*10000+1000,{environment:"ground"},{weather,dayNight:time},1,1);
   BattlefieldWeather.draw(ctx,500,350,i*10000+4000,{environment:"ground"},{weather,dayNight:time},1,1);
   ctx.fillStyle="#fff";ctx.font="20px sans-serif";ctx.fillText(weather+" / "+time,12,330);ctx.restore();
  }
 });
 await page.locator("#weather-quality").screenshot({path:"build/weather-quality.png"});
});
