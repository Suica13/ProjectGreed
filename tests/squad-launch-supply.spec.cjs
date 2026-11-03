const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
async function open(page){
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await expect(page.locator('#openSkirmish')).toBeEnabled();
}
async function battle(page,transport=false){
 await open(page);
 await page.evaluate(async transport=>{
 Net.leave();session++;const entry={unitId:'RGM_79',kitId:'machine_gun'};
 game=Rules.create(false,1,[[entry,entry,entry,entry],[entry]],false,{fogMode:'disabled'});
 game.tiles.forEach(r=>r.fill('plain'));game.deployment=null;
 const units=game.units.slice(0,4);units.forEach((u,i)=>Object.assign(u,{x:5,y:5,squadId:'A',squadSlot:i,hp:100000,en:10000,actionPoints:10}));
 Object.assign(game.units.at(-1),{x:14,y:12});
 if(transport){const c=units[0];c.model=Object.keys(Rules.models).find(id=>id.startsWith('PegasusClass__'));delete c.squadId;delete c.squadSlot;
 Object.assign(c,{x:8,y:8});units.slice(1).forEach(u=>{delete u.squadId;u.embarked={carrierId:c.id,hangarId:Rules.hangars.of(c)[0].id,boardRound:null};});Rules.hangars.sync(game);}
 else{units.pop();game.units.splice(3,1);const base=units[0];const dest=[0,1].map(i=>({...structuredClone(base),id:'destination-'+i,x:6,y:5,squadId:'B',squadSlot:i,moved:true,acted:true,actionPoints:0}));game.units.push(...dest);}
 phase='idle';pending=moving=battleView=null;selected=units[0].id;mode='select';squadSingleMove=false;squadCombatMode='melee';
 await SpriteRenderer.ensureModels(game.units.map(u=>u.model));setPageView('game');update();
 },transport);
}
test('member avatar -> move -> occupied squad cell -> confirm joins without selecting destination',async({page})=>{
 await battle(page);
 await page.locator('[data-squad-member="0-0"]').click();
 await page.locator('[data-unit-command="move"]').click();
 await page.evaluate(()=>{MapCamera.focus(6,5);drawMap(performance.now());});
 const point=await page.evaluate(()=>{const p=mapPosition(6,5),c=byId('map'),r=c.getBoundingClientRect();return{x:p.x*r.width/c.width,y:p.y*r.height/c.height};});
 await page.locator('#map').click({position:point,force:true});
 await expect(page.locator('#hudConfirmMove')).toBeEnabled();
 await page.locator('#hudConfirmMove').click();
 const result=await page.evaluate(()=>({selected,count:Rules.squadMembers(game,getUnit('0-0')).length,remaining:Rules.squadMembers(game,getUnit('0-1')).length}));
 expect(result).toEqual({selected:'0-0',count:3,remaining:2});
});
test('cargo portraits select three and launch, cancel and confirm through normal controls',async({page})=>{
 await battle(page,true);
 await page.evaluate(()=>HangarUI.open(game.units[0]));
 const portraits=page.locator('#hangarDialog [data-cargo-id] > img[role="button"]');
 await expect(portraits).toHaveCount(3);
 for(let i=0;i<3;i++)await portraits.nth(i).click();
 await expect(page.locator('#hangarDialog .hangar-unit.is-selected')).toHaveCount(3);
 await page.getByRole('button',{name:'小队出击',exact:true}).click();
 const point=await page.evaluate(()=>{const u=game.units[1],cell=Rules.hangars.launchCells(game,u)[0];return cell;});
 await page.evaluate(point=>HangarUI.click(point),point);
 await expect(page.locator('#hudConfirmMove')).toBeEnabled();
 expect(await page.evaluate(()=>game.units.slice(1,4).every(u=>!!u.embarked&&!!u.pendingMove))).toBe(true);
 await page.locator('#hudCancelAction').click();
 await expect(page.locator('#hangarDialog')).toBeVisible();
 expect(await page.evaluate(()=>game.units.slice(1,4).every(u=>u.embarked&&!u.pendingMove))).toBe(true);
 await page.getByRole('button',{name:'小队出击',exact:true}).click();
 await page.evaluate(point=>HangarUI.click(point),point);
 await expect(page.locator('#hudConfirmMove')).toBeEnabled();
 await page.locator('#hudConfirmMove').click();
 expect(await page.evaluate(()=>Rules.squadMembers(game,game.units[1]).length)).toBe(3);
 expect(await page.evaluate(()=>game.units.slice(1,4).every(u=>!u.embarked&&!u.pendingMove))).toBe(true);
});
test('formation boarding button opens compatible carriers and persists assignment',async({page})=>{
 await open(page);
 await page.evaluate(()=>{
 const entry=id=>{const m=Object.values(UnitModels).find(m=>m.prefabId===id&&!m.formOnly);return{unitId:id,kitId:m.kitId};};
 localStorage.setItem('slg-formations-v1.EFSF',JSON.stringify({version:3,squads:[{name:'Boarding',units:[entry('Medea'),entry('RGM_79')]}]}));
 });
 await page.reload();await page.evaluate(()=>Formation.open());
 await page.locator('[data-board-formation="1"]').click();
 const panel=page.locator('#formationBoardingDialog');await expect(panel).toBeVisible();
 await panel.locator('[data-carrier-choice]:not([data-carrier-choice=""])').first().click();
 await panel.getByRole('button',{name:'搭乘',exact:true}).click();
 await expect(panel).toBeHidden();
 expect(await page.evaluate(()=>Formation.current()[1].preload?.carrierIndex)).toBe(0);
 await page.locator('[data-board-formation="1"]').click();
 await panel.getByRole('button',{name:'关闭',exact:true}).click();await expect(panel).toBeHidden();
});
test('command changes reuse roster DOM and expose bounded startup timings',async({page})=>{
 await battle(page);
 const result=await page.evaluate(()=>{
 const first=byId('allies').firstElementChild;
 let times=[];for(const next of ['move','select','attack-target','select']){const t=performance.now();mode=next;update();drawMap(performance.now());times.push(performance.now()-t);}
 return{same:first===byId('allies').firstElementChild,times};
 });
 expect(result.same).toBe(true);
 console.log('Command startup milliseconds:',result.times.map(n=>n.toFixed(1)).join(', '));
});

test('dodge/rest and final playback keep facing and the last weapon display',async({page})=>{
 await battle(page);
 const result=await page.evaluate(async()=>{
 const a=game.units[0],b=game.units.find(u=>u.team!==a.team);
 a.model=Object.keys(Rules.models).find(id=>id==='MS_06F__machine_gun');
 Object.assign(a,{x:5,y:5,angle:0,en:100000,squadId:undefined});
 Object.assign(b,{x:6,y:5,angle:0,en:100000,hp:100000});game.units=[a,b];
 await SpriteRenderer.ensureModels([a.model,b.model]);
 const room={game,matchId:'visual-state'};let sequence=0;const planner=createAttackPlanner(Rules,()=>String(++sequence));planner.reset(room);
 planner.plan(room,a,b,null,0);planner.prepare(room);planner.choose(room,room.pending.id,'evade',[],a.id);
 const battles=planner.resolve(room),lastWeapon=Rules.modelOf(a).weapons.find(w=>w.id===a.heldWeapon);
 MapCombat.reset();MapCombat.seed(battles);
 battleView={a:a.id,b:b.id,battles,actors:battles.flatMap(b=>b.actors),events:battles.flatMap(b=>b.events),index:0,completed:false,start:performance.now(),displayHp:{[a.id]:a.hp,[b.id]:b.hp}};
 phase='battle';MapCombat.begin(battleView,()=>0);
 const finish=CombatPlayback.finish;let complete=false;CombatPlayback.finish=()=>{complete=true;};
 let start=performance.now(),badFacings=[];
 try{for(let i=0;i<1600&&!complete;i++){
 MapCombat.update(start+i*50);const pose=MapCombat.units().find(u=>u.id===b.id)?.mapPose;
 if(pose&&!pose.dying&&((pose.angle%360)+360)%360!==270)badFacings.push(pose.angle);
 }}finally{CombatPlayback.finish=finish;}
 const pose=MapCombat.units().find(u=>u.id===a.id)?.mapPose,visual=MapCombat.units().find(u=>u.id===a.id);
 return{complete,badFacings,index:pose?.weaponDisplayIndex??visual.weaponDisplayIndex,expected:lastWeapon.attack.displayStates?.at(-1)?.index??lastWeapon.displayIndex??0,angle:b.angle};
 });
 expect(result.complete).toBe(true);expect(result.badFacings).toEqual([]);expect(result.index).toBe(result.expected);expect(result.angle).toBe(-90);
});
