const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

for(const width of [1440,390]) test(`encounter AI toggle and presentation rates at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await expect(page.locator('#openSkirmish')).toBeEnabled();
  await page.evaluate(()=>{
    const factory=createRoomEngine;
    createRoomEngine=options=>(window.testEngine=factory(options));
  });
  await page.locator('#openSkirmish').click();
  await page.locator('#createOfflineRoom').click();
  await expect.poll(()=>page.evaluate(()=>Net.awaiting)).toBe(null);
  await page.evaluate(()=>{
    const room=[...testEngine.rooms.values()][0];
    const entry={unitId:'Type61',kitId:'standard'};
    room.game=Rules.create(false,1,[[entry],[entry]],false,room.settings);
    room.started=true;room.phase='idle';room.matchId='presentation-test';
    room.activeSeats=[true,true];room.turnDone=[false,false];
    room.turnNotBefore=Date.now()+60000;
    room.revision++;testEngine.broadcast(room);
  });
  const toggle=page.locator('#campaignDelegationToggle'),speed=page.locator('#battlePresentationSpeed');
  await expect(toggle).toBeVisible();await expect(toggle).toBeEnabled();
  await expect(speed).toHaveText('演出速度 ×1.5');
  expect(await toggle.evaluate(el=>el.nextElementSibling.id)).toBe('battlePresentationSpeed');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed','true');
  expect(await page.evaluate(()=>Net.canAct())).toBe(false);
  expect(await page.evaluate(()=>Net.snapshot.members.find(m=>m.seat===0).bot)).toBeFalsy();
  await expect(toggle).toBeEnabled();await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed','false');
  expect(await page.evaluate(()=>Net.canAct())).toBe(true);
  for(const value of [2,2.5,3,0.5,1,1.5]) {
    await speed.click();await expect(speed).toHaveText(`演出速度 ×${value.toFixed(1)}`);
    expect(await page.evaluate(()=>MovementTiming.presentationSpeed)).toBe(value);
  }
  const continuity=await page.evaluate(async()=>{
    const unit=game.units[0];
    PlanningUI.move({unitId:unit.id,from:{x:unit.x,y:unit.y},path:Array(20).fill({x:unit.x+1,y:unit.y})});
    const now=performance.now(),move=PlanningUI.motion(unit,now);
    const step=move.step;
    byId('battlePresentationSpeed').click();
    await Promise.resolve();await Promise.resolve();
    return {step,newStep:move.step,progress:(performance.now()-move.start)/move.step};
  });
  expect(continuity.newStep/continuity.step).toBeCloseTo(1.5/2,5);
  expect(continuity.progress).toBeLessThan(2);
  await page.screenshot({path:`tmp/verification/screenshots/battle-delegation-${width}.png`});
  expect(errors).toEqual([]);
});
