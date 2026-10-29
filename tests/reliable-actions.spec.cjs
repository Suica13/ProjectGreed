const {test,expect}=require("@playwright/test");
const {createServer}=require("../server.js");
test("a delayed peer loses one request and recovers readiness without manual retry or blocking its host",async({page,browser})=>{
 test.setTimeout(60000);
 const app=createServer({host:"127.0.0.1",port:0}),address=await app.listen();
 const context=await browser.newContext(),guest=await context.newPage();
 const errors=[];
 for(const p of [page,guest])p.on("pageerror",e=>errors.push(e.message));
 const idle=p=>p.waitForFunction(()=>Net.snapshot&&!Net.awaiting&&!Net.connecting);
 async function lobby(p){
  await p.goto("http://127.0.0.1:"+address.port);
  await p.waitForFunction(()=>assetsReady);
  await p.evaluate(port=>Lobby.reconnect("http://127.0.0.1:"+port),address.port);
  await expect(p.locator("#lobby")).toBeVisible();
 }
 try{
  await lobby(page);
  await page.locator("#createRoom").click();
  await page.locator("#roomCode").fill("RELIABLE");
  await page.locator('#roomCreateForm button[type=submit]').click();
  await idle(page);
  await lobby(guest);
  await guest.locator(".room-card").filter({hasText:"RELIABLE"}).getByRole("button").click();
  await idle(guest);
  await guest.evaluate(()=>{
   const socket=Net.socket,send=socket.send.bind(socket),receive=socket.onmessage;
   window.lostRequests=[];
   socket.send=raw=>{
    const m=JSON.parse(raw);
    if(m.action==="set_ready"){lostRequests.push(m);if(lostRequests.length===1)return;}
    send(raw);
   };
   socket.onmessage=event=>setTimeout(()=>receive(event),600);
  });
  const formation=[{unitId:"Type61",kitId:"standard"}];
  await guest.evaluate(formation=>Net.request("set_ready",{ready:true,formation}),formation);
  // Host keeps receiving and acting while the other peer's first request is lost.
  await page.evaluate(formation=>Net.request("update_formation",{formation}),formation);
  await idle(page);
  expect(await guest.evaluate(()=>!!Net.awaiting)).toBe(true);
  await idle(guest);
  expect(await guest.evaluate(()=>Net.snapshot.members.find(m=>m.id===Net.memberId).ready)).toBe(true);
  const retry=await guest.evaluate(()=>lostRequests);
  expect(retry.length).toBeGreaterThanOrEqual(2);
  expect(new Set(retry.map(m=>m.id)).size).toBe(1);
  // Disconnect after submission while the reply is still delayed. Resume retains ID.
  await guest.evaluate(()=>{
   Net.request("set_ready",{ready:false,formation:Formation.current()});
   window.resumeId=Net.awaiting.id;
   Net.socket.close();
  });
  await expect(guest.locator("#disconnectDialog")).toBeVisible();
  await guest.locator("#reconnectRoom").click();
  await idle(guest);
  expect(await guest.evaluate(()=>Net.snapshot.members.find(m=>m.id===Net.memberId).ready)).toBe(false);
  expect(errors).toEqual([]);
 }finally{await context.close();await page.close();await app.close()}
});
