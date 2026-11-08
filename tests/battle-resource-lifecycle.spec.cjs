const {test,expect}=require("@playwright/test"),{pathToFileURL}=require("node:url"),path=require("node:path");
const url=pathToFileURL(path.resolve("public/client.html")).href;
async function open(page){await page.goto(url);await page.waitForFunction(()=>assetsReady);}
test("restarting and alternating maps release derived canvases and retain only the current decoded battle sheets",async({page})=>{
 test.setTimeout(120000);await open(page);
 const errors=[];page.on("pageerror",error=>errors.push(error.message));
 const records=await page.evaluate(async()=>{
  Net.leave();const e={unitId:"Type61",kitId:"standard"};
  const maps=Object.values(Rules.catalog.maps).filter(map=>map.tileMap&&map.environment!=="space").slice(0,2);
  const models=["Type61","Medea","SalamisClass","MA_08"].map(id=>Object.keys(UnitModels).find(key=>UnitModels[key].prefabId===id));
  const nextFrame=()=>new Promise(resolve=>requestAnimationFrame(resolve)),records=[];
  for(let round=0;round<12;round++){
   setPageView("room");CombatPlayback.reset();PlanningUI.reset();MapEffects.reset();
   const g=Rules.create(false,round+1,[[e],[e]],false,{fogMode:"disabled"});
   const map=maps[round%3===2?1:0];g.mapId=map.id;g.tiles=structuredClone(map.tiles);g.environment=map.environment;
   const source=g.units[0];g.units=Array.from({length:48},(_,i)=>({...structuredClone(source),id:"cycle-"+i,model:models[i%models.length],x:3+i%12*2,y:4+Math.floor(i/12)*3,angle:i%4*90}));
   g.deployment=null;g.ai=false;g.fogMode="disabled";g.climateSettings={weather:"clear",dayNight:"noon"};
   const snapshot={room:"RESOURCE",matchId:"cycle-"+round,started:true,phase:"idle",game:g};
   const pending=new Promise(resolve=>{if(!BattleAssets.guard(snapshot,resolve))resolve();});
   const cleared=SpriteRenderer.cacheStats();
   if(cleared.idle||cleared.shadow||cleared.outlines||TileMapRenderer.cacheStats().chunks)throw Error("Previous battle canvases retained");
   await pending;game=g;phase="idle";mode="select";selected=moving=battleView=null;
   setPageView("game");MapCamera.reset();MapCamera.setPercent(25);update();
   for(let frame=0;frame<10;frame++)await nextFrame();
   const samples=[];for(let frame=0;frame<4;frame++){const start=performance.now();drawMap(start);samples.push(performance.now()-start);await nextFrame();}
   const resources=SpriteRenderer.cacheStats();
   // A repeated snapshot and temporary hangar navigation must preserve this battle.
   const before=JSON.stringify(resources);BattleAssets.guard(snapshot,()=>{});
   if(JSON.stringify(SpriteRenderer.cacheStats())!==before)throw Error("Same battle resources were discarded");
   records.push({map:map.id,...resources,tiles:TileMapRenderer.cacheStats(),mean:samples.reduce((a,b)=>a+b)/samples.length});
  }
  setPageView("room");BattleAssets.release();
  records.push({released:true,...SpriteRenderer.cacheStats(),tiles:TileMapRenderer.cacheStats()});
  return records;
 });
 const rounds=records.filter(row=>!row.released);expect(rounds).toHaveLength(12);
 for(const row of rounds){expect(row.idlePixels).toBeLessThanOrEqual(row.idlePixelLimit);expect(row.idle).toBeLessThanOrEqual(row.idleEntryLimit);expect(row.shadowPixels).toBeLessThanOrEqual(8*1024*1024);expect(row.tiles.pixels).toBeLessThanOrEqual(8*1024*1024);}
 expect(rounds.at(-1).decodedPixels).toBeLessThanOrEqual(rounds[0].decodedPixels*1.05);
 expect(rounds.at(-1).sources).toBeLessThanOrEqual(rounds[0].sources+5);
 const released=records.at(-1);expect(released.idlePixels+released.shadowPixels+released.outlinePixels+released.tiles.pixels).toBe(0);
 expect(released.decodedPixels).toBeLessThan(rounds[0].decodedPixels);
 require("node:fs").writeFileSync("build/battle-resource-cycles.json",JSON.stringify(records,null,2));
 expect(errors).toEqual([]);
});
test("a previous battle's delayed image cannot resurrect discarded textures or resume its scene",async({page})=>{
 await open(page);
 await page.evaluate(()=>{
  const target={room:"new",matchId:"new",phase:"idle",game:{mapId:game.mapId,units:[{model:Economy.baseModel("Type61")}]}};
  const old={room:"old",matchId:"old",phase:"playback",game:{mapId:game.mapId,units:[{model:Economy.baseModel("AlbionClass")}]}};
  const keep=new Set([...SpriteRenderer.battleKeys(target).map(key=>ART.assets[key]),...ART.units.map(unit=>ART.assets[unit.icon])]);
  const stale=SpriteRenderer.battleKeys(old).find(key=>!keep.has(ART.assets[key]));
  window.staleBattleAsset=stale;window.staleResumeCount=0;window.nextSceneLoaded=false;
  const NativeImage=Image;let held=false;
  window.Image=class extends NativeImage {set src(value){if(!held&&value===ART.assets[stale]){held=true;window.releaseStaleBattleAsset=()=>{super.src=value;};}else super.src=value;}};
  BattleAssets.guard(old,()=>staleResumeCount++);
  BattleAssets.release();
  if(!BattleAssets.guard(target,()=>nextSceneLoaded=true))nextSceneLoaded=true;
 });
 await page.waitForFunction(()=>nextSceneLoaded&&typeof releaseStaleBattleAsset==="function");
 await page.evaluate(()=>releaseStaleBattleAsset());
 await page.waitForFunction(()=>SpriteRenderer.cacheStats().pending===0);
 expect(await page.evaluate(()=>({resumed:staleResumeCount,resurrected:!!SpriteRenderer.images[staleBattleAsset],loading:BattleAssets.loading}))).toEqual({resumed:0,resurrected:false,loading:false});
});


test("real offline room return and restart snapshots release the previous battlefield",async({page})=>{
 test.setTimeout(120000);await open(page);const errors=[];page.on("pageerror",error=>errors.push(error.message));
 await page.locator("#openSkirmish").click();await page.locator("#createOfflineRoom").click();
 await page.waitForFunction(()=>Net.snapshot?.phase==="waiting"&&!Net.awaiting);
 const maps=await page.evaluate(()=>Object.values(Rules.catalog.maps).filter(map=>map.tileMap&&map.environment!=="space").slice(0,2).map(map=>map.id));
 const matches=[];
 for(const map of [maps[0],maps[0],maps[1]]){
  await page.evaluate(map=>Net.request("configure_room",{...Net.snapshot.settings,mapId:map,battleMode:"quick"}),map);
  await page.waitForFunction(map=>Net.snapshot?.settings.mapId===map&&!Net.awaiting,map);
  await page.evaluate(()=>Net.request("start_game",{formation:[{unitId:"Type61",kitId:"standard"}],licenses:Economy.snapshot().licenses,...Economy.normalizeStock(Economy.snapshot())}));
  await page.waitForFunction(()=>Net.snapshot?.phase==="assembly"&&!Net.awaiting);
  await page.evaluate(()=>Net.request("confirm_formation"));
  await page.waitForFunction(()=>Net.snapshot?.phase==="deployment"&&!Net.awaiting&&!BattleAssets.loading);
  await page.evaluate(()=>Net.request("confirm_deployment"));
  await page.waitForFunction(()=>Net.snapshot?.phase==="idle"&&!Net.awaiting);
  matches.push(await page.evaluate(()=>Net.snapshot.matchId));
  await page.evaluate(()=>{MapCamera.setPercent(25);});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>Net.request("return_room"));
  await page.waitForFunction(()=>Net.snapshot?.phase==="waiting"&&!Net.snapshot.started&&!Net.awaiting,{},{timeout:15000});
  const stats=await page.evaluate(()=>({...SpriteRenderer.cacheStats(),tiles:TileMapRenderer.cacheStats()}));
  expect(stats.idlePixels+stats.shadowPixels+stats.outlinePixels+stats.tiles.pixels).toBe(0);
 }
 expect(new Set(matches).size).toBe(3);expect(errors).toEqual([]);
});
