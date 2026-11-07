const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules.js"), D = require("../shared/development.js");
const {createRoomEngine}=require("../shared/room-engine.js");
function fixture(mode,watchOnly=false) {
 let seq=0;const calls=[];
 const engine=createRoomEngine({rules:{...G,randomFormation(...args){const army=G.randomFormation(...args);calls.push({rules:args[2],army});return army;}},randomId:()=>"era-"+(++seq),randomToken:()=>"token-"+(++seq),randomSeed:()=>5,send:()=>{}});
 const host={readyState:1};engine.join(host,{mode:"create",room:"ERAS",characterFaction:"PMC"});
 const room=engine.rooms.get("ERAS");room.settings.mode=mode;
 const research=Object.fromEntries(D.factions.map(f=>[f,D.nodes(f).map(n=>n.id)]));
 const member=room.seats[0];member.researched=research;
 const early=Object.values(G.models).find(m=>m.tags.includes("0083")&&!m.formOnly&&!m.wip);
 member.formation=[{unitId:"FatUncle",kitId:"standard"},{unitId:early.prefabId,kitId:early.kitId,preload:{carrierIndex:0,hangarId:"Hangar_1"}}];
 // A second participant supplies a different era; spectators must not add theirs.
 const secondModel=Object.values(G.models).find(m=>m.tags.includes("0087T1")&&!m.formOnly&&!m.wip);
 const second={...member,id:"second",seat:2,formation:[{unitId:secondModel.prefabId,kitId:secondModel.kitId}]};
 room.seats[2]=second;room.members.set(second.id,second);
 const spectatorModel=Object.values(G.models).find(m=>m.tags.includes("0087T2")&&!m.formOnly&&!m.wip);
 room.members.set("spectator",{...member,id:"spectator",seat:null,formation:[{unitId:spectatorModel.prefabId,kitId:spectatorModel.kitId}]});
 if(watchOnly){room.seats[0]=null;room.seats[2]=null;member.seat=null;second.seat=null;}
 calls.length=0;
 const action=(name,fields={})=>engine.action(host,{id:"action-"+(++seq),revision:room.revision,round:room.game.round,matchId:room.matchId,action:name,...fields});
 return {engine,room,member,second,calls,action};
}
test("regular AI uses the union of all seated humans including preloads, not spectators",()=>{
 const f=fixture("regular");try{
  f.action("add_ai",{seat:1});
  const allowed=[...new Set([f.member,f.second].flatMap(p=>p.formation).flatMap(e=>G.models[e.unitId+"__"+e.kitId].tags).filter(t=>G.eras.includes(t)))].sort();
  assert(allowed.includes("0083"));assert(allowed.includes("0087T1"));assert(!allowed.includes("0087T2"));
  assert(f.calls.length>0);
  for(const c of f.calls){assert.deepEqual(c.rules.aiAllowedEras,allowed);assert(c.army.length>0);assert(c.army.every(e=>G.models[e.unitId+"__"+e.kitId].tags.some(t=>allowed.includes(t))));}
 }finally{f.engine.close();}
});
test("assembly previews regenerate bots when participants change their era union",()=>{
 const f=fixture("regular");try{
  f.action("add_ai",{seat:1});
  f.room.started=true;f.room.phase="assembly";
  f.member.formation=[{unitId:"Type61",kitId:"standard"}];
  f.second.formation=[{unitId:"Type61",kitId:"standard"}];
  f.calls.length=0;
  f.engine.join({readyState:1},{mode:"join",room:"ERAS",characterFaction:"PMC"});
  assert(f.calls.length>0);
  assert.deepEqual(f.calls.at(-1).rules.aiAllowedEras,["0079T1"]);
  assert(f.room.seats[1].formation.every(e=>G.models[e.unitId+"__"+e.kitId].tags.includes("0079T1")));
 }finally{f.engine.close();}
});
test("quick battle and AI-only regular rooms retain their existing era pools",()=>{
 for(const [mode,watchOnly] of [["quick",false],["regular",true]]){
  const f=fixture(mode,watchOnly);try{f.action("add_ai",{seat:1});assert(f.calls.length>0);assert(f.calls.every(c=>c.rules.aiAllowedEras===undefined));}finally{f.engine.close();}
 }
});
test("era-limited generation cannot reintroduce outside-era units through support or preload choices",()=>{
 for(const era of ["0079T1","0083","0087T1"]){
  for(const seed of [1,42,7319]){
   const army=G.randomFormation(seed,5000,{aiAllowedEras:[era],unitCostLimit:1000},36);
   assert(army.length>0);assert(army.every(e=>G.models[e.unitId+"__"+e.kitId].tags.includes(era)));
  }
 }
});
