const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const G=require('../shared/rules'),codec=require('../shared/save-codec'),Warehouse=require('../shared/warehouse');
function load(saved){
 const key='projectgreed.economy.v1',data=new Map(saved?[[key,codec.stringify(saved)]]:[]);let fail=false;
 const context=vm.createContext({require:require('node:module').createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,ART:G.catalog,
  localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(fail)throw Error('write failed');data.set(k,v);},removeItem:k=>data.delete(k)}});
 vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),context);return {E:context.module.exports,fail:()=>fail=true};
}
const gift=(extra={})=>({id:'gift',matchId:'activity',money:0,supplies:0,rentals:[{unitId:'RGM_79',count:2,uses:2,plugins:['frame']}],...extra});
const result=(match,id,extra={})=>({id:match,matchId:match,kind:'result',money:0,supplies:0,settledStockIds:[id],...extra});
test('rental rewards preserve physical identity, preset parts and uses across saves without granting permanent parts',()=>{
 const {E}=load();assert(E.creditActivity(gift()));assert.equal(E.creditActivity(gift()),false);
 const items=E.snapshot().storage.units;assert.equal(items.length,2);assert.equal(new Set(items.map(i=>i.id)).size,2);
 assert(items.every(i=>i.rentalUses===2&&i.plugins[0]==='frame'));
 assert.equal(E.pluginQuantity('frame'),0);assert.deepEqual(Object.keys(E.snapshot().pluginInventory),[]);
 const restored=load(E.snapshot()).E;assert.equal(restored.storedUnits()[0].rentalUses,2);
 assert.throws(()=>E.setStoredPlugin(items[0].id,0,null),/租赁/);assert.throws(()=>E.sellUnit('RGM_79',items[0].id),/租赁/);
 assert(E.setStoredPilot(items[0].id,'test-pilot'));assert.equal(E.snapshot().storage.units[0].pilotId,'test-pilot');
});
test('only participating rentals consume a use at final settlement and repair all resources and parts for free',()=>{
 const {E}=load();E.creditActivity(gift());const [item,unused]=E.snapshot().storage.units,before=E.snapshot();
 E.creditAward({id:'kill',matchId:'battle',money:0,supplies:0});assert.equal(E.snapshot().storage.units[0].rentalUses,2);
 E.creditAward(result('battle',item.id,{stockStates:[{stockId:item.id,unitId:item.unitId,kitId:item.kitId,hp:10,en:0,brokenParts:{head:true}}]}));
 const after=E.snapshot(),fixed=after.storage.units.find(i=>i.id===item.id);assert.equal(fixed.rentalUses,1);assert.equal(fixed.hp,item.hp);assert.equal(fixed.en,item.en);assert.equal(Object.keys(fixed.brokenParts).length,0);
 assert.equal(after.storage.units.find(i=>i.id===unused.id).rentalUses,2);assert.equal(after.supplies,before.supplies);assert.equal(E.repairQuote().items.length,0);
 assert.equal(E.creditAward(result('battle',item.id)),false);
 E.creditAward(result('battle',item.id,{id:'another-receipt'}));assert.equal(E.snapshot().storage.units.find(i=>i.id===item.id).rentalUses,1);
});
test('destroyed rental repairs at settlement, expires after next battle and detaches its pilot without affecting owned duplicates',()=>{
 const {E}=load();E.creditActivity(gift({inventory:{RGM_79:1}}));const item=E.snapshot().storage.units.find(i=>i.rentalUses),before=E.quantity('RGM_79');E.setStoredPilot(item.id,'pilot');
 E.creditAward({id:'loss',matchId:'battle',money:0,supplies:0,kind:'loss',stockLost:{inventory:{RGM_79:1}},stockLostItems:[{stockId:item.id,unitId:'RGM_79',kitId:item.kitId}]});
 assert.equal(E.snapshot().storage.units.find(i=>i.id===item.id).hp,0);
 E.creditAward(result('battle',item.id));assert.equal(E.quantity('RGM_79'),before);assert.equal(E.snapshot().storage.units.find(i=>i.id===item.id).pilotId,'pilot');
 E.creditAward(result('battle2',item.id));assert.equal(E.quantity('RGM_79'),before-1);assert(!E.snapshot().storage.units.some(i=>i.id===item.id||i.pilotId==='pilot'));
 assert.equal(E.snapshot().storage.units.filter(i=>!i.rentalUses).length,1);
});
test('destroyed last-use rental disappears without deducting another chassis',()=>{
 const {E}=load();E.creditActivity(gift({inventory:{RGM_79:1},rentals:[{unitId:'RGM_79',count:1,uses:1}]}));const item=E.snapshot().storage.units.find(i=>i.rentalUses);
 E.creditAward(result('battle',item.id,{stockLost:{inventory:{RGM_79:1}},stockLostItems:[{stockId:item.id,unitId:item.unitId}]}));
 assert.equal(E.quantity('RGM_79'),1);assert.equal(E.snapshot().storage.units.length,1);assert(!E.snapshot().storage.units[0].rentalUses);
});
test('overflow deliveries retain rentals and presets without duplicating permanent overflow rewards',()=>{
 const {E}=load();E.creditActivity(gift({inventory:{RGM_79:30},rentals:[{unitId:'RGM_79',count:1,uses:5,plugins:['frame']}]}));
 let storage=E.snapshot().storage;assert.equal(storage.units.length+storage.deliveries.length,31);const index=storage.deliveries.findIndex(i=>i.rentalUses);assert(index>=0);
 E.discardStoredUnit(storage.units[0].id);E.receiveDeliveries(index);storage=E.snapshot().storage;
 assert.equal(storage.units.find(i=>i.rentalUses).rentalUses,5);assert.equal(E.pluginQuantity('frame'),0);
 assert.equal(load(E.snapshot()).E.snapshot().storage.deliveries.length,storage.deliveries.length);
});
test('rental grant and use-count settlement roll back on persistence failure',()=>{
 let f=load();f.fail();assert.throws(()=>f.E.creditActivity(gift()),/write failed/);assert.equal(f.E.snapshot().storage.units.length,0);
 f=load();f.E.creditActivity(gift());const before=JSON.stringify(f.E.snapshot()),item=f.E.snapshot().storage.units[0];f.fail();assert.throws(()=>f.E.creditAward(result('battle',item.id)),/write failed/);assert.equal(JSON.stringify(f.E.snapshot()),before);
});
test('rental reward validation rejects malformed uses, excessive quantities and invalid presets',()=>{
 for(const uses of [0,-1,1.5,1000001])assert.throws(()=>Warehouse.rentalRewards([{unitId:'RGM_79',count:1,uses}],G.models));
 assert.throws(()=>Warehouse.rentalRewards([{unitId:'RGM_79',count:10001,uses:1}],G.models));
 assert.throws(()=>Warehouse.rentalRewards([{unitId:'missing',count:1,uses:1}],G.models));
 assert.throws(()=>Warehouse.rentalRewards([{unitId:'RGM_79',count:1,uses:1,plugins:['frame','frame']}],G.models));
 assert.throws(()=>Warehouse.profile([{id:'bad',unitId:'RGM_79',kitId:'standard',rentalUses:0}],G.models));
});

test('authoritative contract defeat settles a destroyed rental once and leaves the unused rental untouched',t=>{
 const {E}=load();E.creditActivity(gift({rentals:[{unitId:'Medea',count:2,uses:1}]}));
 const item=E.snapshot().storage.ships[0],formation=[{unitId:item.unitId,kitId:item.kitId,stockId:item.id}];E.setStoredPilot(item.id,'pilot');
 const {createRoomEngine}=require('../shared/room-engine');let serial=0;const errors=[];
 const engine=createRoomEngine({rules:G,randomId:()=>String(++serial),randomToken:()=>String(++serial),randomSeed:()=>12345,aiDelayMs:999999,resultReturnMs:999999,
  send:(_,message)=>{if(message.type==='error')errors.push(message.message);}});t.after(()=>engine.close());
 const ws={readyState:1};engine.join(ws,{mode:'create',room:'RENTAL',roomMode:'sweep',characterFaction:'PMC',inventory:E.snapshot().inventory,storedUnits:E.storedUnits()});
 const room=engine.rooms.get('RENTAL');const act=(action,fields={})=>engine.action(ws,{id:'rental-action-'+ ++serial,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...fields});
 act('start_game',{formation});act('confirm_formation');assert.equal(room.phase,'deployment',errors.join('\n'));act('auto_place_deployment');act('confirm_deployment');
 const actor=room.game.units.find(u=>G.ownerOf(u)===0&&!u.missionGuest);assert.equal(actor.stockId,item.id);
 actor.hp=0;engine.broadcast(room);assert.equal(room.game.winner,1);
 const awards=room.economyAwards.filter(award=>award.memberId===room.seats[0].id);assert(awards.some(award=>award.kind==='loss'));
 const settlement=awards.find(award=>award.kind==='result');assert.deepEqual(settlement.settledStockIds,[item.id]);
 for(const award of awards)E.creditAward(award);
 assert.equal(E.snapshot().storage.ships.length,1);assert.equal(E.snapshot().storage.ships[0].rentalUses,1);assert.notEqual(E.snapshot().storage.ships[0].id,item.id);assert.equal(E.quantity('Medea'),1);
 for(const award of awards)assert.equal(E.creditAward(award),false);
 assert.equal(errors.length,0);
});
