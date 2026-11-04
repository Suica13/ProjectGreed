const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules');
const {createAttackPlanner} = require('../shared/attack-plans');
const {createRoomEngine} = require('../shared/room-engine');
const entry = id => { const m = Object.values(G.models).find(m=>m.prefabId===id); return {unitId:id,kitId:m.kitId}; };
function fixture(ids=['DodaiYS','DodaiYS','RGM_79','RGM_79']) {
 const game=G.create(false,4,[ids.map(entry),[entry('RGM_79')]],false,{fogMode:'disabled',costLimit:99999,unitCostLimit:99999});
 game.tiles.forEach(row=>row.fill('plain'));game.deployment=null;
 game.units.forEach((u,i)=>Object.assign(u,{x:5+i,y:5,en:10000,hp:1000000}));
 return game;
}
test('small SFS platforms can form squads and passengers fire with their own carrier squad',()=>{
 const game=fixture(),[a,b,p,q,enemy]=game.units;
 Object.assign(b,{x:6,y:5});Object.assign(p,{x:5,y:6});Object.assign(q,{x:6,y:6});Object.assign(enemy,{x:7,y:5});
 G.hangars.embark(game,p,a,G.hangars.of(a)[0].id);
 G.hangars.embark(game,q,b,G.hangars.of(b)[0].id);
 G.end(game);G.end(game);
 assert(G.squadEligible(a));assert(G.squadEligible(b));
 G.move(game,b,a.x,a.y);assert.equal(G.squadMembers(game,a).length,2);
 assert.deepEqual(new Set(G.squadAttackMembers(game,a).map(u=>u.id)),new Set([a.id,b.id,p.id,q.id]));
 const planner=createAttackPlanner(G),room={game,plans:[],planSequence:0};
 planner.plan(room,a,enemy,null,0);
 assert(p.plan&&q.plan,'both exposed passengers receive their own legal weapon plans');
 assert.equal(p.plan.target,enemy.id);assert.equal(q.plan.target,enemy.id);
 planner.cancel(room,a);assert(!p.plan&&!q.plan);
 p.acted=true;
 planner.plan(room,a,enemy,null,0);
 assert(!p.plan&&p.acted,'an already spent passenger is not reactivated');
 assert(q.plan,'the remaining passenger still fires with the carrier');
});
test('joining an ordered squad adds a legal attack without resetting an existing spent action',()=>{
 const game=fixture(['RGM_79','RGM_79','RGM_79']),[a,b,spent,enemy]=game.units;
 Object.assign(a,{x:5,y:5});Object.assign(b,{x:4,y:5});Object.assign(spent,{x:5,y:5,squadId:'existing',squadSlot:1,acted:true});
 Object.assign(a,{squadId:'existing',squadSlot:0});Object.assign(enemy,{x:6,y:5});
 const planner=createAttackPlanner(G),room={game,plans:[],planSequence:0};
 planner.plan(room,a,enemy,null,0,'melee',true);
 const previous=structuredClone(room.plans[0]);
 G.previewMove(game,b,a.x,a.y,0,true);G.confirmMove(game,b);planner.followSquad(room,b);
 assert(b.plan);assert.equal(b.plan.target,enemy.id);assert.equal(spent.acted,true);assert(!spent.plan);
 assert.deepEqual(room.plans[0],previous);
 planner.followSquad(room,b);assert.equal(room.plans.length,2,'a repeated synchronization cannot duplicate orders');
});
test('server movement confirmation inherits the destination squad order',t=>{
 let id=0;const engine=createRoomEngine({rules:G,randomId:()=>String(++id),randomToken:()=>String(++id),randomSeed:()=>1,send:()=>{}});
 t.after(()=>engine.close());const sockets=[{readyState:1},{readyState:1}];
 engine.join(sockets[0],{mode:'create',room:'JOINORDER',characterFaction:'PMC'});
 engine.join(sockets[1],{mode:'join',room:'JOINORDER',characterFaction:'PMC'});
 const room=engine.rooms.get('JOINORDER');room.game=fixture(['RGM_79','RGM_79']);
 Object.assign(room,{started:true,matchId:'joining',phase:'idle',activeSeats:[true,true],turnDone:[false,false],turnNotBefore:0,plans:[],planSequence:0});
 const [a,b,enemy]=room.game.units;Object.assign(a,{x:5,y:5});Object.assign(b,{x:4,y:5});Object.assign(enemy,{x:6,y:5});
 const act=(action,fields)=>engine.action(sockets[0],{action,...fields,id:'join-order-'+ ++id,revision:room.revision,round:room.game.round});
 act('attack',{unitId:a.id,targetId:enemy.id,single:true});
 act('move',{unitId:b.id,x:5,y:5,single:true});act('confirm_move',{unitId:b.id});
 assert(b.plan);assert.equal(room.plans.length,2);
});
