const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url");
const path=require("node:path");
const {createServer}=require("../server");
const Contract=require("../shared/contract-mode");

test("standalone low-level contracts load the front-line combat pool", async ({page}) => {
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  const result=await page.evaluate(()=>{
    const ids=new Set(),invalid=[];
    for(const difficulty of [1,2,3])for(let seed=1;seed<=200;seed++) {
      const room={settings:{sweepDifficulty:difficulty,sweepEra:"UC_0079_T1",sweepFaction:"ZEON",sweepEnvironment:"ground"}};
      for(const entry of ContractMode.enemies(room,Rules,Math.imul(seed,0x9e3779b1)>>>0)) {
        const model=Rules.models[entry.unitId+"__"+entry.kitId];ids.add(model.prefabId);
        if(model.unitTags.some(tag=>["Support","Transport","Infantry"].includes(tag)) ||
           !ContractMode.suitableEnvironment(model,"ground"))invalid.push(model.prefabId);
      }
    }
    return {ids:[...ids],invalid};
  });
  expect(result.invalid).toEqual([]);
  for(const id of ["MS_06F","MS_06J","MTank","Dopp"])expect(result.ids).toContain(id);
  expect(errors).toEqual([]);
});

test("random contract biomes render distinct grass, snow, desert and urban battlefields",async({page})=>{
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  const results=await page.evaluate(async()=>{
    const maps=new Map();
    for(let i=1;i<=64 && maps.size<4;i++){
      const map=ContractMode.generateMap(Rules.catalog,{sweepDifficulty:1,sweepEnvironment:"ground"},Math.imul(i,0x9e3779b1)>>>0);
      maps.set(map.contractLayout.biome,map);
    }
    const painter=TileMapView.create(),canvas=document.createElement("canvas");
    canvas.id="contractBiomePreview";canvas.width=1440;canvas.height=992;
    canvas.style.cssText="position:fixed;inset:0;z-index:999999;background:#101c2b";
    document.body.append(canvas);
    const ctx=canvas.getContext("2d"),results=[];
    for(const [index,biome] of ContractMode.biomes.entries()){
      const map=maps.get(biome.id),doc=ContractMode.visualMap(Rules.catalog,{...map,mapId:map.id}).tileMap;
      await Promise.all(doc.tilesets.map(set=>new Promise((resolve,reject)=>{
        let tries=0;const check=()=>painter.image(set.image)?resolve():++tries>300?reject(Error("atlas timeout")):setTimeout(check,20);check();
      })));
      const ox=(index%2)*720,oy=Math.floor(index/2)*496+40;
      ctx.fillStyle="#101c2b";ctx.fillRect(ox,oy-40,720,40);
      ctx.fillStyle="#e3f0ff";ctx.font="22px sans-serif";ctx.fillText(biome.name,ox+14,oy-12);
      painter.draw(ctx,doc,"below",{ox,oy,cellWidth:12,cellHeight:12,width:1440,height:992});
      const i=map.tiles.findIndex(row=>row.includes("plain")),x=map.tiles[i].indexOf("plain");
      results.push({biome:doc.biomeStyle.biome,color:[...ctx.getImageData(ox+x*12+6,oy+i*12+6,1,1).data]});
    }
    return results;
  });
  expect(results.map(r=>r.biome)).toEqual(["temperate","snow","desert","urban"]);
  expect(new Set(results.map(r=>r.color.join(","))).size).toBe(4);
  await page.locator("#contractBiomePreview").screenshot({path:"tmp/verification/screenshots/contract-biomes.png"});
});

test("all eight event markers and failed objectives have usable localized briefing UI",async({page})=>{
  const errors=[];page.on("pageerror",e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>{
    I18n.setLanguage("zh");
    const map=ContractMode.generateMap(Rules.catalog,{sweepDifficulty:1,sweepEnvironment:"ground"},12345);
    const objectives=ContractMode.kinds.map((kind,i)=>({...kind,id:"event-"+i,x:3+i*6,y:5,
      status:kind.type === "rescue" ? "failed" : "active",required:["defend","capture"].includes(kind.type)?5:3,progress:1,targets:[]}));
    ContractUI.receive({started:true,matchId:"marker-test",phase:"idle",settings:{mode:"sweep"},you:{seat:0},
      game:{...map,mapId:map.id,winner:null,units:[]},
      contract:{objectives,difficulty:ContractMode.config(1),completed:0,participants:[],cues:[]}});
    const canvas=document.createElement("canvas");canvas.id="contractMarkerPreview";canvas.width=1320;canvas.height=400;
    canvas.style.cssText="position:fixed;inset:100px 0;z-index:999999;background:#162333";document.body.append(canvas);
    const ctx=canvas.getContext("2d"),geo={ox:10,oy:10,tile:25};
    ContractUI.drawCoverage(ctx,geo);ContractUI.draw(ctx,geo);
  });
  await page.locator("#contractMarkerPreview").screenshot({path:"tmp/verification/screenshots/contract-event-markers.png"});
  await page.locator("#contractMarkerPreview").evaluate(n=>n.remove());
  // This isolated marker fixture runs without opening a network battle's map wrapper.
  await page.locator("#contractHud button").last().evaluate(button=>button.click());
  await expect(page.locator("#contractObjectives .contract-objective")).toHaveCount(8);
  await expect(page.locator('#contractObjectives [data-status="failed"] strong')).toHaveText("事件失败");
  await page.evaluate(()=>I18n.setLanguage("en"));
  await expect(page.locator('#contractObjectives [data-status="failed"] strong')).toHaveText("Objective failed");
  expect(errors).toEqual([]);
});

test("two network players share a proximity defense event and can extract after it fails",async({browser})=>{
  test.setTimeout(90000);
  const original=Contract.initialize;
  // Fix only the authoritative event shuffle; terrain and live sockets remain real.
  Contract.initialize=(room,G,seed,log)=>original(room,G,1,log);
  const app=createServer({host:"127.0.0.1",port:0,aiDelayMs:999999,resultReturnMs:999999});
  const address=await app.listen(),base="http://127.0.0.1:"+address.port;
  const contexts=[],pages=[],errors=[];
  const idle=p=>p.waitForFunction(()=>Net.active&&Net.snapshot&&!Net.awaiting);
  const act=async(p,action,fields={})=>{
    await idle(p);await p.evaluate(({action,fields})=>Net.request(action,fields),{action,fields});await idle(p);
  };
  try {
    for(let i=0;i<2;i++){
      const context=await browser.newContext({viewport:{width:i?390:1440,height:960}});
      contexts.push(context);const p=await context.newPage();pages.push(p);
      p.on("pageerror",error=>errors.push(error.message));
      await p.goto(base);await p.waitForFunction(()=>assetsReady);
      await p.evaluate(({base,i})=>{
        I18n.setLanguage("zh");byId("newRoomMode").value="sweep";
        Net.serverURL=base.replace("http:","ws:")+"/ws";Net.room="DEFENSE";Net.connect(i?"join":"create",true);
      },{base,i});await idle(p);
    }
    const formations=await Promise.all(pages.map(p=>p.evaluate(()=>{
      const ship=Economy.storedUnits().find(u=>u.unitId === "Medea");
      return [{unitId:ship.unitId,kitId:ship.kitId,stockId:ship.id}];
    })));
    await act(pages[1],"set_ready",{ready:true,formation:formations[1]});
    await act(pages[0],"start_game",{formation:formations[0]});
    for(const p of pages)await act(p,"confirm_formation");
    for(const p of pages){
      await p.locator("#operationBriefing footer").getByRole("button",{name:"关闭",exact:true}).click();
      await act(p,"auto_place_deployment");await act(p,"confirm_deployment");
    }
    const room=app.rooms.get("DEFENSE"),g=room.game,o=g.contract.objectives[0];
    expect(o.type).toBe("defend");expect(o.status).toBe("available");
    expect(g.units.filter(u=>u.contractAlly)).toHaveLength(6);
    const host=g.units.find(u=>u.ownerSeat===0),guest=g.units.find(u=>u.ownerSeat===2);
    Object.assign(host,{x:o.x+1,y:o.y+1});await act(pages[0],"sync");
    for(const p of pages)await expect.poll(()=>p.evaluate(()=>Net.snapshot.contract.objectives[0].status)).toBe("active");
    g.units.find(u=>u.id===o.coreId).hp=0;await act(pages[0],"sync");
    for(const p of pages)await expect.poll(()=>p.evaluate(()=>Net.snapshot.contract.objectives[0].status)).toBe("failed");
    Object.assign(host,{x:g.contract.extractions[0].x+1,y:g.contract.extractions[0].y+1});
    Object.assign(guest,{x:g.contract.extractions[1].x+1,y:g.contract.extractions[1].y+1});
    await act(pages[0],"contract_extract",{unitId:host.id});expect(g.winner).toBeNull();
    await act(pages[1],"contract_extract",{unitId:guest.id});
    for(const p of pages)await expect.poll(()=>p.evaluate(()=>Net.snapshot.game.winner)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    for(const context of contexts)await context.close();
    await app.close();Contract.initialize=original;
  }
});
