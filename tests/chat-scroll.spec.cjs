const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");

test("chat keeps reading position through snapshots and page changes, and follows new messages only at the bottom",async({page})=>{
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.evaluate(()=>{
    window.scrollChatSnapshot={...Net.snapshot,chat:Array.from({length:60},(_,i)=>({
      id:"scroll-"+i,memberId:"reader",name:"Reader",text:"History line "+i,channel:"all",at:Date.now()
    }))};
    Chat.setSnapshot(scrollChatSnapshot);
    Chat.selectRoomTab("chat");
  });
  const room=page.locator("#roomChatLines");
  await expect.poll(()=>room.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(300);
  await room.evaluate(el=>el.scrollTop=120);
  await page.waitForTimeout(60);
  await page.evaluate(()=>Chat.setSnapshot(scrollChatSnapshot));
  expect(await room.evaluate(el=>el.scrollTop)).toBeCloseTo(120,0);
  await page.evaluate(()=>{setPageView("game");Chat.selectTab("chat");});
  const battle=page.locator("#chatLines");
  await battle.evaluate(el=>el.scrollTop=100);
  await page.waitForTimeout(60);
  await page.evaluate(()=>{
    setPageView("room");
    scrollChatSnapshot.chat.push({id:"new",memberId:"reader",name:"Reader",text:"New message",channel:"all",at:Date.now()});
    Chat.setSnapshot(scrollChatSnapshot);
  });
  expect(await room.evaluate(el=>el.scrollTop)).toBeCloseTo(120,0);
  await page.evaluate(()=>setPageView("game"));
  expect(await battle.evaluate(el=>el.scrollTop)).toBeCloseTo(100,0);
  await battle.evaluate(el=>el.scrollTop=el.scrollHeight);
  await page.waitForTimeout(60);
  await page.evaluate(()=>{
    scrollChatSnapshot.chat.push({id:"last",memberId:"reader",name:"Reader",text:"Last message",channel:"all",at:Date.now()});
    Chat.setSnapshot(scrollChatSnapshot);
  });
  expect(await battle.evaluate(el=>el.scrollHeight-el.scrollTop-el.clientHeight)).toBeLessThan(2);
});


test("strategic chat restores its reading position after a battlefield visit",async({page})=>{
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#openSkirmish").click();
  await page.locator("#offlineRoomMode").selectOption("campaign");
  await page.locator("#createOfflineRoom").click();
  await page.locator("#startRoomGame").click();
  await page.locator(".campaign-setup button").last().click();
  await expect(page.locator("#campaignScreen")).toBeVisible();
  await page.locator("#campaignShowChat").click();
  await page.evaluate(()=>{
    window.scrollChatSnapshot={...Net.snapshot,chat:Array.from({length:60},(_,i)=>({
      id:"strategy-"+i,memberId:"reader",name:"Reader",text:"History "+i,channel:"all",at:Date.now()
    }))};
    Chat.setSnapshot(scrollChatSnapshot);
  });
  const list=page.locator("#campaignChatLines");
  await expect.poll(()=>list.evaluate(el=>el.scrollHeight-el.clientHeight)).toBeGreaterThan(300);
  await list.evaluate(el=>el.scrollTop=120);
  await page.waitForTimeout(60);
  await page.evaluate(()=>{
    setPageView("game");
    Chat.setSnapshot(scrollChatSnapshot);
    CampaignUI.open();
  });
  await expect(page.locator("#campaignScreen")).toBeVisible();
  await expect.poll(()=>list.evaluate(el=>el.scrollTop)).toBeCloseTo(120,0);
});
