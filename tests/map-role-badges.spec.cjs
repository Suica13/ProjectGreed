const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390]) test(`map role badges flank HP/EN opposite pilot portraits at ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:900});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  const result=await page.evaluate(async()=>{
    Net.leave();TurnFlow.reset();session++;MapCombat.reset();AttackControls.reset();
    const e={unitId:'RGM_79',kitId:'machine_gun'};
    game=Rules.create(false,73,[[e],[e]],false,{costLimit:99999,unitCostLimit:99999});
    game.tiles.forEach(row=>row.fill('plain'));game.fogMode='disabled';
    Object.assign(game.units[0],{x:8,y:8});Object.assign(game.units[1],{x:11,y:8});
    game.units[0].pilot={...game.units[0].pilot,custom:true,name:'PMC Test'};
    selected=game.units[0].id;phase='idle';mode='select';weaponId=pending=battleView=moving=null;
    setPageView('game');update();MapCamera.focus(9,8);
    await SpriteRenderer.ensureModels(game.units.map(u=>u.model));
    cancelAnimationFrame(animationFrameId);animationFrameId=null;
    const records=[],original=UnitIdentity.drawStatusBadges;
    UnitIdentity.drawStatusBadges=function(ctx,u,m,x,y,w,size,portrait){
      const images=[],fills=[],draw=ctx.drawImage,fill=ctx.fillRect;
      ctx.drawImage=function(source,...args){images.push(args);return draw.call(this,source,...args)};
      ctx.fillRect=function(...args){fills.push(args);return fill.apply(this,args)};
      try{original(ctx,u,m,x,y,w,size,portrait)}finally{ctx.drawImage=draw;ctx.fillRect=fill}
      records.push({id:u.id,role:m.combatRole,x,y,w,size,portrait,images,fills});
    };
    const states=[];
    try{
      MapCamera.setPercent(75);drawMap(performance.now());states.push(records.splice(0));
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
      const colors=[];
      for(const role of ['general','support','raid','normal']){
        ctx.clearRect(0,0,300,150);
        original(ctx,game.units[0],{combatRole:role},40,20,100,20,true);
        colors.push([...ctx.getImageData(147,18,1,1).data]);
      }
      let withoutPilot=0;
      const draw=ctx.drawImage;
      ctx.drawImage=function(...args){withoutPilot++;return draw.apply(this,args)};
      original(ctx,{...game.units[0],pilot:null},{combatRole:"general"},40,20,100,20,false);
      ctx.drawImage=draw;
      const counter=document.createElement("div"), member={...game.units[0],en:420};
      AttackControls.memberCard(counter,member,game.units[1],[],{isCounter:true});
      const counterHeader=counter.querySelector("header").textContent;
      MapCamera.setPercent(25);drawMap(performance.now());
      const hidden=records.splice(0);
      MapCamera.setPercent(0);drawMap(performance.now());states.push(records.splice(0));
      return {states,colors,hidden,withoutPilot,counterHeader};
    }finally{UnitIdentity.drawStatusBadges=original}
  });
  for(const state of result.states){
    expect(state.length).toBeGreaterThan(0);
    const own=state.find(r=>r.id==='0-0');expect(own).toBeTruthy();
    expect(own.portrait).toBe(true);
    expect(own.images[0][0]).toBeCloseTo(own.x+own.w+3);
    expect(own.fills[0][0]).toBeCloseTo(own.x-own.size-3);
    expect(own.images[0][1]).toBeCloseTo(own.fills[0][1]);
    expect(own.images[0][2]).toBeCloseTo(own.fills[0][2]);
  }
  expect(result.hidden.length).toBeGreaterThan(0);
  expect(result.hidden.every(r=>r.images.length === 1 && !r.fills.length)).toBe(true);
  expect(result.withoutPilot).toBe(1);
  expect(result.counterHeader.match(/EN/g)).toHaveLength(1);
  expect(result.counterHeader).not.toContain("EN 0/420");
  expect(new Set(result.colors.map(c=>c.join(','))).size).toBe(4);
  await page.screenshot({path:`tmp/verification/screenshots/map-role-badges-${width}.png`});
  expect(errors).toEqual([]);
});
