const {test,expect}=require("@playwright/test");
const {createServer}=require("../server");
for(const width of [1440,390]) test(`both compact contract exits appear and the second permits extraction at ${width}px`,async({page})=>{
  test.setTimeout(90000);
  await page.setViewportSize({width,height:960});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const app=createServer({host:"127.0.0.1",port:0,aiDelayMs:999999,resultReturnMs:999999});
  const address=await app.listen(),base="http://127.0.0.1:"+address.port;
  const idle=()=>page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
  const act=async(action,fields={})=>{
    await idle();
    await page.evaluate(({action,fields})=>Net.request(action,fields),{action,fields});
    await idle();
  };
  try {
    await page.goto(base);
    await page.waitForFunction(()=>assetsReady);
    await page.evaluate(base=>{
      I18n.setLanguage("zh");
      byId("newRoomMode").value="sweep";
      Net.serverURL=base.replace("http:","ws:")+"/ws";
      Net.room="TWO_EXITS";
      Net.connect("create",true);
    },base);
    await idle();
    const formation=await page.evaluate(()=>{
      const unit=Economy.storedUnits().find(unit=>unit.unitId==="Medea");
      return [{unitId:unit.unitId,kitId:unit.kitId,stockId:unit.id}];
    });
    await act("start_game",{formation});
    await act("confirm_formation");
    const briefing=page.locator("#operationBriefing");
    await expect(briefing).toBeVisible();
    await expect(briefing.locator('.briefing-goal[data-goal-id^="deployment-"]')).toHaveCount(2);
    await expect(briefing.locator('.briefing-goal[data-goal-id^="extraction-"]')).toHaveCount(2);
    await briefing.locator("footer").getByRole("button",{name:"关闭",exact:true}).click();
    for(const index of [1,2]) await expect(page.locator("#contractHud").getByRole("button",{name:"入场区 "+index,exact:true})).toBeVisible();
    await act("auto_place_deployment");
    await act("confirm_deployment");
    for(const index of [1,2]) await expect(page.locator("#contractHud").getByRole("button",{name:"撤离区 "+index,exact:true})).toBeVisible();
    const bounds=await page.locator("#contractHud").evaluate(node=>{
      const rect=node.getBoundingClientRect();return {left:rect.left,right:rect.right,width:innerWidth};
    });
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(bounds.width);
    const room=app.rooms.get("TWO_EXITS"),g=room.game;
    const actor=g.units.find(unit=>unit.ownerSeat===0),zone=g.contract.extractions[1];
    expect(g.contract.extractions).toHaveLength(2);
    expect(zone.width).toBe(6);
    expect(zone.height).toBe(6);
    Object.assign(actor,{x:zone.x+1,y:zone.y+1});
    await act("sync");
    await page.evaluate(id=>{selected=id;update();},actor.id);
    await expect(page.locator("#hudContractExtract")).toBeVisible();
    await page.locator("#hudContractExtract").click();
    await expect.poll(()=>page.evaluate(()=>Net.snapshot.game.winner)).toBe(0);
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate(()=>Net.leave()).catch(()=>{});
    await app.close();
  }
});
