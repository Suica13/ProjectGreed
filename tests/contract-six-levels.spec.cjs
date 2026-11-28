const {test,expect}=require('@playwright/test');
const {createServer}=require('../server');
const G=require('../shared/rules');
for(const width of [1440,390])test(`online contract T1/T2 settings and T2 N6 deployment at ${width}px`,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:960});
 const app=createServer({port:0,aiDelayMs:999999,resultReturnMs:999999}),address=await app.listen(),base='http://127.0.0.1:'+address.port;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const idle=()=>page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
 try{
  await page.goto(base);await page.waitForFunction(()=>assetsReady);
  await page.locator('#profileCompanyName').fill('N6 PMC');await page.locator('#profileOnboardingConfirm').click();
  await page.evaluate(()=>{
   I18n.setLanguage('zh');Economy.creditActivity({id:'n6-carrier',matchId:'n6-carrier',money:0,supplies:0,inventory:{Medea:1}});
   Economy.receiveDeliveries();
   const item=Economy.snapshot().storage.ships.find(item=>item.unitId==='Medea');
   localStorage.setItem('slg-formations-v1.PMC',JSON.stringify({version:3,squads:[{name:'N6',units:[{unitId:item.unitId,kitId:item.kitId,stockId:item.id}]}]}));
   localStorage.setItem('slg-formations-v1.PMC-active','0');
  });
  await page.reload();await page.waitForFunction(()=>assetsReady);
  await page.evaluate(base=>Lobby.reconnect(base),base);
  await page.locator('#createRoom').click();await page.locator('#roomCode').fill('CONTRACT_SIX');
  await page.locator('#newRoomMode').selectOption('sweep');await page.locator('#roomCreateForm button[type="submit"]').click();await idle();
  if(width<700)await page.locator('[data-room-tab="settings"]').click();
  expect(await page.locator('#sweepDifficulty option').evaluateAll(nodes=>nodes.map(node=>({value:node.value,disabled:node.disabled}))))
   .toEqual([1,2,3,4,5,6].map(n=>({value:String(n),disabled:false})));
  expect(await page.locator('#sweepEra option').evaluateAll(nodes=>nodes.filter(n=>!n.disabled).map(n=>n.value))).toEqual(['UC_0079_T1','UC_0079_T2','CE_0071_T1']);
  for(const [n,cost] of [[1,3000],[2,4500],[3,6000],[4,9000],[5,12000],[6,15000]]){
   await page.locator('#sweepDifficulty').selectOption(String(n));await idle();
   await expect.poll(()=>page.evaluate(()=>Net.snapshot.settings.sweepDifficulty)).toBe(n);
   await expect(page.locator('#roomCostLimit')).toHaveValue(String(cost));
   await expect(page.locator('#roomUnitLimit')).toHaveValue(n<4?'3':'4');
  }
  await page.locator('#sweepEra').selectOption('UC_0079_T2');await idle();
  await page.locator('#sweepDifficulty').selectOption('1');await idle();
  await expect(page.locator('#roomCostLimit')).toHaveValue('4500');
  await expect(page.locator('#roomUnitLimit')).toHaveValue('3');
  await page.locator('#sweepDifficulty').selectOption('6');await idle();
  await expect(page.locator('#roomCostLimit')).toHaveValue('22500');
  if(width<700)await page.locator('#closeRoomSettingsSheet').click();
  await page.locator('#startRoomGame').click();await expect(page.locator('#confirmFinalFormation')).toBeVisible();
  await page.locator('#confirmFinalFormation').click();
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.phase)).toBe('deployment');
  const room=app.rooms.get('CONTRACT_SIX');
  expect(room.game.units.filter(u=>u.team>0&&!u.facility&&!G.modelOf(u).facility)).toHaveLength(45);
  expect(await page.evaluate(()=>ContractMode.config(6,'UC_0079_T2').relativePressure)).toBe(1.25);
  const map=G.catalog.maps[room.game.mapId];
  const edge=area=>area.x===0?'left':area.x+area.width===map.width?'right':area.y===0?'top':'bottom';
  expect(edge(room.game.contract.entries[0])).not.toBe(edge(room.game.contract.entries[1]));
  const maRules=await page.evaluate(()=>{
   const ma=Object.values(Rules.models).find(model=>model.unitTags?.includes('MA')&&!model.formOnly&&!model.requiredPilotId);
   return {fleet:Rules.isFleetCarrier(ma),allowed:Rules.hangarAllowsModel(Rules.models.PegasusClass__standard.hangars[0],ma),
    disabled:Rules.planFormation([{unitId:ma.prefabId,kitId:ma.kitId}],Infinity,{requiresCarriers:true,fleetLimit:1}).disabled};
  });
  expect(maRules).toEqual({fleet:true,allowed:false,disabled:[]});
  expect(room.game.contract.objectives).toHaveLength(6);
  for(const unit of room.game.units.filter(unit=>unit.team===1&&!unit.facility)){
   const model=G.modelOf(unit);expect(model.tags).toContain('UC_0079_T2');
   expect(G.contractMode.enemyStage(room,G,model)).toBe(1);
   expect([undefined,'veteran','elite']).toContain(unit.pilot.genericGrade);
  }
  expect(await page.evaluate(()=>[1,2,3,4,5,6].map(n=>({grade:ContractMode.enemyPilotGrade(n,.99),cap:ContractMode.config(n).patrolLimit})))).toEqual(
   [13,18,27,36,45,54].map(cap=>({grade:null,cap})));
  await page.evaluate(()=>Net.request('auto_place_deployment'));await idle();
  await page.evaluate(()=>Net.request('confirm_deployment'));await idle();
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.phase)).toBe('idle');
  for(const objective of room.game.contract.objectives)objective.status='completed';
  const actor=room.game.units.find(unit=>unit.ownerSeat===0),exit=room.game.contract.extractions[0];
  Object.assign(actor,{x:exit.x+1,y:exit.y+1,acted:false,moved:false});
  await page.evaluate(()=>Net.request('sync'));await idle();
  // UC0079T2 retains its existing era multiplier; round settlement to 25.
  const expected={money:44525,supplies:59375};
  await expect.poll(()=>page.evaluate(()=>({money:Net.snapshot.contract.pending.money,supplies:Net.snapshot.contract.pending.supplies}))).toEqual(expected);
  expect(await page.evaluate(()=>({money:MatchIncome.totals().money,supplies:MatchIncome.totals().supplies}))).toEqual(expected);
  await page.evaluate(id=>Net.request('contract_extract',{unitId:id}),actor.id);await idle();
  await expect.poll(()=>page.evaluate(()=>Net.snapshot.rewardsSettled)).toBe(true);
  const receipt=room.economyAwards.find(award=>award.kind==='result'&&award.memberId===room.seats[0].id);
  expect({money:receipt.money,supplies:receipt.supplies}).toEqual(expected);
  expect(errors).toEqual([]);
 }finally{await app.close();}
});
