const {test,expect}=require("@playwright/test");
const {createServer}=require("../server.js");

for(const width of [1280,390]) test(`observer assembly groups teams without the room license button at ${width}px`,async({browser})=>{
  test.setTimeout(45000);
  const app=createServer({host:"127.0.0.1",port:0}),address=await app.listen();
  const base="http://127.0.0.1:"+address.port,contexts=[],pages=[],errors=[];
  const idle=p=>p.waitForFunction(()=>Net.active&&Net.snapshot&&!Net.awaiting);
  const act=async(p,action,fields={})=>{
    await idle(p);await p.evaluate(({action,fields})=>Net.request(action,fields),{action,fields});await idle(p);
  };
  try {
    for(let i=0;i<3;i++) {
      const context=await browser.newContext({viewport:{width,height:900}});contexts.push(context);
      const page=await context.newPage();pages.push(page);
      page.on("pageerror",e=>errors.push(e.message));
      await page.goto(base);await page.waitForFunction(()=>assetsReady);
      await page.evaluate(({base,i})=>{
        I18n.setLanguage("zh");byId("playerId").value=["Host","Guest","Observer"][i];Lobby.reconnect(base);
      },{base,i});
      await expect(page.locator("#lobby")).toBeVisible();
      if(i===0) {
        await page.locator("#createRoom").click();await page.locator("#roomCode").fill("ASSEMBLY");
        await page.locator('#roomCreateForm button[type="submit"]').click();
      } else await page.locator(".room-card").filter({hasText:"ASSEMBLY"}).getByRole("button").click();
      await idle(page);
      await expect(page.locator("#roomProduction")).toHaveCount(0);
    }
    const [host,guest,watch]=pages,formation=[{unitId:"Type61",kitId:"standard"}];
    await act(guest,"set_ready",{ready:true,formation});
    await act(host,"start_game",{formation});
    await watch.waitForFunction(()=>Net.snapshot.phase==="assembly");
    await expect(watch.locator(".final-squad-team")).toHaveCount(2);
    await expect(watch.locator('.final-squad-team[data-team="0"] .final-squad')).toHaveCount(1);
    await expect(watch.locator('.final-squad-team[data-team="1"] .final-squad')).toHaveCount(1);
    expect(await watch.evaluate(()=>[...document.querySelectorAll(".final-squad-team .final-squad")].every(card=>card.dataset.team===card.closest(".final-squad-team").dataset.team))).toBe(true);
    await expect(host.locator(".final-squad-team")).toHaveCount(0);
    await watch.evaluate(()=>{
      const snapshot=structuredClone(Net.snapshot);
      snapshot.assembly.players.reverse();
      for(const player of snapshot.assembly.players)
        player.entries=Array.from({length:50},()=>player.entries[0]);
      RoomPanel.render(snapshot);
    });
    for(const team of [0,1]) {
      const list=watch.locator(`.final-squad-team[data-team="${team}"] .final-squad-team-list`);
      expect(await list.evaluate(node=>{node.scrollTop=30;return node.scrollTop>0;})).toBe(true);
    }
    expect(await watch.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    expect(await watch.locator("#finalSquads").evaluate(node=>{
      const rect=node.getBoundingClientRect();return rect.width>0&&rect.height>0&&rect.bottom<=innerHeight;
    })).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map(c=>c.close()));await app.close();
  }
});
