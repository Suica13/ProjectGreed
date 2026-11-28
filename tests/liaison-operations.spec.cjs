const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('liaison UI and pilot weapon totals '+width,async({page})=>{
 test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewportSize({width,height:1000});
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('Liaison UI');await page.locator('#profileOnboardingConfirm').click();
 await expect(page.locator('#newRoomMode option[value="mission"]')).toHaveJSProperty('disabled',true);
 const options=await page.locator('#newRoomMode').evaluate(s=>[...s.options].map(o=>o.value));expect(options.indexOf('mission')).toBe(options.indexOf('sweep')+1);
 const values=await page.evaluate(()=>{
  const model=UnitModels.RGM_79__machine_gun,pilot=PilotSystem.custom({...PilotSystem.createCustom('custom-preview-test','测试'),stats:{...PilotSystem.baseStats(),shooting:125,accuracy:125}}),unit={model:"RGM_79__machine_gun",pilot};
  const host=document.createElement('section');host.id='weapon-preview-check';host.style='position:fixed;inset:20px;z-index:100000;background:#102331;padding:12px;overflow:auto';
  host.append(UnitPreview.attributePages(model,'preview-check',unit));document.body.append(host);
  const weapon=model.weapons.find(w=>w.type!=='melee'&&w.slot!=='skill'),base=WeaponInfo.summary(weapon),modified=WeaponInfo.summary(weapon,{unit});
  host.append(modified);
  for(const id of ['Facility_MG','Facility_Beam','Facility_Missile','Facility_Cannon','Facility_Radar']){const image=document.createElement('img');image.src=unitIcon(id+'__standard');image.alt=id;image.width=image.height=96;host.append(image);}
  return {base:base.querySelector('.weapon-total-damage').textContent,modified:modified.querySelector('.weapon-total-damage').textContent,hit:modified.querySelector('.weapon-hit-rate').textContent,baseHit:base.querySelector('.weapon-hit-rate').textContent};
 });expect(values.modified).not.toBe(values.base);expect(values.hit).not.toBe(values.baseHit);
 await page.locator('#weapon-preview-check').getByRole('button',{name:'武装列表',exact:true}).click();
 await expect(page.locator('#weapon-preview-check .weapon-pilot-effects').first()).toBeVisible();
 await page.screenshot({path:'tmp/verification/screenshots/liaison-pilot-'+width+'.png'});
 await page.evaluate(()=>document.querySelector('#weapon-preview-check').remove());
 await page.evaluate(()=>{const state=Economy.snapshot();state.contactTasks.push({id:'efsf-13',status:'accepted',progress:0,progressVersion:4});localStorage.setItem('projectgreed.economy.v1',SaveCodec.stringify(state));});
 await page.reload();await page.waitForFunction(()=>assetsReady);await expect(page.locator('#newRoomMode option[value="mission"]')).toHaveJSProperty('disabled',false);
 await page.evaluate(()=>{
  Economy.meetLiaison('zeon');
  for(const id of ['zeon-1','zeon-2','zeon-3','zeon-4']){const task=ContactTasks.byId.get(id);Economy.acceptContactTask(id);Economy.creditAward({id,matchId:id,money:0,supplies:0,contactProgress:[{id,amount:task.required}]});Economy.completeContactTask(id);}
  Economy.acceptContactTask('zeon-5');Economy.receiveDeliveries();const loan=Economy.snapshot().storage.units.find(i=>i.contactLoan==='zeon-5');WarehouseUI.openItem(loan.id);
 });
 await expect(page.locator('#warehouseSellUnit')).toBeHidden();
 await expect(page.locator('#warehouseRemoveAllPlugins')).toBeVisible();
 await expect(page.locator('#warehouseRemoveAllPlugins')).toBeDisabled();
 expect(errors).toEqual([]);
});

test('native armor variants and authored task maps render',async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width:1500,height:1100});await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('Visual review');await page.locator('#profileOnboardingConfirm').click();
 await page.evaluate(async()=>{
  const panel=document.createElement('section');panel.id='visual-review';panel.style='position:fixed;inset:0;z-index:100000;background:#15212b;padding:10px;overflow:auto;display:flex;flex-wrap:wrap;align-content:start';document.body.append(panel);
  for(const id of ['RX_81ST','RX_81LA','RX_81AS']){
   const prefab=ART.prefabs.find(p=>p.id===id),modelId=id+'__'+prefab.weaponKits[0].id,model=UnitModels[modelId];
   await SpriteRenderer.ensureModels([modelId]);const box=document.createElement('section'),label=document.createElement('div'),canvas=document.createElement('canvas');label.textContent=model.name;canvas.width=canvas.height=240;box.append(label,canvas);panel.append(box);UnitPreview.renderPreview(modelId,canvas,180,'card');
  }
  const maps=document.createElement('div');maps.style='display:flex;gap:12px;width:100%';panel.append(maps);
  for(const id of ['mission_efsf_13','mission_efsf_16']){
   const map=Rules.getMap(id),box=document.createElement('section'),title=document.createElement('h3'),canvas=document.createElement('canvas');title.textContent=map.name;canvas.width=map.width*12;canvas.height=map.height*12;box.append(title,canvas);maps.append(box);
   const view=TileMapView.create();await Promise.all(map.tileMap.tilesets.map(t=>new Promise(resolve=>{const image=view.image(t.image);if(image)return resolve();const timer=setInterval(()=>{if(view.image(t.image)){clearInterval(timer);resolve();}},20);})));view.draw(canvas.getContext('2d'),map.tileMap,'below',{ox:0,oy:0,cellWidth:12,cellHeight:12,width:canvas.width,height:canvas.height});
  }
 });await page.screenshot({path:'tmp/verification/screenshots/liaison-native-and-maps.png'});
});
