const test = require("node:test"), assert = require("node:assert/strict");
const C = require("../shared/campaign.js"), G = require("../shared/rules.js");
const ctx = {G, world:require("../assets/maps/strategy/earth_0079_mid/world.json"), production:require("../shared/production-data.cjs"), development:require("../shared/development.js")};
const members=[0,1,2,3].map(seat=>({seat}));
const act=(s,seat,action,fields={})=>C.action(ctx,s,members,seat,{action,turn:s.turn,...fields});

test("scenario starts with the specified resources, regional garrisons and production capacities",()=>{
 const s=C.create(ctx,members);
 for(const p of s.teams) {assert.equal(p.money,25000);assert.equal(p.supplies,50000);}
 for(const r of ctx.world.regions) {
  const roster=r.factory ? (r.owner===0 ? {Type61:9,FF_B2:3,Medea:1,FF_6:2,FF_S3:1} :
    {MS_06F:2,MS_06S:1,FatUncle:1,ZN_Heli:1,Dopp:1,MTank:1}) :
    (r.owner===0 ? {Type61:3,FF_B2:1,FF_6:1} : {MS_06F:1,MTank:1,ZN_Heli:1});
  const actual={};for(const u of s.units.filter(u=>u.region===r.id)) actual[u.unitId]=(actual[u.unitId]||0)+1;
  assert.deepEqual(actual,roster);
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


test("initial garrisons automatically fill legal transports and survive campaign import",()=>{
 const s=C.create(ctx,members);
 assert(s.units.some(u=>u.state?.embarked));
 for(const u of s.units.filter(u=>u.state?.embarked)) {
  const carrier=s.units.find(c=>c.state?.id===u.state.embarked.carrierId);
  assert(carrier);assert.equal(carrier.region,u.region);assert.equal(carrier.team,u.team);
  assert(["Medea","FatUncle"].includes(carrier.unitId));
 }
 for(const u of s.units.filter(u=>!u.state?.embarked))
  assert.equal(C.embarkOptions(ctx,s,u).filter(o=>["Medea","FatUncle"].includes(s.units.find(c=>c.id===o.carrierId)?.unitId)).length,0);
 assert.doesNotThrow(()=>C.validate(ctx,s,members));
});

test("reserve maintenance heals only surviving nonparticipants in friendly regions, including cargo",()=>{
 const s=C.create(ctx,members);s.units=[];
 const reserve=C.addUnit(ctx,s,0,"jaburo","Type61"), fought=C.addUnit(ctx,s,0,"jaburo","Type61"),
 enemyLand=C.addUnit(ctx,s,0,"odessa","Type61"), destroyed=C.addUnit(ctx,s,0,"jaburo","Type61");
 for(const u of s.units) u.state={hp:100,en:0};
 fought.participatedTurn=s.turn;destroyed.destroyed=true;
 const m=C.model(ctx,reserve);C.recoverReserves(ctx,s);
 assert.equal(reserve.state.hp,Math.min(m.hp,100+Math.round(m.hp*.3)));
 assert.equal(reserve.state.en,Math.ceil(m.en*.6));
 for(const u of [fought,enemyLand,destroyed]) assert.deepEqual(u.state,{hp:100,en:0});
});


test("dismissal refunds half the single-unit selected-kit price, frees crews and cannot repeat",()=>{
 const s=C.create(ctx,members);s.units=[];
 const u=C.addUnit(ctx,s,0,"jaburo","Type61"),price=C.quote(ctx,u.unitId,u.kitId);
 act(s,0,"campaign_pilot_recruit",{name:"待命驾驶员"});
 const crew=s.pilots.at(-1);
 act(s,0,"campaign_pilot_assign",{armyId:u.id,pilotId:crew.profile.id});
 const before={...s.teams[0]},crewBefore=structuredClone(crew);
 const refund=C.dismissalQuote(ctx,u);
 assert.deepEqual(refund,{money:Math.floor(price.money/price.quantity/2),supplies:Math.floor(price.supplies/price.quantity/2)});
 s.marches=[{armyId:u.id,team:0,from:"andes",to:"jaburo",turn:1}];
 act(s,0,"campaign_dismiss",{armyId:u.id,money:99999999,supplies:99999999});
 assert.equal(s.teams[0].money,before.money+refund.money);assert.equal(s.teams[0].supplies,before.supplies+refund.supplies);
 assert(!s.units.some(a=>a.id===u.id));assert.deepEqual(s.pilots[0],crewBefore);
 assert(!s.units.some(a=>a.pilotId===crew.profile.id));assert.deepEqual(s.marches,[]);assert.match(s.history.at(-1),/出售.*No\./);
 const settled=structuredClone(s);assert.throws(()=>act(s,0,"campaign_dismiss",{armyId:u.id}));assert.deepEqual(s,settled);
 assert.doesNotThrow(()=>C.validate(ctx,s,members));
});

test("dismissal rejects enemy, moving, pending and occupied-carrier units, but allows removing a passenger",()=>{
 const s=C.create(ctx,members);s.units=[];
 const carrier=C.addUnit(ctx,s,0,"jaburo","Medea"),pax=C.addUnit(ctx,s,0,"jaburo","Type61");
 act(s,0,"campaign_embark",{armyId:pax.id,carrierId:carrier.id,hangarId:"Hangar_1"});
 const before=structuredClone(s);
 assert.throws(()=>act(s,1,"campaign_dismiss",{armyId:pax.id}),/无权/);
 assert.throws(()=>act(s,0,"campaign_dismiss",{armyId:carrier.id}),/清空格纳库/);assert.deepEqual(s,before);
 pax.moveTo="andes";assert.throws(()=>act(s,0,"campaign_dismiss",{armyId:pax.id}));pax.moveTo=null;
 s.transfers=[{id:"x",ids:[pax.id],to:2}];assert.throws(()=>act(s,0,"campaign_dismiss",{armyId:pax.id}));s.transfers=[];
 act(s,0,"campaign_dismiss",{armyId:pax.id});assert(C.canDismiss(ctx,s,members,0,carrier));
 assert.doesNotThrow(()=>C.validate(ctx,s,members));
});


test("contested armies and cargo cannot redeploy between battle segments or through stale saved orders",()=>{
 const s=C.create(ctx,members);s.units=[];
 const carrier=C.addUnit(ctx,s,0,"jaburo","Medea");
 const passenger=C.addUnit(ctx,s,0,"jaburo","Type61");
 const enemy=C.addUnit(ctx,s,1,"jaburo","MS_06F");
 const reserve=C.addUnit(ctx,s,0,"andes","Type61");
 const option=C.embarkOptions(ctx,s,passenger).find(o=>o.carrierId===carrier.id);assert(option);
 act(s,0,"campaign_embark",{armyId:passenger.id,carrierId:carrier.id,hangarId:option.hangarId});
 s.encounters=[{region:"jaburo",turn:s.turn-1,battleSave:null,roster:{},settled:[]}];
 assert.equal(C.canRedeploy(s,carrier),false);
 assert.equal(C.canRedeploy(C.view(s,0),carrier),false,"public contested marker also locks UI");
 assert.throws(()=>act(s,0,"campaign_move",{ids:[carrier.id],region:"andes"}),/交战/);
 assert.throws(()=>act(s,0,"campaign_move",{ids:[reserve.id,carrier.id],region:"jaburo"}),/交战/);
 assert.equal(reserve.moveTo,null,"mixed batch rejects atomically");
 carrier.moveTo=passenger.moveTo="andes";
 C.advance(ctx,s,members);
 assert.equal(carrier.region,"jaburo");assert.equal(passenger.region,"jaburo");
 assert.equal(carrier.moveTo,null);assert.equal(passenger.moveTo,null);
 enemy.destroyed=true;s.encounters=[];s.phase="strategy";
 assert.equal(C.canRedeploy(s,carrier),true);
 act(s,0,"campaign_move",{ids:[carrier.id],region:"andes"});
 assert.equal(carrier.moveTo,"andes");
});
