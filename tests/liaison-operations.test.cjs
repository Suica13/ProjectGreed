const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const G=require('../shared/rules'),M=require('../shared/mission-mode'),C=require('../shared/contact-tasks'),P=require('../shared/pilots');
const ids=['efsf-13','efsf-15','efsf-16','zeon-12','zeon-14','zeon-18','zeon-22','zeon-25'];
function fixture(id){const task=C.byId.get(id),settings=M.settings(G,task.missionId),host={id:'host',seat:0,contactTasks:[{id,status:'accepted',progressVersion:task.progressVersion}],ws:{readyState:1}},map=G.getMap(task.missionId);
 const game=G.create(false,33,Array.from({length:10},(_,i)=>i===0?[{unitId:map.environment==='space'?'ColumbusClass':'Medea',kitId:'standard'}]:null),false,settings);
 const room={game,settings,seats:[host,{id:'enemy',seat:1,bot:true}],members:new Map([['host',host]]),hostId:'host',started:true,phase:'idle',missionAllySeat:10};M.initialize(room,G);game.units[0].deployed=true;delete game.units[0].deploymentStaged;game.winner=null;return {room,host,map};}
for(const id of ids)test(id+' gates entry, initializes native actors, spawns reinforcements and awards only task progress',()=>{
 const {room,host,map}=fixture(id);assert(!M.commissions.unlocked(map,[]));assert(M.commissions.unlocked(map,host.contactTasks));
 assert(map.mission.events.some(e=>e.actions.some(a=>a.type==='dialogue')));
 assert(room.game.units.some(u=>u.missionAutonomous));
 for(const e of map.mission.events)for(const a of e.actions)if(a.type==='spawn')M.spawn(room,G,a.actors);
 const n=room.game.units.length;for(const e of map.mission.events)for(const a of e.actions)if(a.type==='spawn')M.spawn(room,G,a.actors);assert.equal(room.game.units.length,n);
 const state=room.game.mission.commission,c=map.mission.commission;
 state.visited=(c.nodes||[]).map(n=>n.id);for(const u of room.game.units)if(u.missionGroup==='targets')u.hp=0;
 const player=room.game.units[0];if(c.extraction)Object.assign(player,{x:c.extraction.x+2,y:c.extraction.y+2});
 assert(M.commissions.progress(room,G).complete,id);M.commissions.poll(room,G);assert.equal(room.game.mission.requestedWinner,0);
 room.game.winner=0;assert.deepEqual(M.reward(room,G),{money:0,supplies:0,inventory:{}});assert.equal(M.technologyReward(room,G),0);assert.equal(M.commissions.commissionProgress(room,G,host)[0].id,id);
});
test('snow maps retain intact houses, fixed northern weather and sixteen turrets',()=>{
 const city=G.getMap('mission_efsf_13'),plain=G.getMap('mission_efsf_16');
 assert(city.tiles.flat().filter(t=>t==='residential').length>500);assert(city.tiles.flat().filter(t=>t==='rubble').length<30);
 assert.equal(city.climate.hemisphere,'north');assert.equal(city.climate.weather.allowed[0],'snow');assert.equal(plain.climate.weather.allowed[0],'blizzard');assert.equal(plain.mission.commission.nodes.length,5);assert.equal(plain.mission.actors.filter(a=>a.stationary).length,16);
});
test('Zeon has fourteen later tasks and five stages without dependency cycles',()=>{
 const line=C.tasks.filter(t=>t.contactId==='zeon');assert.equal(line.filter(t=>t.number>=12).length,14);assert.equal(line.filter(t=>t.missionId).length,5);
 const visited=new Set();function visit(t,stack=new Set()){assert(!stack.has(t.id));if(visited.has(t.id))return;stack.add(t.id);for(const id of t.requires)visit(C.byId.get(id),new Set(stack));visited.add(t.id);}line.forEach(t=>visit(t));
 for(const t of line.filter(t=>t.number>=12&&!t.missionId))assert(t.difficulty>=5&&t.difficulty<=10);
});
test('level twelve permits 225 while level eleven remains capped at 200',()=>{assert.equal(P.statCap(11),200);assert.equal(P.statCap(12),225);const p=P.custom({...P.createCustom('custom-cap-test','测试'),reincarnations:4,level:12,stats:{...P.baseStats(),shooting:225}});assert.equal(p.stats.shooting,225);assert.throws(()=>P.custom({...p,stats:{...p.stats,shooting:226}}));});
test('armor variants keep only their designated backpack and alias old kits',()=>{for(const [id,w,tex] of [['RX_81ST','EF_RX_81_GG','RX_81_GG_1.png'],['RX_81LA','EF_RX_81_MS','RX_81_MS_1.png'],['RX_81AS','Common_Cannon','RX_81_CN_1.png']]){const p=G.catalog.prefabs.find(p=>p.id===id);assert.equal(p.weaponKits.length,1);assert(p.weaponKits[0].weapons.includes(w));assert.deepEqual(p.layers.filter(l=>/^RX_81_(GG|MS|CN)_/.test(l.texture)).map(l=>l.texture),[tex]);}});
test('airborne units join ground squads and can board an SFS inside a ship',()=>{
 const e={unitId:'RGM_79',kitId:'machine_gun'},g=G.create(false,4,[[e,e,e],[e]],false,{costLimit:99999,unitCostLimit:99999});g.tiles.forEach(r=>r.fill('plain'));
 const [u,sfs,ship]=g.units.filter(u=>u.team===0);Object.assign(u,{x:5,y:5,flying:true});Object.assign(sfs,{x:6,y:5});Object.assign(ship,{x:15,y:15});
 assert.equal(G.reachable(g,u).get('6,5')?.squadTarget,sfs.id);
 delete u.flying;sfs.model=Object.keys(G.models).find(id=>id.startsWith('DodaiYS__'));ship.model=Object.keys(G.models).find(id=>id.startsWith('PegasusClass__'));const sh=G.hangars.of(ship)[0],sf=G.hangars.of(sfs)[0];
 sfs.embarked={carrierId:ship.id,hangarId:sh.id};G.hangars.sync(g);const edge=G.cells(ship)[0];Object.assign(u,{x:edge.x-1,y:edge.y});
 assert(G.hangars.canEmbark(g,u,sfs,sf.id));G.hangars.embark(g,u,sfs,sf.id);assert.equal(u.embarked.carrierId,sfs.id);assert.equal(u.embarked.exposed,false);assert(u.acted);assert.equal(G.hangars.canLoad(g,ship,sfs,sf.id),false);
});

test('task initial units and rewards persist in the depot and borrowed units cannot be discarded',()=>{
 const codec=require('../shared/save-codec'),store=new Map(),ctx=vm.createContext({require:require('node:module').createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,ART:G.catalog,localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v),removeItem:k=>store.delete(k)}});
 vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),ctx);const E=ctx.module.exports;E.meetLiaison('zeon');
 for(const id of ['zeon-1','zeon-2','zeon-3','zeon-4']){const t=C.byId.get(id);E.acceptContactTask(id);E.creditAward({id,matchId:id,money:0,supplies:0,contactProgress:[{id,amount:t.required}]});E.completeContactTask(id);}
 const before=E.snapshot();E.acceptContactTask('zeon-5');const after=E.snapshot();assert.equal(after.storage.units.length,before.storage.units.length);assert.equal(after.storage.deliveries.length,before.storage.deliveries.length+1);
 const loan=after.storage.deliveries.find(i=>i.contactLoan==='zeon-5');assert(loan);assert(E.isContactLoan(loan));assert(after.storage.deliveries.some(i=>i.unitId==='MS_06F'&&!i.contactLoan));
 const saved=codec.parse(store.get('projectgreed.economy.v1'));assert(saved.storage.deliveries.some(i=>i.contactLoan==='zeon-5'));
});
