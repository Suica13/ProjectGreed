const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules.js'),{createAttackPlanner}=require('../shared/attack-plans.js');
const entry=id=>{const p=G.catalog.prefabs.find(p=>p.id===id);return {unitId:id,kitId:p.weaponKits[0].id,...(p.requiredPilotId?{customPilot:G.pilots.createAce(p.requiredPilotId)}:{})};};
function world(id='RGM_79',count=1){const g=G.create(false,42,[[entry(id)],Array.from({length:count},()=>entry('RGM_79'))],false,{costLimit:99999,unitCostLimit:99999});g.tiles.forEach(r=>r.fill('plain'));g.fogMode='disabled';g.units.forEach((u,i)=>Object.assign(u,{x:10+i*5,y:10}));return {g,u:g.units[0]};}
test('EXAM upkeep leaves one HP and forcibly ends the system without killing pilot',()=>{
 for(const p of G.catalog.prefabs.filter(p=>!p.formOnly&&p.skills?.some(s=>s.id==='EXAM'))){const {g,u}=world(p.id);const base=u.model;G.useSkill(g,u,'EXAM',u.x,u.y);u.hp=1;G.end(g);assert.equal(u.hp,1,p.id);assert.equal(u.overdrive,undefined);assert.equal(u.model,base);assert.equal(g.winner,null);}
});
test('all native deployment forms transform back, preserve resources and prohibit moving despite pilot bonuses',()=>{
 for(const p of G.catalog.prefabs.filter(p=>!p.formOnly&&p.skills?.some(s=>s.deploymentMode))){
 const {g,u}=world(p.id),base=u.model;u.hp=Math.floor(u.hp*.5);u.en=Math.floor(u.en*.5);const before=[u.hp,u.en];
 assert(G.canUseSkill(g,u,'EnterDeployMode'),p.id);G.useSkill(g,u,'EnterDeployMode',u.x,u.y);assert(G.modelOf(u).deployed,p.id);assert.deepEqual([u.hp,u.en],before);assert.equal(G.modelOf(u,g).move,0);G.end(g);G.end(g);assert.equal([...G.reachable(g,u).values()].filter(p=>p.path.length).length,0,p.id);assert.throws(()=>G.previewMove(g,u,u.x+1,u.y));assert(G.canUseSkill(g,u,'ExitDeployMode'),p.id);G.useSkill(g,u,'ExitDeployMode',u.x,u.y);assert.equal(u.model,base);}
});
test('hangar maintenance restores destroyed shields and caps partial repair',()=>{
 const {g,u}=world('Medea');const passenger=structuredClone(g.units[1]);passenger.id='cargo';passenger.team=0;passenger.ownerSeat=0;passenger.embarked={carrierId:u.id,hangarId:G.modelOf(u).hangars[0].id};passenger.shield=0;g.units.push(passenger);G.end(g);G.end(g);const max=G.modelOf(passenger).shield.hp;assert(max>0);assert.equal(passenger.shield,Math.round(max*.25));passenger.shield=max-1;G.end(g);G.end(g);assert.equal(passenger.shield,max);
});
test('pilot speed scales movement and AP without affecting evasion, including first turn',()=>{
 const {g,u}=world();for(const speed of [0,1,49,50,51,99,100,149,150,200]){u.pilot={stats:{...G.pilots.baseStats(),speed}};const m=G.modelOf(u),base=G.models[u.model];assert.equal(m.move,Math.max(1,base.move*Math.max(.5,1+(speed-100)*.005)));assert.equal(G.actionBudget(u),Math.round((base.actionPoints||5)*Math.max(.5,1+(speed-100)*.0025)));assert.equal(m.pilotModifiers.reaction,1);G.end(g);G.end(g);assert.equal(u.actionPoints,G.actionBudget(u));}
 const pilot=G.pilots.createCustom('custom-test-ap','AP');const w=G.create(false,42,[[{...entry('RGM_79'),customPilot:pilot}],[entry('RGM_79')]],false,{costLimit:99999,unitCostLimit:99999});assert.equal(w.units[0].actionPoints,5);
});
test('Zaku cannon cross blast hits centre and cardinal neighbours once, excludes diagonals, charges once',()=>{
 const {g,u}=world('MS_06K',6);const positions=[[13,10],[12,10],[14,10],[13,9],[13,11],[14,11]];g.units.slice(1).forEach((v,i)=>Object.assign(v,{x:positions[i][0],y:positions[i][1]}));
 const w=G.modelOf(u).weapons.find(w=>w.id==='Common_Cannon_AntiAir'),room={game:g,plans:[],combats:[]};const planner=createAttackPlanner(G,(()=>{let i=0;return()=>String(++i)})());planner.reset(room);const en=u.en;planner.plan(room,u,g.units[1],w,0);planner.prepare(room);while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');const battles=planner.resolve(room);assert.equal(new Set(battles.map(b=>b.b)).size,5);assert(!battles.some(b=>b.b===g.units[6].id));assert.equal(u.en,en-w.en);
});
test('repeated cross-blast orders retain separate visual launches and pay once each',()=>{
 const {g,u}=world('MS_06K',2);Object.assign(g.units[1],{x:13,y:10});Object.assign(g.units[2],{x:13,y:11});
 const w=G.modelOf(u).weapons.find(w=>w.id==='Common_Cannon_AntiAir'),room={game:g,plans:[],combats:[]};u.actionPoints=10;
 const planner=createAttackPlanner(G,(()=>{let i=0;return()=>String(++i)})());planner.reset(room);const en=u.en;planner.plan(room,u,g.units[1],[w,w],0);planner.prepare(room);while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');const battles=planner.resolve(room);const ids=battles.flatMap(b=>b.events).filter(e=>e.from===u.id).map(e=>e.blastId);assert.equal(new Set(ids).size,2);assert(ids.every(Boolean));assert.equal(u.en,en-w.en*2);
});
test('Zaku cannon counter uses the same cross and one energy payment',()=>{
 const {g,u}=world('MS_06K',3);Object.assign(g.units[1],{x:13,y:10});Object.assign(g.units[2],{x:13,y:11});Object.assign(g.units[3],{x:14,y:11});
 const w=G.modelOf(u).weapons.find(w=>w.id==='Common_Cannon_AntiAir'),en=u.en;
 const events=G.counter(g,u,g.units[1],[w.id]);assert.equal(events.length,2);assert.equal(new Set(events.map(e=>e.blastId)).size,1);assert.equal(u.en,en-w.en);assert(!events.some(e=>e.to===g.units[3].id));
});
