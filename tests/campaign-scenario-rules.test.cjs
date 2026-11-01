const test = require("node:test"), assert = require("node:assert/strict");
const C = require("../shared/campaign.js"), G = require("../shared/rules.js");
const ctx = {G, world:require("../assets/maps/strategy/earth_0079_mid/world.json"), production:require("../shared/production-data.cjs"), development:require("../shared/development.js")};
const members=[0,1,2,3].map(seat=>({seat}));
const act=(s,seat,action,fields={})=>C.action(ctx,s,members,seat,{action,turn:s.turn,...fields});

test("scenario starts with the specified resources, regional garrisons and production capacities",()=>{
 const s=C.create(ctx,members);
 for(const p of s.teams) {assert.equal(p.money,25000);assert.equal(p.supplies,50000);}
 for(const r of ctx.world.regions) {
  const roster=r.owner===0?{Type61:4,FF_B2:2,Medea:1}:{MS_06F:2,MS_06S:1,FatUncle:1};
  for(const [id,count] of Object.entries(roster)) assert.equal(s.units.filter(u=>u.region===r.id&&u.unitId===id).length,count*(r.factory?3:1));
 }
 assert.equal(C.productionCapacity(ctx,"jaburo"),5);assert.equal(C.productionCapacity(ctx,"odessa"),5);assert.equal(C.productionCapacity(ctx,"belfast"),3);
});

test("normal cores work three orders and headquarters five, leaving excess orders queued",()=>{
 for(const [region,slots] of [["jaburo",5],["belfast",3]]) {
  const s=C.create(ctx,members);s.teams[0].money=s.teams[0].supplies=1e7;
  for(let i=0;i<slots+2;i++) act(s,0,"campaign_produce",{region,unitId:"Type61"});
  const count=s.units.length;C.advance(ctx,s,members);
  assert.equal(s.units.length-count,slots*C.quote(ctx,"Type61").quantity);
  assert.equal(s.orders.length,2);assert(s.orders.every(o=>o.status==="queued"));
 }
});

test("research takes two settlements, saves pending work and rejects duplicates without charging",()=>{
 const s=C.create(ctx,members),p=s.teams[0];p.money=p.supplies=p.technology=1e7;
 const node=ctx.development.nodes(p.faction).find(n=>!p.researched.includes(n.id)&&n.requires.every(id=>p.researched.includes(id)));
 act(s,0,"campaign_research",{techId:node.id}); const before=structuredClone(p);
 assert.throws(()=>act(s,0,"campaign_research",{techId:node.id}));assert.deepEqual(p,before);
 const imported=C.validate(ctx,s,members);C.advance(ctx,imported,members);
 assert(!imported.teams[0].researched.includes(node.id));assert.equal(imported.teams[0].researchQueue[0].remaining,1);
 C.advance(ctx,imported,members);assert(imported.teams[0].researched.includes(node.id));assert.equal(imported.teams[0].researchQueue.length,0);
});

test("ready players wait through others' orders and cannot edit before all human players finish",()=>{
 const s=C.create(ctx,members);act(s,0,"campaign_ready",{ready:true});assert.deepEqual(s.ready,[0]);
 act(s,1,"campaign_intelligence");assert.deepEqual(s.ready,[0]);
 assert.throws(()=>act(s,0,"campaign_intelligence"),/等待/);
 act(s,1,"campaign_ready",{ready:true});act(s,2,"campaign_ready",{ready:true});assert.equal(s.turn,1);
 act(s,3,"campaign_ready",{ready:true});assert.equal(s.turn,2);assert.deepEqual(s.ready,[]);
});

test("capturing either headquarters wins without conquering the rest of the world",()=>{
 for(const [id,team,winner] of [["jaburo",0,1],["odessa",1,0]]) {
  const s=C.create(ctx,members);s.regions.find(r=>r.id===id).owner=winner;
  assert.equal(C.updateVictory(ctx,s),winner);assert(s.regions.some(r=>r.owner===team));assert.equal(s.phase,"strategy");
 }
});

test("strategic boarding uses real hangar capacity, survives saves and moves with its carrier",()=>{
 const s=C.create(ctx,members);s.units=[];
 const carrier=C.addUnit(ctx,s,0,"jaburo","Medea"),pax=C.addUnit(ctx,s,0,"jaburo","Type61");
 act(s,0,"campaign_embark",{armyId:pax.id,carrierId:carrier.id,hangarId:"Hangar_1"});
 assert.equal(pax.state.embarked.carrierId,carrier.state.id);
 assert.equal(C.view(s,0).units.find(u=>u.id===pax.id).carrierArmyId,carrier.id);
 assert.match(s.history.at(-1),/搭乘.*No\./);
 C.validate(ctx,s,members);
 act(s,0,"campaign_move",{ids:[carrier.id],region:"andes"});C.advance(ctx,s,members);
 assert.equal(pax.region,"andes");assert.equal(carrier.region,"andes");
 act(s,0,"campaign_disembark",{armyId:pax.id});assert(!pax.state.embarked);
 for(let i=0;i<6;i++) {const u=C.addUnit(ctx,s,0,"andes","Type61");act(s,0,"campaign_embark",{armyId:u.id,carrierId:carrier.id,hangarId:"Hangar_1"});}
 const extra=C.addUnit(ctx,s,0,"andes","Type61"),before=structuredClone(s);
 const publicState=C.view(s,0);
 assert(!C.embarkOptions(ctx,publicState,publicState.units.find(u=>u.id===extra.id)).some(option=>option.carrierId===carrier.id));
 assert.throws(()=>act(s,0,"campaign_embark",{armyId:extra.id,carrierId:carrier.id,hangarId:"Hangar_1"}),/容量/);assert.deepEqual(s,before);
 const enemy=C.addUnit(ctx,s,1,"andes","MS_06F");assert.throws(()=>act(s,0,"campaign_embark",{armyId:enemy.id,carrierId:carrier.id,hangarId:"Hangar_1"}),/无权/);
 const invalid=structuredClone(s);invalid.units.find(u=>u.state?.embarked).state.embarked.carrierId="missing";
 assert.throws(()=>C.validate(ctx,invalid,members),/搭载关系/);
});
