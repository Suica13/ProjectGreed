const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
for(const width of [1440,390])test(`delegation cannot start outside a ready battle at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  const states=await page.evaluate(async()=>{
    const request=Net.request,assets=window.BattleAssets;
    let requests=0;
    Net.request=()=>requests++;
    Net.seat=0;Net.awaiting=null;
    const snapshot={started:true,phase:'assembly',delegatedSeats:[],game:{winner:null,units:[]}};
    Net.snapshot=snapshot;
    const button=byId('campaignDelegationToggle');
    const check=async()=>{CampaignUI.refreshBattleControls();const state={hidden:button.hidden,disabled:button.disabled};button.click();await Promise.resolve();await Promise.resolve();return state;};
    try{
      const route=await check();
      snapshot.phase='deployment';
      const empty=await check();
      snapshot.game.units=[{id:'test',ownerSeat:0,team:0,hp:100}];
      window.BattleAssets={...assets,loading:true};
      const loading=await check();
      const blockedRequests=requests;
      window.BattleAssets={...assets,loading:false};
      const ready=await check();
      snapshot.delegatedSeats=[0];
      snapshot.game.units=[];
      const cancel=await check();
      return {route,empty,loading,ready,cancel,blockedRequests,requests};
    }finally{Net.request=request;window.BattleAssets=assets;}
  });
  expect(states.route).toEqual({hidden:true,disabled:true});
  expect(states.empty.disabled).toBeTruthy();
  expect(states.loading.disabled).toBeTruthy();
  expect(states.blockedRequests).toBe(0);
  expect(states.ready.disabled).toBeFalsy();
  expect(states.cancel.disabled).toBeFalsy();
  expect(states.requests).toBe(2);
});
