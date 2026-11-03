const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../shared/rules'), Auto = require('../shared/automatic-fire'), Classes = require('../shared/weapon-classes');
const {createAttackPlanner} = require('../shared/attack-plans');
const entry = {unitId:'RGM_79',kitId:'machine_gun'};
function fixture() {
 const game = G.create(false,19,[[entry,entry,entry,entry],[entry]],false,{fogMode:'disabled'});
 game.tiles.forEach(row=>row.fill('plain'));
 const carrier=game.units[0];carrier.model=Object.keys(G.models).find(id=>id.startsWith('PegasusClass__'));
 Object.assign(carrier,{x:10,y:10,hp:G.modelOf(carrier).hp,en:G.modelOf(carrier).en});
 const cargo=game.units.slice(1,4);
 cargo.forEach(u=>{u.embarked={carrierId:carrier.id,hangarId:G.hangars.of(carrier)[0].id,boardRound:null};u.actionPoints=10;});
 Object.assign(game.units.at(-1),{x:20,y:15});G.hangars.sync(game);
 return {game,carrier,cargo};
}
test('Panzerfaust templates retain their own class with AP-budgeted uses',()=>{
 let count=0;for(const w of Object.values(require('../assets/weapons.json').definitions))
 if(/Panzerfaust/i.test(w.sourceName||'')){assert.equal(Classes.classify(w),'panzerfaust');assert.equal(typeof Auto.plan,'function');count++;}
 assert.ok(count>=8);
});
test('three cargo launch together only after confirmation, keeping each own AP and no early sight',()=>{
 const {game,cargo}=fixture(), point=G.hangars.launchCells(game,cargo[0])[0];
 const before=cargo.map(u=>[u.x,u.y,u.hp,u.en]);
 const event=G.hangars.previewLaunchSquad(game,cargo,point.x,point.y);
 assert.deepEqual(event.squadIds,cargo.map(u=>u.id));
 assert.deepEqual(cargo.map(u=>[u.x,u.y,u.hp,u.en]),before);
 assert.ok(cargo.every(u=>u.embarked));
 assert.equal(cargo[1].pendingMove.launchMemberOf,cargo[0].id);
 G.confirmMove(game,cargo[0]);
 assert.ok(cargo.every(u=>!u.embarked&&!u.pendingMove&&u.moved&&u.actionPoints===10));
 assert.equal(G.squadMembers(game,cargo[0]).length,3);
});
test('cancelling a multi launch clears every preview without spending EN or AP',()=>{
 const {game,cargo}=fixture(),point=G.hangars.launchCells(game,cargo[0])[0],before=JSON.stringify(game.units);
 G.hangars.previewLaunchSquad(game,cargo,point.x,point.y);G.cancelMove(game,cargo[0]);
 assert.equal(JSON.stringify(game.units),before);
});
test('multi launch rejects mixed controllers and capacity changes without partial launch',()=>{
 const {game,cargo}=fixture(),point=G.hangars.launchCells(game,cargo[0])[0];
 cargo[2].ownerSeat=2;const before=JSON.stringify(game.units);
 assert.throws(()=>G.hangars.previewLaunchSquad(game,cargo,point.x,point.y));assert.equal(JSON.stringify(game.units),before);
 cargo[2].ownerSeat=0;
 G.hangars.previewLaunchSquad(game,cargo,point.x,point.y);
 const root=cargo[0],newcomers=[0,1].map(i=>({...structuredClone(cargo[0]),id:'new-'+i,x:point.x,y:point.y,embarked:undefined,pendingMove:undefined,squadId:'new',squadSlot:i}));
 game.units.push(...newcomers);
 assert.throws(()=>G.confirmMove(game,root));assert.ok(cargo.every(u=>u.embarked&&u.pendingMove));
 G.cancelMove(game,root);assert.ok(cargo.every(u=>!u.pendingMove));
});
test('a selected member can join a finished squad without restoring any action state',()=>{
 const {game,cargo}=fixture();cargo.forEach(u=>{delete u.embarked;Object.assign(u,{x:5,y:5,squadId:'old',squadSlot:0});});
 const source=cargo[0],dest=cargo.slice(1);dest.forEach((u,i)=>Object.assign(u,{x:6,y:5,squadId:'dest',squadSlot:i,moved:true,acted:true,actionPoints:0}));
 G.previewMove(game,source,6,5,0,true);G.confirmMove(game,source);
 assert.equal(G.squadMembers(game,source).length,3);assert.ok(dest.every(u=>u.acted&&u.moved&&u.actionPoints===0));
});
test('AI deployment loads compatible troops and groups remaining same-model units',()=>{
 for(const transport of [false,true]){
 const army=Array.from({length:6},()=>entry);
 if(transport){const m=Object.values(G.models).find(m=>m.prefabId==='Medea');army.unshift({unitId:m.prefabId,kitId:m.kitId});}
 const game=G.create(false,3,[army,[entry]],true,{fogMode:'disabled'});
 G.aiDeployment(game,0);
 if(transport)assert.ok(game.units.some(u=>u.embarked));
 else assert.ok(game.units.some(u=>G.squadMembers(game,u).length===3));
 assert.doesNotThrow(()=>G.confirmDeployment(game,0));
 }
});
test('resupply restores every ally in one cell, costs 10 percent EN and respects once per turn',()=>{
 const {game,carrier,cargo}=fixture();carrier.model=Object.keys(G.models).find(id=>id.startsWith('Medea__'));
 Object.assign(carrier,{x:10,y:10,en:G.modelOf(carrier).en,actionPoints:10});
 cargo.forEach(u=>{delete u.embarked;Object.assign(u,{x:9,y:10,en:0,squadId:'supply',squadSlot:0});});
 const before=carrier.en;
 const event=G.useSkill(game,carrier,'adjacent_en_supply',9,10);
 assert.equal(carrier.en,before*.9);assert.equal(carrier.actionPoints,10);
 assert.equal(event.targets.length,3);
 cargo.forEach(u=>assert.equal(u.en,G.modelOf(u).en*.5));
 assert.throws(()=>G.useSkill(game,carrier,'adjacent_en_supply',9,10));
});
test('all mortars use normal weapon slots, can counter and hit just one cell',()=>{
 let n=0;for(const m of Object.values(G.models))for(const w of m.weapons)if(Classes.classify(w)==='mortar'){
 assert.notEqual(w.slot,'skill',m.id+'/'+w.id);assert.equal(w.noCounter,false);
 assert.equal(w.special.type,'blast');assert.equal(w.special.radius,0);n++;
 }
 assert.ok(n>20);
 const {game,cargo}=fixture(),m=Object.values(G.models).find(m=>m.weapons.some(w=>Classes.classify(w)==='mortar'));
 const w=structuredClone(m.weapons.find(w=>Classes.classify(w)==='mortar'));
 w.min=1;w.max=10;w.requiredParts=[];w.hit=10000;w.pilotRequirements=[];
 w.attack.strikes=w.attack.strikes.map(s=>({...s,requiredParts:[],firingArc:undefined,moduleId:undefined,accuracy:10000}));
 G.models.cell_mortar={...G.modelOf(cargo[0]),weapons:[w]};
 const a=cargo[0];delete a.embarked;Object.assign(a,{model:'cell_mortar',x:5,y:5,en:100000,hp:100000});
 const b=game.units.at(-1);Object.assign(b,{x:7,y:5,hp:100000,shield:0});
 const same={...structuredClone(b),id:'same',squadId:'enemy',squadSlot:1};b.squadId='enemy';b.squadSlot=0;
 const adjacent={...structuredClone(b),id:'adjacent',x:8,squadId:undefined};game.units=[a,b,same,adjacent];
 const room={game,matchId:'mortar'};let i=0;const planner=createAttackPlanner(G,()=>String(++i));planner.reset(room);
 planner.plan(room,a,b,null,0);const [request]=planner.prepare(room);planner.choose(room,request.id,'defend',[],a.id);
 const events=planner.resolve(room).flatMap(b=>b.events);
 assert.ok(events.some(e=>e.to===b.id));assert.ok(events.some(e=>e.to===same.id));assert.ok(!events.some(e=>e.to===adjacent.id));
 assert.equal(a.weaponCooldowns?.[w.id],undefined);delete G.models.cell_mortar;
});
test('combat retains authoritative final facing and weapon display after dodging',()=>{
 const {game,cargo}=fixture();const a=cargo[0];delete a.embarked;
 Object.assign(a,{x:5,y:5,angle:0,en:100000});const b=game.units.at(-1);Object.assign(b,{x:6,y:5,angle:0,hp:100000,shield:0});
 game.units=[a,b];const room={game,matchId:'facing'};let i=0;const planner=createAttackPlanner(G,()=>String(++i));planner.reset(room);
 planner.plan(room,a,b,null,0);const [request]=planner.prepare(room);planner.choose(room,request.id,'evade',[],a.id);planner.resolve(room);
 assert.equal(a.angle,90);assert.equal(b.angle,-90);
 const last=G.modelOf(a).weapons.find(w=>w.id===a.heldWeapon);
 assert.equal(a.weaponDisplayIndex,last.attack.displayStates?.at(-1)?.index??last.displayIndex??0);
});
