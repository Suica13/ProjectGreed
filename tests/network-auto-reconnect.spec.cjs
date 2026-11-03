const {test,expect}=require('@playwright/test');
const {createServer}=require('../server.js');

test('an interrupted real WebSocket resumes the same seat automatically and accepts the next operation',async({page})=>{
 const app=createServer({host:'127.0.0.1',port:0}),address=await app.listen();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try {
   const base=`http://127.0.0.1:${address.port}`;
   await page.goto(base);await page.waitForFunction(()=>assetsReady);
   await page.evaluate(base=>Lobby.reconnect(base),base);
   await page.locator('#createRoom').click();await page.locator('#roomCode').fill('AUTORECONNECT');
   await page.locator('#roomCreateForm button[type="submit"]').click();
   await page.waitForFunction(()=>Net.snapshot&&!Net.connecting);
   const member=await page.evaluate(()=>Net.memberId);
   await page.evaluate(()=>{window.beforeDisconnect=Net.socket;Net.socket.close();});
   await page.waitForFunction(()=>Net.socket!==beforeDisconnect&&Net.socket.readyState===WebSocket.OPEN&&!Net.connecting&&!!Net.snapshot);
   expect(await page.evaluate(()=>Net.memberId)).toBe(member);
   await page.evaluate(()=>Net.request('set_ready',{ready:true,formation:[{unitId:'Type61',kitId:'standard'}]}));
   await page.waitForFunction(()=>!Net.awaiting);
   expect(await page.locator('#disconnectDialog').evaluate(e=>e.open)).toBe(false);
   expect(errors).toEqual([]);
 } finally {await page.evaluate(()=>Net.leave()).catch(()=>{});await app.close();}
});
