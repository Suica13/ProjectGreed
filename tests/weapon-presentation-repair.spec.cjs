const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('scatter bazooka kits retain their physical launcher in idle and firing poses',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 const results=await page.evaluate(async()=>{
  const rows=[];
  for(const [modelId,model] of Object.entries(UnitModels))for(const w of model.weapons){
   if(!w.projectile?.cluster)continue;
   await SpriteRenderer.ensureModels([modelId]);
   const states=[null,w.clip].map(clip=>SpriteRenderer.visibleLayers(modelId,w.id,true,false,clip,.4)
    .filter(l=>l.name===w.id||l.name.startsWith(w.id+'_')).map(l=>l.name));
   rows.push({model:modelId,name:model.kitName,weapon:w.name,states});
  }
  return rows;
 });
 expect(results.length).toBeGreaterThan(5);
 for(const row of results){expect(row.states[0],row.model+' idle').not.toHaveLength(0);expect(row.states[1],row.model+' firing').not.toHaveLength(0);}
});
for(const primaryHp of [1000000,1])test(`mortar damage is displayed at each shell impact (selected HP ${primaryHp})`,async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 const result=await page.evaluate(async(primaryHp)=>{
  Net.leave();session++;
  const model=Object.values(UnitModels).find(m=>m.prefabId==='RGC_80'&&m.weapons.some(w=>w.category==='mortar'));
  const enemy={unitId:'Type61',kitId:'standard'};
  game=Rules.create(false,1,[[{unitId:model.prefabId,kitId:model.kitId}],[enemy,enemy,enemy]],false,{fogMode:'disabled'});
  game.tiles.forEach(row=>row.fill('plain'));game.deployment=null;
  const[a,primary,b]=game.units;Object.assign(a,{x:5,y:5,en:10000});
  game.units.slice(1).forEach((u,i)=>Object.assign(u,{x:8,y:5,hp:1000000,shield:0,squadId:'mortar-cell',squadSlot:i}));
  primary.hp=primaryHp;
  const room={game,plans:[],planSequence:0,responses:[],reactions:[],emptyImpacts:[]},planner=createAttackPlanner(Rules,()=>Math.random().toString());
  const weapon=Rules.modelOf(a).weapons.find(w=>w.category==='mortar');planner.plan(room,a,primary,weapon,0);
  planner.prepare(room);
  while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');
  const battles=planner.resolve(room);
  await SpriteRenderer.ensureModels(game.units.map(u=>u.model));
  MapCombat.reset();MapCombat.seed(battles);battleView={battles,index:0,completed:false};
  pending=moving=null;phase='battle';setPageView('game');MapCombat.begin(battleView,()=>0);
  const event=battles.flatMap(b=>b.events).find(e=>e.to===b.id),actor=battles[0].actors.find(u=>u.id===a.id);
  const source={unit:actor,x:880,y:880,scale:1},target={unit:b,x:1360,y:880,scale:1};
  const visual=WeaponEffects.plan(Rules.eventWeapon(actor,event),source,target,event);
  const start=performance.now(),rate=MovementTiming.combatRate(false,false);MapCombat.update(start);
  const samples=[],visibleSalvos=[];
  for(const timing of event.shotTimings){
   MapCombat.update(start+(timing.impactAt+.01)*1000/rate);
   samples.push(MapCombat.units().filter(u=>u.team===1).sort((x,y)=>Number(y.id===b.id)-Number(x.id===b.id)).map(u=>u.hp));
   visibleSalvos.push(...MapCombat.frames.filter(frame=>!frame.event.nuclearFollowup).map(frame=>frame.plan.shots.length));
  }
  return {before:event.before,after:event.after,samples,visibleSalvos,contacts:visual.contacts.map(c=>({hit:c.hit,at:c.at,damage:c.damage})),times:event.shotTimings};
 },primaryHp);
 expect(result.contacts.filter(c=>c.hit).length).toBeGreaterThan(1);
 expect(result.samples[0]).toHaveLength(3);
 for(const hp of result.samples[0])expect(hp).toBeLessThan(result.before);
 expect(result.samples[0][0]).toBeGreaterThan(result.after);
 expect(result.samples.at(-1)[0]).toBe(result.after);
 expect(Math.max(...result.visibleSalvos)).toBe(result.times.length);
 for(let i=0;i<result.contacts.length;i++)expect(result.contacts[i].at).toBeCloseTo(result.times[i].impactAt,5);
});
test('the SFS squad attack editor includes the exposed passengers',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
 const result=await page.evaluate(async()=>{
  Net.leave();session++;TurnFlow.reset();MapCombat.reset();AttackControls.reset();
  const ms={unitId:'RGM_79',kitId:'machine_gun'};
  const sfs=Object.values(UnitModels).find(m=>m.prefabId==='DodaiYS');
  const carrier={unitId:sfs.prefabId,kitId:sfs.kitId};
  game=Rules.create(false,1,[[carrier,carrier,ms,ms],[ms]],false,{fogMode:'disabled'});
  game.tiles.forEach(row=>row.fill('plain'));game.deployment=null;
  const[a,b,p,q,enemy]=game.units;
  Object.assign(a,{x:5,y:5});Object.assign(b,{x:6,y:5});Object.assign(p,{x:5,y:6});Object.assign(q,{x:6,y:6});Object.assign(enemy,{x:7,y:5});
  Rules.hangars.embark(game,p,a,Rules.hangars.of(a)[0].id);Rules.hangars.embark(game,q,b,Rules.hangars.of(b)[0].id);
  Rules.end(game);Rules.end(game);Rules.move(game,b,a.x,a.y);
  await SpriteRenderer.ensureModels(game.units.map(u=>u.model));
  selected=a.id;squadSingleMove=false;mode='select';pending=moving=battleView=null;phase='idle';setPageView('game');update();
  AttackControls.choose(a,enemy);update();
  return {members:Rules.squadAttackMembers(game,a).map(u=>u.id),cards:[...document.querySelectorAll('.hud-attack-planned [data-attack-member]')].map(el=>el.dataset.attackMember)};
 });
 expect(new Set(result.cards)).toEqual(new Set(result.members));
 expect(result.cards).toHaveLength(4);
 await expect(page.locator('#confirmAttackQueue')).toBeEnabled();
});
