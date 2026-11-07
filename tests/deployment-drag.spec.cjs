const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');const path=require('node:path');
for(const width of [1600,390]) test('two-row deployment grid, click selection and drag join/board/failure / '+width,async({page})=>{
 test.setTimeout(60000);await page.setViewportSize({width,height:width===390?844:1000});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 await page.evaluate(()=>{
  const original=createRoomEngine;createRoomEngine=options=>(window.dragEngine=original({...options,aiDelayMs:999999}));
  Formation.current=()=>[{unitId:'Medea',kitId:'standard'},...Array.from({length:34},()=>({unitId:'Type61',kitId:'standard'}))];
 });
 await page.locator('#openSkirmish').click();await page.locator('#offlineRoomMode').selectOption('quick');
 await page.locator('#createOfflineRoom').click();await page.locator('#startRoomGame').click();
 await page.locator('#confirmFinalFormation').click();
 await expect(page.locator('#deploymentBottomBar')).toBeVisible();
 await expect(page.locator('#deploymentRoster button')).toHaveCount(35);
 const geometry=await page.evaluate(()=>{
  const roster=document.querySelector('#deploymentRoster'),controls=document.querySelector('#deploymentControls');
  const items=[...roster.children].map(el=>el.getBoundingClientRect());
  const r=roster.getBoundingClientRect(),c=controls.getBoundingClientRect(),b=document.querySelector('#deploymentBottomBar').getBoundingClientRect(),a=document.querySelector('#deploymentAuto').getBoundingClientRect();
  return {height:r.height,rowHeight:items[0].height,first:items[0].toJSON(),second:items[1].toJSON(),roster:r.toJSON(),controls:c.toJSON(),panel:b.toJSON(),auto:a.toJSON(),overflow:roster.scrollHeight>roster.clientHeight};
 });
 expect(geometry.height).toBe(geometry.rowHeight*2+14);
 expect(geometry.second.y).toBe(geometry.first.y);expect(geometry.second.x).toBeGreaterThan(geometry.first.x);
 expect(geometry.roster.right).toBeLessThan(geometry.controls.left);
 expect(geometry.auto.bottom).toBeLessThanOrEqual(geometry.panel.top);
 if(width===390) expect(geometry.overflow).toBe(true);
 const ids=await page.evaluate(()=>{
  const room=[...dragEngine.rooms.values()][0],g=room.game,own=g.units.filter(u=>u.ownerSeat===Net.seat);
  Rules.clearDeployment(g,Net.seat);
  const carrier=own[0],a=own[1],b=own[2];
  Rules.deploy(g,Net.seat,carrier.id,2,2);Rules.deploy(g,Net.seat,a.id,5,5);Rules.deploy(g,Net.seat,b.id,7,5);
  room.revision++;dragEngine.broadcast(room);
  window.dragNotes=[];window.dragSounds=[];
  const oldNote=note,oldPlay=GameAudio.play;note=message=>{dragNotes.push(message);oldNote(message);};
  GameAudio.play=key=>{dragSounds.push(key);oldPlay(key);};
  return {carrier:carrier.id,a:a.id,b:b.id,others:own.slice(3).map(u=>u.id)};
 });
 await expect.poll(()=>page.evaluate(()=>!Net.awaiting)).toBe(true);
 await page.evaluate(()=>{MapCamera.setPercent(35);MapCamera.focus(5,5,{preserveZoom:true});});
 async function location(id){return page.evaluate(id=>{
  const unit=getUnit(id),cells=Rules.cells(unit),x=cells.reduce((sum,c)=>sum+c.x,0)/cells.length,y=cells.reduce((sum,c)=>sum+c.y,0)/cells.length;
  const rect=byId('map').getBoundingClientRect();return{x:rect.left+mapGeo.ox+(x+.5)*mapGeo.tile,y:rect.top+mapGeo.oy+(y+.5)*mapGeo.tile};
 },id);}
 const touch=width===390?await page.context().newCDPSession(page):null;
 async function drag(from,to){
  const a=await location(from),b=await location(to);
  if(touch){
   await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[a]});
   for(let i=1;i<=12;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:a.x+(b.x-a.x)*i/12,y:a.y+(b.y-a.y)*i/12}]});
   await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  }else{
   await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});await page.mouse.up();
  }
  await expect.poll(()=>page.evaluate(()=>!Net.awaiting)).toBe(true);
 }
 const a=await location(ids.a),b=await location(ids.b);
 await page.mouse.click(a.x,a.y);await page.mouse.click(b.x,b.y);
 expect(await page.evaluate(()=>selected)).toBe(ids.b);
 expect(await page.locator('dialog[open]').count()).toBe(0);
 expect(await page.evaluate(id=>Rules.squadMembers(game,getUnit(id)).length,ids.a)).toBe(1);
 await drag(ids.a,ids.b);
 await expect.poll(()=>page.evaluate(id=>Rules.squadMembers(game,getUnit(id)).length,ids.b)).toBe(2);
 await expect(page.locator('#hudSquad')).toBeVisible();
 const strip=await page.locator('#hudSquad').boundingBox();
 const auto=await page.locator('#deploymentAuto').boundingBox();
 expect(strip.y+strip.height).toBeLessThan(auto.y);
 await page.screenshot({path:'build/deployment-drag-'+width+'.png'});
 // Fill the receiving squad, keeping the next passenger separate for a rejected drop.
 const extra=await page.evaluate(ids=>{
  const room=[...dragEngine.rooms.values()][0],g=room.game,target=g.units.find(u=>u.id===ids.b);
  for(const id of ids.others.slice(0,4)) { Rules.deploy(g,Net.seat,id,5,10); Rules.deploy(g,Net.seat,id,target.x,target.y); }
  Rules.deploy(g,Net.seat,ids.others[4],5,7);
  room.revision++;dragEngine.broadcast(room);return ids.others[4];
 },ids);
 if(width===390) await page.evaluate(()=>MapCamera.focus(5,7,{preserveZoom:true}));
 const before=await page.evaluate(id=>{const u=getUnit(id);return{x:u.x,y:u.y};},extra);
 await drag(extra,ids.b);
 expect(await page.evaluate(id=>{const u=getUnit(id);return{x:u.x,y:u.y};},extra)).toEqual(before);
 expect(await page.evaluate(()=>dragNotes.filter(text=>text==='加入失败').length)).toBe(1);
 expect(await page.evaluate(()=>dragSounds.filter(key=>key==='underAttackSound').length)).toBe(1);
 await drag(extra,ids.carrier);
 await expect(page.locator('#hangarDialog')).toBeVisible();
 const board=page.locator('#hangarDialog [data-board-id="'+extra+'"]');
 await expect(board.first()).toBeEnabled();await board.first().click();
 await expect.poll(()=>page.evaluate(id=>getUnit(id).embarked?.carrierId,extra)).toBe(ids.carrier);
 if(touch){
  const spot=await location(ids.a),before=await page.evaluate(id=>({x:getUnit(id).x,y:getUnit(id).y}),ids.a);
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[spot]});
  const moved={x:spot.x-12,y:spot.y+2};
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[moved]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[moved,{x:spot.x-40,y:spot.y-40}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:spot.x+10,y:spot.y+10},{x:spot.x-50,y:spot.y-50}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  expect(await page.evaluate(id=>({x:getUnit(id).x,y:getUnit(id).y}),ids.a)).toEqual(before);
  expect(await page.evaluate(id=>Deployment.isDragging(id),ids.a)).toBe(false);
 }
 expect(errors).toEqual([]);
});
