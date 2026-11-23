const {test,expect}=require('@playwright/test');
const {createServer}=require('../server');
const {pathToFileURL}=require('node:url'),path=require('node:path');

for(const width of [1440,390])test(`contract faction pair selector saves enemy and ally over WebSocket at ${width}px`,async({page})=>{
 const app=createServer({host:'127.0.0.1',port:0}),address=await app.listen();
 const base='http://127.0.0.1:'+address.port;
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.setViewportSize({width,height:960});await page.goto(base);await page.waitForFunction(()=>assetsReady);
  await page.locator('#profileCompanyName').fill('Faction PMC');await page.locator('#profileOnboardingConfirm').click();
  await page.evaluate(base=>{
   I18n.setLanguage('zh');byId('newRoomMode').value='sweep';
   Net.serverURL=base.replace('http:','ws:')+'/ws';Net.room='PAIR_UI';Net.connect('create',true);
  },base);
  await page.waitForFunction(()=>Net.snapshot&&!Net.awaiting);
  if(width<700)await page.locator('[data-room-tab="settings"]').click();
  const select=page.locator('#sweepFaction');
  await expect(select).toHaveValue('ZEON|EFSF');
  await expect(select.locator('option:checked')).toHaveText('吉翁公国军[地球联邦军]');
  await expect(select.locator('option')).toHaveCount(3);
  await select.selectOption('NONE|NONE');
  await expect.poll(()=>page.evaluate(()=>[Net.snapshot.settings.sweepFaction,Net.snapshot.settings.sweepAlliedFaction])).toEqual(['NONE','NONE']);
  await expect(select.locator('option:checked')).toHaveText('武装介入');
  expect(await page.evaluate(()=>{
    const previous=game.contract;game.contract={noAllies:true};
    const colors=[1,2,3].map(team=>UnitIdentity.style({team,ownerSeat:1}).color);
    game.contract=previous;return colors;
  })).toEqual(['#f06464','#ff7848','#f18bb8']);
  await expect(page.locator('#sweepEnvironment')).toHaveValue('ground');
  await expect(page.locator('#sweepEnvironment')).toBeDisabled();
  await expect(page.locator('#sweepEnvironment option[value="space"]')).toBeDisabled();
  const rejected = await page.evaluate(()=>new Promise(resolve=>{
    const listen=event=>{const msg=JSON.parse(event.data);if(msg.type==='error'){
      Net.socket.removeEventListener('message',listen);resolve(msg.message);
    }};
    Net.socket.addEventListener('message',listen);
    Net.request('configure_room',{...Net.snapshot.settings,sweepEnvironment:'space'});
  }));
  expect(rejected).toContain('宇宙作战暂时禁用');
  await page.waitForFunction(()=>!Net.awaiting);
  expect(app.rooms.get('PAIR_UI').settings.sweepEnvironment).toBe('ground');
  await select.selectOption('EFSF|ZEON');
  await expect.poll(()=>page.evaluate(()=>[Net.snapshot.settings.sweepFaction,Net.snapshot.settings.sweepAlliedFaction])).toEqual(['EFSF','ZEON']);
  await expect(page.locator('#sweepFaction option:checked')).toHaveText('地球联邦军[吉翁公国军]');
  expect(errors).toEqual([]);
 }finally{await page.evaluate(()=>Net.leave()).catch(()=>{});await app.close();}
});

test('defense map overlay covers exactly five by five cells',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 const rects=await page.evaluate(()=>{
  const settings={sweepEra:'UC_0079_T1',sweepEnvironment:'ground',sweepFaction:'EFSF',sweepDifficulty:6};
  const forces=ContractForces.draw(settings,Rules,()=>.99,350,3);
  if(!forces.length || forces[0].models.length!==3)throw Error('Offline HTML force pool missing');
  const objective={type:'defend',id:'coverage-test',x:10,y:8,status:'available',targets:[],progress:0,required:5};
  const map=ContractMode.generateMap(Rules.catalog,{sweepDifficulty:1,sweepEnvironment:'ground'},123);
  ContractUI.receive({started:true,phase:'idle',matchId:'coverage',you:{seat:0},settings:{mode:'sweep'},
   game:{...map,mapId:map.id,winner:null,units:[]},
   contract:{objectives:[objective],cues:[],participants:[],difficulty:ContractMode.config(1),completed:0}});
  const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d'),rects=[];
  ctx.fillRect=(...args)=>rects.push(args);
  ContractUI.drawCoverage(ctx,{ox:7,oy:9,tile:20});return rects;
 });
 expect(rects[0]).toEqual([167,129,100,100]);
});
