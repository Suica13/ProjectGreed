const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  C = require("../shared/contract-mode"),
  { createRoomEngine } = require("../shared/room-engine");
function fixture(t, { difficulty = 6, environment = "ground", seed = 1936384585, players = 1, era = "UC_0079_T1", faction = "ZEON", alliedFaction, validateEraRules = false, contactTasks = [], secondContactTasks = null, aiDelayMs = 999999, roomReturnMs = 999999, deploy = true } = {}) {
  let serial = 0;
  const frames = new Map(),
    errors = [];
  const engine = createRoomEngine({
    // Exercise era mechanics independently of the temporary era lobby policy.
    rules: {...G,validateOpenContent(){}},
    randomId: () => "contract-" + ++serial,
    randomToken: () => "token-" + ++serial,
    randomSeed: () => seed,
    aiDelayMs,
    roomReturnMs,
    send: (ws, m) => {
      if (m.type === "state") frames.set(ws, m);
      if (m.type === "error") errors.push(m.message);
    },
  });
  t.after(() => engine.close());
  const clients = Array.from({ length: players + 1 }, () => ({ readyState: 1 }));
  const unitId = environment === "space" ? "ColumbusClass" : "Medea",
    model = G.models[unitId + "__standard"];
  assert(model, unitId);
  const formation = [{ unitId, kitId: "standard", stockId: "stock" }];
  for (let i = 0; i < players; i++)
    engine.join(clients[i], {
      mode: i ? "join" : "create",
      room: "CONTRACT",
      roomMode: "sweep",
      characterFaction: "PMC",
      contactTasks: i===1 && secondContactTasks ? secondContactTasks : contactTasks,
      inventory: { [unitId]: 5 },
      licenses: { [unitId]: true },
      storedUnits: [{ id: "stock", unitId, kitId: "standard", hp: model.hp, en: model.en }],
    });
  const room = engine.rooms.get("CONTRACT");
  const act = (i, action, fields = {}, id) =>
    engine.action(clients[i], {
      id: id || "request-" + ++serial,
      revision: room.revision,
      round: room.game.round,
      phase: room.phase,
      matchId: room.matchId,
      action,
      ...fields,
    });
  act(0, "configure_room", {
    ...room.settings,
    sweepDifficulty: difficulty,
    sweepEnvironment: environment,
    sweepEra: era,
    sweepFaction: faction,
    sweepAlliedFaction: alliedFaction || (faction==='NONE'?'NONE':C.factionsForEra(G,era).find(f=>f!==faction)),
    fogMode: "disabled",
    pilotPolicy: "none",
  });
  if (validateEraRules) {
    for (const invalidFaction of ["EFSF", "ZEON", "OMNI", "ZAFT"])
      assert.throws(() => act(0, "configure_room", { ...room.settings, sweepFaction: invalidFaction }));
    assert.equal(room.settings.sweepFaction, faction);
    for (const invalidFriend of [faction,'OMNI'])
      assert.throws(()=>act(0,'configure_room',{...room.settings,sweepAlliedFaction:invalidFriend}),/我军阵营/);
  }
  for (let i = 1; i < players; i++) act(i, "set_ready", { ready: true, formation });
  act(0, "start_game", { formation });
  for (let i = 0; i < players; i++) act(i, "confirm_formation");
  assert.equal(room.phase, "deployment", errors.join("\n"));
  for (let i = 0; deploy && i < players; i++) {
    act(i, "auto_place_deployment");
    act(i, "confirm_deployment");
  }
  assert.equal(room.phase, deploy ? "idle" : "deployment", errors.join("\n"));
  assert.equal(errors.length, 0);
  const actor = room.game.units.find((u) => u.ownerSeat === 0),
    member = room.seats[0];
  return { engine, room, clients, frames, errors, act, actor, member };
}
function moveTo(G, u, p) {
  u.x = p.x;
  u.y = p.y;
  u.acted = false;
  u.moved = false;
  delete u.plan;
  delete u.pendingMove;
}
function clearEnemies(f) {
  for (const u of f.room.game.units.filter((u) => u.team === 1)) u.hp = 0;
}

test('three independent Anaheim token commissions create separate N5 objectives and require personal extraction',t=>{
 const tasks=require('../shared/contact-tasks').tasks.filter(t=>t.tokenUnlock);
 const f=fixture(t,{difficulty:5,faction:'NONE',contactTasks:tasks.map(t=>({id:t.id,status:'accepted',progress:0}))}),g=f.room.game;
 const objectives=g.contract.objectives.filter(o=>tasks.some(t=>t.id===o.contactTaskId));assert.equal(objectives.length,3);
 assert.deepEqual(new Set(objectives.map(o=>o.type)),new Set(['salvage','command','upload']));
 const command=objectives.find(o=>o.type==='command');assert.equal(command.targets.length,3);
 assert.deepEqual(command.targets.map(id=>G.modelOf(g.units.find(u=>u.id===id)).prefabId),['RX_79_G','RGM_79_G','RGM_79_G']);
 for(const o of objectives)o.status='completed';assert.equal(C.commissionProgress(f.room,G,f.member).length,0);
 moveTo(G,f.actor,g.contract.extractions[0]);f.act(0,'contract_extract',{unitId:f.actor.id});
 const completed=C.commissionProgress(f.room,G,f.member);assert.deepEqual(new Set(completed.map(r=>r.id)),new Set(tasks.map(t=>t.id)));assert(completed.every(r=>r.amount===1));assert.deepEqual(f.errors,[]);
});

test('N6 Anaheim full sweep unlock requires all events before the actual extraction action',t=>{
 const f=fixture(t,{difficulty:6,faction:'NONE',contactTasks:[{id:'anaheim-11',status:'accepted',progress:0}]}),g=f.room.game;
 assert(!g.contract.objectives.some(o=>o.contactTaskId==='anaheim-11'),'commission reuses existing events');
 for(const o of g.contract.objectives)o.status='completed';
 moveTo(G,f.actor,g.contract.extractions[0]);
 f.act(0,'contract_extract',{unitId:f.actor.id});
 assert.equal(f.actor.contractAllEventsAtExtraction,true);
 assert.equal(C.commissionProgress(f.room,G,f.member).find(entry=>entry.id==='anaheim-11')?.amount,1);
 assert.deepEqual(f.errors,[]);
});

test('large event airdrops arrive across own turns from distinct directions and cancel on completion',t=>{
 const f=fixture(t),g=f.room.game,o=g.contract.objectives.find(o=>o.type==='radar');assert(o);
 const profile=require('../shared/contract-forces').profile(f.room.settings),key='radar.first',original=profile.waves[key];
 profile.waves[key]=Math.max(original*4,12000);t.after(()=>profile.waves[key]=original);
 g.contract.objectives=[o];for(const u of g.units)if(u.team===1&&!o.targets.includes(u.id))u.hp=0;
 moveTo(G,f.actor,{x:o.x+1,y:o.y+1});
 const drops=()=>g.units.filter(u=>u.contractObjectiveId===o.id&&u.airdropRound!==undefined);
 const maxFormation=Math.max(...require('../shared/contract-forces').formations(f.room.settings,G).map(formation=>formation.units.length));
 C.poll(f.room,G);const first=drops();assert(first.length>0&&first.length<=maxFormation);
 const count=first.length;for(let i=0;i<5;i++)C.poll(f.room,G);assert.equal(drops().length,count);
 g.round+=2;C.poll(f.room,G);const second=drops().filter(u=>u.airdropRound===g.round);assert(second.length>0);
 assert(second.length<=maxFormation);assert.notEqual(second[0].airdropDirection,first[0].airdropDirection);
 g.round+=2;C.poll(f.room,G);const third=drops().filter(u=>u.airdropRound===g.round);assert(third.length>0&&third.length<=maxFormation);
 assert.equal(new Set([first[0],second[0],third[0]].map(u=>u.airdropDirection)).size,3);
 const arrived=drops().length;o.status='completed';g.round+=2;C.poll(f.room,G);assert.equal(drops().length,arrived);
});

for(const [id,faction,difficulty,count,unitId,grade,kitId] of [
 ['efsf-11','ZEON',4,6,'MS_11','elite','kit_1'],
 ['efsf-12','EFSF',5,1,'RX_78XX','veteran','kit_3'],
 ['zeon-11','EFSF',4,6,'RX_79_G','elite','beam_rifle'],
]) test(`new commission ${id} spawns exact targets once and waits for the whole target group`,t=>{
 const contactTasks=[{id,status:'accepted',progress:0}];
 const f=fixture(t,{difficulty,faction,players:2,contactTasks,secondContactTasks:contactTasks}),g=f.room.game;
 const objectives=g.contract.objectives.filter(o=>o.contactTaskId===id);assert.equal(objectives.length,1);
 const o=objectives[0],targets=o.targets.map(id=>g.units.find(u=>u.id===id));assert.equal(targets.length,count);
 for(const u of targets){
  const model=G.modelOf(u);assert.equal(model.prefabId,unitId);assert.equal(model.kitId,kitId);
  assert.equal(u.team,1);assert.equal(u.pilot.genericGrade,grade);
  if(count===6)assert.equal(G.squadMembers(g,u).length,3);
 }
 if(count>1){targets.slice(0,-1).forEach(u=>u.hp=0);C.poll(f.room,G);assert.deepEqual(C.commissionProgress(f.room,G,f.member),[]);}
 targets.at(-1).hp=0;C.poll(f.room,G);
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id,amount:1}]);
 assert.deepEqual(C.commissionProgress(f.room,G,f.room.seats[2]),[{id,amount:1}]);
 const wrong=fixture(t,{difficulty,faction:faction==='EFSF'?'ZEON':'EFSF',contactTasks});
 assert(!wrong.room.game.contract.objectives.some(o=>o.contactTaskId===id));
 const low=fixture(t,{difficulty:difficulty-1,faction,contactTasks});
 assert(!low.room.game.contract.objectives.some(o=>o.contactTaskId===id));
});

test("an unattended seat shares control, preserves ownership, and restores privacy on reconnect", t => {
  const f=fixture(t,{players:2}),g=f.room.game;
  const ally=g.units.find(u=>G.ownerOf(u)===2);
  assert(!G.canControlUnit(f.room.settings,[...f.room.members.values()],0,ally));
  const member=f.room.seats[2],token=member.token;
  f.engine.disconnect(f.clients[1]);
  assert(f.frames.get(f.clients[0]).connected.every(Boolean));
  assert(G.canControlUnit(f.room.settings,[...f.room.members.values()],0,ally));
  assert(G.canControlUnit(f.room.settings,f.frames.get(f.clients[0]).members,0,ally));
  assert(!G.canControlUnit(f.room.settings,[...f.room.members.values()],1,ally));
  f.act(0,"wait",{unitId:ally.id});
  assert(ally.acted);assert.equal(G.ownerOf(ally),2);
  const resumed={readyState:1};
  f.engine.join(resumed,{mode:"resume",room:f.room.code,token,characterFaction:"PMC"});
  assert(!G.canControlUnit(f.room.settings,[...f.room.members.values()],0,ally));
  assert(G.canControlUnit(f.room.settings,[...f.room.members.values()],2,ally));
  assert.deepEqual(f.errors,[]);
});

test("vacating a seat lets a teammate extract its units without giving spectators control",t=>{
  const f=fixture(t,{players:2}),g=f.room.game;
  const ally=g.units.find(u=>G.ownerOf(u)===2);
  f.act(1,"switch_seat",{seat:null});
  assert.equal(f.room.seats[2],null);
  assert(!G.canControlUnit(f.room.settings,[...f.room.members.values()],null,ally));
  assert(f.frames.get(f.clients[0]).connected.every(Boolean));
  moveTo(G,ally,g.contract.extractions[0]);
  assert(C.canExtract(g,G,ally,0,f.frames.get(f.clients[0]).members));
  f.act(0,"contract_extract",{unitId:ally.id});
  assert(ally.contractExtracted);assert.equal(G.ownerOf(ally),2);
  moveTo(G,f.actor,g.contract.extractions[1]);
  f.act(0,"contract_extract",{unitId:f.actor.id});
  assert.equal(g.winner,0);assert.deepEqual(f.errors,[]);
});

test("disconnecting after a teammate ended planning cannot strand unattended actions",async t=>{
  const f=fixture(t,{players:2}),g=f.room.game;
  const ally=g.units.find(u=>G.ownerOf(u)===2);
  for(const objective of g.contract.objectives)objective.status="completed";
  f.act(0,"end_turn");
  assert.equal(g.team,0);assert(!ally.acted);
  f.engine.disconnect(f.clients[1]);
  assert(ally.acted);
  const deadline=Date.now()+5000;
  while(g.team===0&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,25));
  assert.equal(g.team,1);assert.deepEqual(f.errors,[]);
});

for(const disconnectAfterConfirmation of [false,true])
test(`unattended deployment confirms without blocking teammates (${disconnectAfterConfirmation})`,t=>{
  const f=fixture(t,{players:2,deploy:false});
  f.act(0,"auto_place_deployment");
  if(disconnectAfterConfirmation)f.act(0,"confirm_deployment");
  f.engine.disconnect(f.clients[1]);
  if(!disconnectAfterConfirmation)f.act(0,"confirm_deployment");
  assert.equal(f.room.phase,"idle");
  assert(f.room.game.deployment.every(Boolean));
  assert.deepEqual(f.errors,[]);
});

test("ground contracts generate four deterministic biomes with valid matching tilemaps", () => {
  const found = new Set(), M = require("../shared/map-document");
  for (let seed=1;seed<=32;seed++) {
    const settings={sweepDifficulty:1,sweepEnvironment:"ground"};
    const map=C.generateMap(G.catalog,settings,Math.imul(seed,0x9e3779b1)>>>0);
    found.add(map.contractLayout.biome);
    assert.deepEqual(map,C.generateMap(G.catalog,settings,Math.imul(seed,0x9e3779b1)>>>0));
    const doc=C.visualMap(G.catalog,{...map,mapId:map.id}).tileMap;
    M.validate(doc);
    assert.equal(doc.biomeStyle.biome,map.contractLayout.biome);
    const defs=new Map(doc.tiles.map(t=>[t.id,t]));
    assert(doc.layers.find(l=>l.id === "contract-ground").data.every(id=>
      !["road","shore","cliff","details"].includes(defs.get(id).biomeRole)),"overlays must not replace base terrain");
    if (["snow","desert"].includes(map.contractLayout.biome))
      assert(map.tiles.flat().includes(map.contractLayout.biome));
    if (map.contractLayout.biome === "urban") assert(doc.layers.some(l=>l.id === "contract-roads"));
  }
  assert.deepEqual([...found].sort(),["desert","snow","temperate","urban"]);
});

test("defense has autonomous friendly guards and activates only when PMC approaches", t => {
  const f=fixture(t),g=f.room.game,o=g.contract.objectives.find(o=>o.type === "defend");
  assert(o && o.coreId);
  const guards=g.units.filter(u=>o.protected.includes(u.id));
  assert.equal(guards.length,6);
  assert(!g.units.some(u=>u.team===1 && C.defenseCoverage(G,u,o)),'no initial enemies in friendly coverage');
  assert(guards.every(u=>u.team===0 && u.contractAlly && u.missionAutonomous));
  assert(f.room.seats[G.ownerOf(guards[0])].bot);
  assert(guards.every(u=>!G.canControlUnit({...f.room.settings,shareAlliedUnits:true},[...f.room.members.values()],0,u)));
  moveTo(G,f.actor,{x:0,y:0});
  C.poll(f.room,G);
  assert.equal(o.status,"available");
  clearEnemies(f);
  moveTo(G,f.actor,{x:o.x+1,y:o.y+1});
  C.poll(f.room,G);
  assert.equal(o.status,"active");
  assert.equal(o.progress,0);
  for(let i=1;i<=5;i++) {
    clearEnemies(f);g.round+=2;C.poll(f.room,G);
    assert.equal(o.progress,i);
    C.poll(f.room,G);assert.equal(o.progress,i,"snapshot repetition cannot advance timer");
  }
  assert.equal(o.status,"completed");
  assert.equal(g.winner,null,"objective completion still requires extraction");
  const enemy=g.units.find(u=>u.team===1 && !u.facility);
  enemy.hp=1;moveTo(G,enemy,{x:o.x+2,y:o.y});
  const visible={...G,sensors:{...G.sensors,visible:()=>true}};
  assert(C.aiOrder(g,visible,guards.find(u=>!u.facility)).alerted,"surviving guards still defend themselves after success");
});

test('defense has no initial enemy garrison and its five-by-five square includes corner cells',t=>{
 const f=fixture(t,{difficulty:1,seed:4}),g=f.room.game,o=g.contract.objectives[0];
 assert.equal(o.type,'defend');
 assert(!g.units.some(u=>u.team===1&&C.defenseCoverage(G,u,o)));
 assert(g.units.filter(u=>u.team===1).every(u=>!u.contractObjective));
 const scout=G.makeUnit({unitId:'RGM_79',kitId:'machine_gun'},0,'defense-area-scout',{x:o.x+3,y:o.y});
 scout.ownerSeat=0;g.units.push(scout);moveTo(G,f.actor,{x:0,y:0});
 C.poll(f.room,G);assert.equal(o.status,'available','three cells away is outside coverage');
 Object.assign(scout,{x:o.x+2,y:o.y+2});
 C.poll(f.room,G);assert.equal(o.status,'active','a corner of the five-by-five square activates defense');
 assert(g.units.some(u=>u.team===1&&u.contractReinforcement),'activation still sends an attack wave');
});

test('contract faction pairs represent all directed 0087 matchups and select actual allied garrisons',t=>{
 const pairs=C.factionPairs(G,'UC_0087_T1');
 assert.equal(pairs.length,7);assert(pairs.filter(p=>p.enemyFaction!=='NONE').every(p=>p.enemyFaction!==p.alliedFaction));
 assert(pairs.some(p=>p.enemyFaction==='NONE'&&p.alliedFaction==='NONE'));
 for(const friend of ['AEUG','NEO_ZEON']){
  const f=fixture(t,{era:'UC_0087_T1',faction:'TITANS',alliedFaction:friend,difficulty:1,seed:4});
  assert.equal(f.room.settings.sweepAlliedFaction,friend);
  const allies=f.room.game.units.filter(u=>u.contractAlly&&!u.facility);
  assert.equal(allies.length,3);
  assert(allies.every(u=>(G.modelOf(u).availableFactions||[G.modelOf(u).faction]).includes(friend)));
 }
 assert.equal(C.alliedFaction(G,{sweepEra:'UC_0079_T1',sweepFaction:'EFSF'}),'ZEON','old settings gain the opposite ally');
});

test("destroyed defense core fails only that objective and awards no event income", t => {
  const f=fixture(t),g=f.room.game,o=g.contract.objectives.find(o=>o.type === "defend");
  clearEnemies(f);moveTo(G,f.actor,{x:o.x+1,y:o.y+1});C.poll(f.room,G);
  const before=C.reward(f.room,G);
  g.units.find(u=>u.id === o.coreId).hp=0;C.poll(f.room,G);
  assert.equal(o.status,"failed");assert.equal(g.winner,null);
  assert.deepEqual(C.reward(f.room,G),before);
  assert.equal(g.contract.cues.filter(c=>c.type === "failed" && c.objectiveId === o.id).length,1);
  g.round+=2;C.poll(f.room,G);
  assert.equal(o.status,"failed");
});

test("friendly garrisons neither prevent PMC defeat nor block final extraction", t => {
  for (const escaped of [false,true]) {
    const f=fixture(t),g=f.room.game;
    assert(g.units.some(u=>u.contractAlly && u.hp>0));
    if(escaped)f.actor.contractExtracted=true;else f.actor.hp=0;
    C.poll(f.room,G);
    assert.equal(g.winner,escaped?0:1);
  }
});

test("rescue is absent from the event pool and newly generated contracts", t => {
  assert.equal(C.kinds.length, 7);
  assert(!C.kinds.some(kind => kind.type === "rescue"));
  const f = fixture(t);
  assert(!f.room.game.contract.objectives.some(objective => objective.type === "rescue"));
});

test('restored old rescue objectives, their cut-ins and NPCs are retired without reducing full event rewards',t=>{
 const f=fixture(t,{difficulty:2}),g=f.room.game,state=g.contract;
 const old=state.objectives[0];old.type='rescue';old.name='救援失联小队';
 const npc=G.makeUnit({unitId:'RGM_79',kitId:'machine_gun'},0,'old-rescue-npc',{x:old.x,y:old.y});
 npc.contractAlly=true;npc.contractObjective=old.id;g.units.push(npc);old.protected=[npc.id];
 state.cues.push({id:++state.cueSerial,type:'started',objectiveId:old.id,name:old.name});
 f.engine.broadcast(f.room);
 assert(!state.objectives.some(o=>o.type==='rescue'));
 assert(!f.frames.get(f.clients[0]).contract.objectives.some(o=>o.type==='rescue'));
 assert(!state.cues.some(c=>c.objectiveId===old.id));assert(npc.contractExtracted);assert(!G.onMap(npc));
 const count=state.objectives.length;C.poll(f.room,G);assert.equal(state.objectives.length,count);
 for(const objective of state.objectives)objective.status='completed';
 assert.equal(C.reward(f.room,G).money,4000*1.25/require('../shared/battle-economy').completionRewardMultiplier);
});

test("scripted event targets can use a unit that is not unlocked by the technology tree", t => {
  const task = require("../shared/contact-tasks.js").tasks.find(task => task.id === "efsf-4");
  const previous = task.targetUnits;
  t.after(() => task.targetUnits = previous);
  const model = Object.values(G.models).find(model => model.prefabId === "MS_05S");
  assert(!G.aiTechnologyAllows(model));
  task.targetUnits = [{unitId:model.prefabId, kitId:model.kitId}];
  const f = fixture(t, {difficulty:2, contactTasks:[{id:"efsf-4",status:"accepted",progress:0}]});
  const objective = f.room.game.contract.objectives.find(objective => objective.contactTaskId === task.id);
  assert.equal(objective.targets.length, 1);
  assert.equal(G.modelOf(f.room.game.units.find(unit => unit.id === objective.targets[0])).prefabId, "MS_05S");
});

test("upload progress pauses without PMC or while enemies contest its area", t => {
  const f=fixture(t,{seed:34567}),g=f.room.game,o=g.contract.objectives.find(o=>o.type === "upload");
  clearEnemies(f);moveTo(G,f.actor,o);C.poll(f.room,G);assert.equal(o.status,"active");
  const enemy=g.units.find(u=>u.team===1 && !u.facility);enemy.hp=G.modelOf(enemy).hp;moveTo(G,enemy,o);
  g.round+=2;C.poll(f.room,G);assert.equal(o.progress,0);
  clearEnemies(f);moveTo(G,f.actor,{x:0,y:0});g.round+=2;C.poll(f.room,G);assert.equal(o.progress,0);
  moveTo(G,f.actor,o);
  for(let i=0;i<3;i++){clearEnemies(f);g.round+=2;C.poll(f.room,G);}
  assert.equal(o.status,"completed");
});

test("radar has a real destructible target and sends its response only once", t => {
  const f=fixture(t,{seed:34567}),g=f.room.game,o=g.contract.objectives.find(o=>o.type === "radar");
  const radar=g.units.find(u=>u.id===o.targets[0]);
  assert.equal(G.modelOf(radar).prefabId,"Facility_Radar");
  moveTo(G,f.actor,o);C.poll(f.room,G);assert.equal(o.status,"active");
  const count=g.units.length;C.poll(f.room,G);assert.equal(g.units.length,count);
  radar.hp=0;C.poll(f.room,G);assert.equal(o.status,"completed");
});

test("friendly AI acts during the player turn and its extra seat is cleared on room return", async t => {
  const f=fixture(t,{aiDelayMs:0,roomReturnMs:0}),g=f.room.game;
  const guard=g.units.find(u=>u.contractAlly && !u.facility),origin={x:guard.x,y:guard.y};
  const deadline=Date.now()+10000;
  while(!guard.acted && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,30));
  assert(guard.acted,"autonomous guards must use their own AI turn");
  assert.deepEqual({x:guard.x,y:guard.y},origin,"unactivated guards stay at the site");
  assert.deepEqual(f.errors,[]);
  f.act(0,"return_room");
  await new Promise(resolve=>setTimeout(resolve,30));
  assert.equal(f.room.started,false);
  assert.equal(f.room.seats.length,10);
  assert(![...f.room.members.values()].some(p=>p.missionAlly));
});

test("accepted liaison events are shared, environment gated and contain their specified forces",t=>{
 const contactTasks=[2,3,4,5,6].map(n=>({id:'efsf-'+n,status:'accepted',progress:0}));
 const f=fixture(t,{difficulty:3,players:2,contactTasks:[],secondContactTasks:contactTasks}),g=f.room.game;
 const special=g.contract.objectives.filter(o=>o.contactTaskId);
 assert.equal(special.length,5);assert.equal(new Set(special.map(o=>o.contactTaskId)).size,5);
 const evidence=special.find(o=>o.contactTaskId==='efsf-3');assert.equal(evidence.targets.length,3);
 for(const id of evidence.targets){const u=g.units.find(u=>u.id===id);assert.equal(G.modelOf(u).faction,'EFSF');assert.match(u.pilot.name,/老兵/);}
 assert.equal(special.find(o=>o.contactTaskId==='efsf-4').targets.length,6);
 const camp=special.find(o=>o.contactTaskId==='efsf-5');assert.equal(camp.targets.length,4);
 assert.equal(g.units.filter(u=>u.team===1 && u.facility?.type==='mg').length,4);
 for(const o of special.filter(o=>o.type==='salvage'))assert(G.models[o.wreckModel]);
 assert.throws(()=>fixture(t,{difficulty:3,environment:'space',contactTasks}),/宇宙.*禁用/);
});
test("liaison kill credit is deduplicated, eligibility frozen at entry and persisted only on settlement receipts",t=>{
 const f=fixture(t,{difficulty:1,contactTasks:[{id:'efsf-1',status:'accepted',progress:0}]}),g=f.room.game;
 const target=g.units.find(u=>u.team===1 && G.modelOf(u).unitTags.includes('MS'));
 C.recordDefeat(f.room,G,f.actor,target,G.modelOf(target));C.recordDefeat(f.room,G,f.actor,target,G.modelOf(target));
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'efsf-1',amount:1}]);
 assert(!f.room.economyAwards.some(a=>a.contactProgress));
 clearEnemies(f);moveTo(G,f.actor,g.contract.extraction);f.act(0,'contract_extract',{unitId:f.actor.id});
 const receipt=f.room.economyAwards.find(a=>a.memberId===f.member.id&&a.kind==='result');
 assert.deepEqual(receipt.contactProgress,[{id:'efsf-1',amount:1}]);
});

test("live liaison status is recipient-private, absolute and available before settlement and after reconnect",t=>{
 const entries=[{id:'efsf-1',status:'accepted',progress:4}];
 const f=fixture(t,{difficulty:1,players:2,contactTasks:entries,secondContactTasks:[]}),g=f.room.game;
 const target=g.units.find(u=>u.team===1 && G.modelOf(u).unitTags.includes('MS'));
 C.recordDefeat(f.room,G,f.actor,target,G.modelOf(target));
 f.act(0,'wait',{unitId:f.actor.id});
 const expected=[{id:'efsf-1',status:'accepted',progress:5}];
 assert.deepEqual(f.frames.get(f.clients[0]).contactTaskStatus,expected);
 assert.deepEqual(f.frames.get(f.clients[1]).contactTaskStatus,[]);
 assert.deepEqual(f.member.contactTasks,entries);
 assert(!f.room.economyAwards.some(a=>a.contactProgress));
 const resumed={readyState:1},token=f.member.token;
 f.engine.disconnect(f.clients[0]);
 f.engine.join(resumed,{mode:'resume',room:f.room.code,token,characterFaction:'PMC'});
 assert.deepEqual(f.frames.get(resumed).contactTaskStatus,expected);
 assert.deepEqual(C.commissionStatus(f.room,G,f.member),expected);
 const another=g.units.find(u=>u.team===1 && u!==target && G.modelOf(u).unitTags.includes('MS'));
 C.recordDefeat(f.room,G,f.actor,another,G.modelOf(another));
 assert.deepEqual(C.commissionStatus(f.room,G,f.member),[{id:'efsf-1',status:'ready',progress:6}]);
 assert.deepEqual(C.commissionStatus(f.room,G,{seat:null,contactTasks:entries}),[]);
});

test("live liaison factory progress updates per target while recovery still requires personal extraction",t=>{
 const f=fixture(t,{difficulty:3,contactTasks:[{id:'efsf-2',status:'accepted',progress:0},{id:'efsf-5',status:'accepted',progress:0}]}),g=f.room.game;
 const salvage=g.contract.objectives.find(o=>o.contactTaskId==='efsf-2'),camp=g.contract.objectives.find(o=>o.contactTaskId==='efsf-5');
 salvage.status='completed';
 const first=g.units.find(u=>u.id===camp.targets[0]);first.hp=0;first.contactPaleKill=true;
 assert.deepEqual(C.commissionStatus(f.room,G,f.member).map(e=>e.progress),[0,1]);
 f.actor.contractExtracted=true;
 assert.deepEqual(C.commissionStatus(f.room,G,f.member),[
  {id:'efsf-2',status:'ready',progress:1},{id:'efsf-5',status:'accepted',progress:1}]);
});

test("Picnic liaison targets spawn as two squads with two Zaku Fs and one Zaku S each",t=>{
 const f=fixture(t,{difficulty:2,contactTasks:[{id:'efsf-4',status:'accepted',progress:0}]}),g=f.room.game;
 const objective=g.contract.objectives.find(o=>o.contactTaskId==='efsf-4');
 assert.equal(objective.targets.length,6);
 const units=objective.targets.map(id=>g.units.find(u=>u.id===id));
 assert.equal(new Set(units.map(u=>u.squadId)).size,2);
 for(const u of units){
  const members=G.squadMembers(g,u);assert.equal(members.length,3);assert(G.squadFits(members,g));
  assert(members.every(other=>other.x===u.x&&other.y===u.y&&objective.targets.includes(other.id)));
  assert.equal(members.filter(other=>G.modelOf(other).prefabId==='MS_06F').length,2);
  assert.equal(members.filter(other=>G.modelOf(other).prefabId==='MS_06S').length,1);
 }
});

test("ordinary contract guards pack compatible units into legal squads within their own event",t=>{
 const f=fixture(t,{difficulty:6,players:5}),g=f.room.game;
 for(const u of g.units.filter(u=>u.team===1&&!u.facility)){
  const members=G.squadMembers(g,u);assert(members.length<=3);assert(G.squadFits(members,g));
  assert(members.every(other=>other.x===u.x&&other.y===u.y));
  const targetEvent=g.contract.objectives.find(o=>o.targets.includes(u.id));
  if(targetEvent)assert(members.every(other=>targetEvent.targets.includes(other.id)));
 }
 assert(g.units.some(u=>u.team===1&&G.squadMembers(g,u).length>1));
});
test("liaison recovery requires personal extraction and the camp must be destroyed by Pale Rider",t=>{
 const f=fixture(t,{difficulty:3,contactTasks:[{id:'efsf-2',status:'accepted',progress:0},{id:'efsf-5',status:'accepted',progress:0}]}),g=f.room.game;
 const salvage=g.contract.objectives.find(o=>o.contactTaskId==='efsf-2'),camp=g.contract.objectives.find(o=>o.contactTaskId==='efsf-5');
 salvage.status='completed';camp.status='completed';
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[]);
 const p=G.catalog.prefabs.find(p=>p.id==='RX_80PR'),pale=G.makeUnit({unitId:p.id,kitId:p.weaponKits[0].id},0,'pale',{x:2,y:2});pale.ownerSeat=0;
 const first=g.units.find(u=>u.id===camp.targets[0]);first.hp=0;C.recordDefeat(f.room,G,pale,first,G.modelOf(first));
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'efsf-5',amount:1}]);
 for(const id of camp.targets){const target=g.units.find(u=>u.id===id);target.hp=0;C.recordDefeat(f.room,G,pale,target,G.modelOf(target));}
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'efsf-5',amount:4}]);
 f.actor.contractExtracted=true;
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'efsf-2',amount:1},{id:'efsf-5',amount:4}]);
});

test("no-allies contracts spawn independent factions with a shared patrol stream and NPC action phase",t=>{
 const f=fixture(t,{difficulty:4,faction:'NONE'}),g=f.room.game;
 assert(g.contract.noAllies);assert.deepEqual(g.contract.enemyFactions,['EFSF','ZEON']);
 assert.equal(f.room.settings.sweepFaction,'NONE');
 assert(g.units.some(u=>u.team===1));assert(g.units.some(u=>u.team===2));
 assert(!g.units.some(u=>u.contractAlly));
 assert(g.contract.objectives.every(o=>['EFSF','ZEON'].includes(o.enemyFaction)));
 const npc=g.units.find(u=>u.team===2&&!G.modelOf(u).facility);assert(npc);
 npc.acted=true;npc.moved=true;g.team=0;G.end(g);
 assert.equal(g.team,1);assert.equal(npc.acted,false);assert.equal(npc.moved,false);
 assert(G.isUnitTurn(g,npc));G.wait(g,npc,true);assert(npc.acted);
});

test("Anaheim no-allies events use their own faction and do not credit enemy crossfire",t=>{
 const contactTasks=['anaheim-4','anaheim-6','anaheim-7','anaheim-9','anaheim-10'].map(id=>({id,status:'accepted',progress:0}));
 const f=fixture(t,{difficulty:6,faction:'NONE',contactTasks}),g=f.room.game;
 for(const id of contactTasks.map(t=>t.id))assert.equal(g.contract.objectives.filter(o=>o.contactTaskId===id).length,1);
 const command=g.contract.objectives.find(o=>o.contactTaskId==='anaheim-7');
 assert(command.targets.every(id=>g.units.find(u=>u.id===id).team===command.enemyTeam));
 assert(command.targets.every(id=>g.units.find(u=>u.id===id).pilot.genericGrade==='elite'));
 const target=g.units.find(u=>u.id===command.targets[0]),killer=g.units.find(u=>u.team>0&&u.team!==target.team&&!u.facility);
 target.hp=0;C.recordDefeat(f.room,G,killer,target,G.modelOf(target));
 assert(!target.contractPlayerDefeat);assert.equal(g.contract.contactKillRecords?.length||0,0);
 for(const id of command.targets.slice(1)) {const u=g.units.find(u=>u.id===id);u.hp=0;C.recordDefeat(f.room,G,f.actor,u,G.modelOf(u));}
 C.poll(f.room,G);f.actor.contractExtracted=true;
 assert.equal(command.status,'failed');assert(!C.commissionProgress(f.room,G,f.member).some(e=>e.id==='anaheim-7'));
 assert(!f.room.economyAwards?.some(a=>['kill','assist'].includes(a.kind)));
});

test("Anaheim test kills require the fitted part or test hull and only player final blows",t=>{
 const contactTasks=['anaheim-3','anaheim-5','anaheim-8'].map(id=>({id,status:'accepted',progress:0}));
 const f=fixture(t,{difficulty:4,faction:'NONE',contactTasks}),g=f.room.game;
 const unit=(unitId,id,team=0,plugins=[])=>{const p=G.catalog.prefabs.find(p=>p.id===unitId);const u=G.makeUnit({unitId,kitId:p.weaponKits[0].id,plugins},team===0?0:1,id,{x:4,y:4});u.team=team;u.ownerSeat=team===0?0:1;g.units.push(u);return u;};
 const normal=unit('RGM_79','no-part'),frame=unit('RGM_79','frame-user',0,['frame']),armor=unit('RGM_79','armor-user',0,['chobham']),hull=unit('RX_79_G','test-hull');
 for(const [from,id] of [[normal,'plain'],[frame,'frame'],[armor,'armor'],[hull,'hull']]){
  const target=unit('MS_06F','target-'+id,2);target.hp=0;C.recordDefeat(f.room,G,from,target,G.modelOf(target));
 }
 const npc=unit('RGM_79','npc',1,['frame']),target=unit('MS_06F','npc-target',2);target.hp=0;C.recordDefeat(f.room,G,npc,target,G.modelOf(target));
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'anaheim-3',amount:1},{id:'anaheim-5',amount:1},{id:'anaheim-8',amount:1}]);
});

test("no-allies patrol cap is shared at 110 percent and patrols stay around their own sites",t=>{
 const f=fixture(t,{difficulty:6,faction:'NONE'}),g=f.room.game;
 for(let i=0;i<160;i++){g.team=0;g.round+=2;C.poll(f.room,G);}
 const alive=g.units.filter(u=>u.contractReinforcement&&u.hp>0);
 assert(alive.length<=Math.floor(C.config(6).patrolLimit*1.1));
 assert(g.contract.patrolBaseWaves>10);
 const far={...f.actor,x:1,y:1};g.units=[far,...g.units.filter(u=>u.team>0)];
 const patrols=g.units.filter(u=>u.contractReinforcement&&!u.facility);
 for(const u of patrols.slice(0,8)){
  const sites=g.contract.objectives.filter(o=>o.enemyFaction===u.contractFaction);if(!sites.length)continue;
  // Remove sensory contact so the local route, rather than a combat chase, is tested.
  const saved=g.units;g.units=[u];const order=C.aiOrder(g,G,u);g.units=saved;
  assert(order);assert.equal(order.alerted,false);
  assert(sites.some(o=>Math.abs(order.goal.x-o.x)<=5&&Math.abs(order.goal.y-o.y)<=5));
 }
});

test("no-allies 0087 supports three independently hostile NPC factions",t=>{
 const f=fixture(t,{difficulty:6,faction:'NONE',era:'UC_0087_T1'}),g=f.room.game;
 assert.deepEqual(g.contract.enemyFactions,['TITANS','AEUG','NEO_ZEON'].filter(f=>G.factions.includes(f)).sort((a,b)=>G.factions.indexOf(a)-G.factions.indexOf(b)));
 assert([1,2,3].every(team=>g.units.some(u=>u.team===team)));
});

test("server resolves NPC-versus-NPC fire without awarding player kills or assist experience",async t=>{
 const f=fixture(t,{difficulty:4,faction:'NONE',aiDelayMs:0,contactTasks:[{id:'anaheim-3',status:'accepted',progress:0}]}),g=f.room.game;
 const source=g.units.find(u=>u.team===2&&!u.facility),target=g.units.find(u=>u.team===1&&!u.facility);
 source.model=Object.keys(G.models).find(id=>G.models[id].prefabId==='RX_77_2'&&G.models[id].weapons.some(w=>w.category==='mortar'));
 Object.assign(source,{x:5,y:5,hp:G.modelOf(source).hp,en:10000,pilot:null,acted:false,moved:false,flying:false});
 Object.assign(target,{model:'RGM_79__beam_spray',x:8,y:5,hp:1,shield:0,pilot:null,flying:false});
 f.actor.pilot=G.pilots.createCustom('custom-crossfire','Observer');
 const experience=f.actor.pilot.experience;
 Object.assign(f.actor,{x:1,y:1});
 g.units=[f.actor,source,target];g.contract.objectives=[];g.tiles.forEach(row=>row.fill('plain'));
 g.team=1;f.room.turnDone[0]=true;f.room.turnDone[1]=false;
 f.room.pilotDamage={[target.id]:{observer:{seat:0,pilotId:f.actor.pilot.id,damage:1000000}}};
 const mortar=G.modelOf(source).weapons.find(w=>w.category==='mortar'),bot=f.room.seats[1];
 const request=(action,fields={})=>f.engine.action(bot.ws,{id:'npc-'+action,revision:f.room.revision,round:g.round,phase:f.room.phase,matchId:f.room.matchId,action,...fields});
 request('attack',{unitId:source.id,targetId:target.id,weaponId:mortar.id,weaponIds:[mortar.id],single:true});
 request('end_turn');
 const deadline=Date.now()+6000;while(target.hp>0&&Date.now()<deadline)await new Promise(r=>setTimeout(r,30));
 assert.equal(target.hp,0,JSON.stringify({phase:f.room.phase,plans:f.room.plans,pending:f.room.pending,responses:f.room.responses,errors:f.errors,log:f.room.log.slice(0,5)}));assert(!target.contractPlayerDefeat);
 assert.equal(f.actor.pilot.experience,experience);assert.equal(g.contract.contactKillRecords?.length||0,0);
 assert(!f.room.economyAwards?.some(a=>['kill','assist'].includes(a.kind)));
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'anaheim-3',amount:0}]);
 assert.equal(f.room.playback?.members.length||0,0,'NPC-only combat must not wait on human playback');
 const handoff=Date.now()+3000;while(g.team!==0&&Date.now()<handoff)await new Promise(r=>setTimeout(r,20));
 assert.equal(g.team,0,'NPC-only combat advances to the player phase without a playback acknowledgement');
});

test("Zeon special commissions spawn once for teammates, with specified squads and wrecks",t=>{
 const ids=['zeon-2','zeon-3','zeon-4','zeon-5','zeon-6','zeon-7','zeon-9'];
 const contactTasks=ids.map(id=>({id,status:'accepted',progress:0}));
 const f=fixture(t,{difficulty:3,faction:'EFSF',players:2,contactTasks,secondContactTasks:contactTasks}),g=f.room.game;
 const special=g.contract.objectives.filter(o=>o.contactTaskId?.startsWith('zeon-'));
 assert.equal(special.length,7);assert.equal(new Set(special.map(o=>o.contactTaskId)).size,7);
 for(const [id,count,unit] of [['zeon-3',3,'MS_06F'],['zeon-4',6,'RGM_79_E'],['zeon-7',3,null]]){
  const o=special.find(o=>o.contactTaskId===id);assert.equal(o.targets.length,count);
  const targets=o.targets.map(id=>g.units.find(u=>u.id===id));assert(targets.every(u=>(!unit||G.modelOf(u).prefabId===unit)&&u.team===1));
  assert(targets.every(u=>G.squadMembers(g,u).length===3));
  if(id==='zeon-7'){
   assert.deepEqual(targets.map(u=>G.modelOf(u).prefabId),['MS_14A','MS_06F2','MS_06F2']);
   assert.deepEqual(targets.map(u=>u.pilot.genericGrade),['ace','veteran','veteran']);
   assert(targets[0].pilot.missionDialogue.attack.length);
  }else if(id!=='zeon-4')assert(targets.every(u=>u.pilot.genericGrade==='veteran'));
 }
 assert.equal(special.find(o=>o.contactTaskId==='zeon-5').targets.length,4);
 assert.equal(special.find(o=>o.contactTaskId==='zeon-9').targets.length,1);
 assert(special.find(o=>o.contactTaskId==='zeon-2').wreckModel.startsWith('FatUncle__'));
 assert(special.find(o=>o.contactTaskId==='zeon-6').wreckModel.startsWith('SamsonGroundTransportTruck__'));
 const wrong=fixture(t,{difficulty:3,contactTasks});
 assert(!wrong.room.game.contract.objectives.some(o=>o.contactTaskId?.startsWith('zeon-')));
});

test("Peace Statistics requires N5 against Zeon and all six elite squad targets",t=>{
 const task=require('../shared/contact-tasks').byId.get('zeon-8');
 assert.equal(task.kind,'command');assert.equal(task.required,1);
 const contactTasks=[{id:'zeon-8',status:'accepted',progress:0}];
 const f=fixture(t,{difficulty:5,faction:'ZEON',contactTasks}),g=f.room.game;
 const o=g.contract.objectives.find(o=>o.contactTaskId==='zeon-8');assert(o);assert.equal(o.targets.length,6);
 const targets=o.targets.map(id=>g.units.find(u=>u.id===id));
 assert.deepEqual(targets.map(u=>G.modelOf(u).prefabId),['MS_11S',...Array(5).fill('MS_11')]);
 assert.deepEqual(targets.map(u=>u.pilot.genericGrade),['ace',...Array(5).fill('elite')]);
 assert(targets.every(u=>u.team===1&&G.squadMembers(g,u).length===3));
 const D=require('../client/battle-dialogue');
 for(const event of ['attack','hit','miss','kill','defeat','taunt','reply']){
  const records=Array.from({length:300},(_,sequence)=>D.generate({event,speaker:targets[0],sequence})).filter(Boolean);
  assert(records.length,event);assert(records.every(r=>task.targetLeaderPilot.dialogue[event].includes(r.text)),event);
 }
 targets.slice(0,5).forEach(u=>u.hp=0);C.poll(f.room,G);
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[]);
 targets[5].hp=0;C.poll(f.room,G);
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'zeon-8',amount:1}]);
 for(const settings of [{difficulty:4,faction:'ZEON'},{difficulty:5,faction:'EFSF'}]){
  const wrong=fixture(t,{...settings,contactTasks});
  assert(!wrong.room.game.contract.objectives.some(o=>o.contactTaskId==='zeon-8'));
 }
});

test("Zeon commission progress filters enemy faction, melee, test hull, and personal extraction live",t=>{
 const contactTasks=['zeon-1','zeon-5','zeon-6','zeon-10'].map(id=>({id,status:'accepted',progress:0}));
 const f=fixture(t,{difficulty:4,faction:'EFSF',contactTasks}),g=f.room.game;
 const unit=(id,name)=>{const p=G.catalog.prefabs.find(p=>p.id===id);const u=G.makeUnit({unitId:id,kitId:p.weaponKits[0].id},0,name,{x:2,y:2});u.ownerSeat=0;return u;};
 const testHull=unit('MS_11S','test-zaku'),other=unit('MS_06F','other-zaku');
 const camp=g.contract.objectives.find(o=>o.contactTaskId==='zeon-5'),recovery=g.contract.objectives.find(o=>o.contactTaskId==='zeon-6');
 const first=g.units.find(u=>u.id===camp.targets[0]);first.hp=0;C.recordDefeat(f.room,G,other,first,G.modelOf(first));
 const second=g.units.find(u=>u.id===camp.targets[1]);second.hp=0;C.recordDefeat(f.room,G,testHull,second,G.modelOf(second));
 const cannon=G.modelOf(testHull).weapons.find(w=>w.type==='melee');
 assert(cannon);
 const enemy=unit('RGM_79','federal');enemy.id='zeon-credit-enemy';enemy.team=1;g.units.push(enemy);enemy.hp=0;
 C.recordDefeat(f.room,G,testHull,enemy,G.modelOf(enemy),cannon);C.recordDefeat(f.room,G,testHull,enemy,G.modelOf(enemy),cannon);
 for(const [id,hull,weapon] of [
  ['ranged-federal','RGM_79',{type:'shell'}],
  ['artillery-federal','RGM_79',{type:'shell',slot:'skill',special:'mortar',category:'mortar'}],
  ['melee-zeon','MS_06F',cannon],
  ['melee-plane','FF_B2',cannon]
 ]){
  const target=unit(hull,id);target.team=1;target.hp=0;g.units.push(target);
  C.recordDefeat(f.room,G,testHull,target,G.modelOf(target),weapon);
 }
 recovery.status='completed';
 const result=new Map(C.commissionProgress(f.room,G,f.member).map(e=>[e.id,e.amount]));
 assert.equal(result.get('zeon-1'),3);assert.equal(result.get('zeon-5'),1);assert.equal(result.get('zeon-10'),1);assert(!result.has('zeon-6'));
 assert.equal(C.commissionStatus(f.room,G,f.member).find(e=>e.id==='zeon-5').progress,1);
 f.actor.contractExtracted=true;assert(C.commissionProgress(f.room,G,f.member).some(e=>e.id==='zeon-6'&&e.amount===1));
});

test("planning 1.21 spawns Renass with an ACE ground Gundam and two veteran GMs only against EFSF",t=>{
 const contactTasks=[{id:'efsf-7',status:'accepted',progress:0}];
 const f=fixture(t,{difficulty:3,faction:'EFSF',players:2,contactTasks,secondContactTasks:contactTasks}),g=f.room.game;
 const events=g.contract.objectives.filter(o=>o.contactTaskId==='efsf-7');assert.equal(events.length,1);
 const o=events[0];assert.equal(o.targets.length,3);
 const models=o.targets.map(id=>G.modelOf(g.units.find(u=>u.id===id)));
 assert.deepEqual(models.map(m=>m.prefabId),['RX_79_G','RGM_79_G','RGM_79_G']);
 assert.deepEqual(models.map(m=>m.kitId),['beam_rifle','machine_gun','bazooka']);
 assert.deepEqual(o.targets.map(id=>g.units.find(u=>u.id===id).pilot.genericGrade),['ace','veteran','veteran']);
 assert.match(g.units.find(u=>u.id===o.targets[0]).pilot.name,/ACE.*不死的雷纳斯/);
 assert(g.units.find(u=>u.id===o.targets[0]).pilot.missionDialogue.attack.length);
 g.units.find(u=>u.id===o.targets[0]).hp=0;C.poll(f.room,G);
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[]);
 for(const id of o.targets)g.units.find(u=>u.id===id).hp=0;C.poll(f.room,G);
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'efsf-7',amount:1}]);
 const wrong=fixture(t,{difficulty:3,contactTasks});assert(!wrong.room.game.contract.objectives.some(o=>o.contactTaskId==='efsf-7'));
});

test("Past Delivery creates a defended HQ and requires the accepting player to extract",t=>{
 const f=fixture(t,{difficulty:3,contactTasks:[{id:'efsf-9',status:'accepted',progress:0}]}),g=f.room.game;
 const o=g.contract.objectives.find(o=>o.contactTaskId==='efsf-9');assert(o);assert.equal(o.type,'enemybase');assert.equal(o.targets.length,1);
 const core=g.units.find(u=>u.id===o.targets[0]);assert.equal(core.facility.type,'hq');assert.equal(core.hp,30000);
 assert.equal(g.units.filter(u=>u.team===1&&u.facility?.type==='mg').length,4);
 core.hp=0;C.poll(f.room,G);assert.equal(o.status,'completed');
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[]);
 f.actor.contractExtracted=true;assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'efsf-9',amount:1}]);
 const no=fixture(t,{difficulty:3,environment:'space',contactTasks:[{id:'efsf-9',status:'accepted',progress:0}]});
 assert(!no.room.game.contract.objectives.some(o=>o.contactTaskId==='efsf-9'));
});

test("50-kill and artillery commissions share deduplicated kills but exclude ordinary cannons and friendly fire",t=>{
 const contactTasks=[{id:'efsf-8',status:'accepted',progress:0},{id:'efsf-10',status:'accepted',progress:0}];
 const f=fixture(t,{difficulty:4,contactTasks}),g=f.room.game;
 const targets=g.units.filter(u=>u.team===1&&!u.facility&&G.modelOf(u).unitTags?.includes('MS'));
 assert(targets.length>=3);
 const mortar=Object.values(G.models).flatMap(m=>m.weapons).find(w=>w.slot==='skill'&&w.category==='mortar');assert(mortar);
 const cannon={category:'cannon',type:'shell',slot:'weapon',sourceName:'Common_Cannon'};
 C.recordDefeat(f.room,G,f.actor,targets[0],G.modelOf(targets[0]),mortar);
 C.recordDefeat(f.room,G,f.actor,targets[0],G.modelOf(targets[0]),mortar);
 C.recordDefeat(f.room,G,f.actor,targets[1],G.modelOf(targets[1]),cannon);
 C.recordDefeat(f.room,G,f.actor,{...targets[2],team:0},G.modelOf(targets[2]),mortar);
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'efsf-8',amount:2},{id:'efsf-10',amount:1}]);
 const lower=fixture(t,{difficulty:3,contactTasks});assert(!C.commissionProgress(lower.room,G,lower.member).some(e=>e.id==='efsf-10'));
});

test("an actual server-resolved mortar kill carries its weapon into commission credit", async t=>{
 const f=fixture(t,{difficulty:4,aiDelayMs:0,contactTasks:[{id:'efsf-10',status:'accepted',progress:0}]}),g=f.room.game;
 const source=f.actor,target=g.units.find(u=>u.team===1&&!u.facility&&G.modelOf(u).unitTags?.includes('MS'));
 source.model=Object.keys(G.models).find(id=>G.models[id].prefabId==='RX_77_2'&&G.models[id].weapons.some(w=>w.category==='mortar'));
 Object.assign(source,{x:5,y:5,hp:G.modelOf(source).hp,en:10000,pilot:null,acted:false,moved:false});
 Object.assign(target,{x:8,y:5,hp:1,shield:0,pilot:null});
 g.units=[source,target];g.tiles.forEach(row=>row.fill('plain'));
 const mortar=G.modelOf(source).weapons.find(w=>w.category==='mortar');
 f.act(0,'attack',{unitId:source.id,targetId:target.id,weaponId:mortar.id,weaponIds:[mortar.id],single:true});
 f.act(0,'end_turn');
 const deadline=Date.now()+5000;
 while(f.room.phase!=='playback' && Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
 assert.deepEqual(f.errors,[]);assert.equal(f.room.phase,'playback');assert.equal(target.hp,0);
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'efsf-10',amount:1}]);
});
test("era budgets scale every difficulty cumulatively while fleet limits and event counts stay fixed", () => {
  const eras = ["UC_0079_T1", "UC_0079_T2", "UC_0087_T1", "UC_0087_T2", "UC_0093_T1"];
  assert.deepEqual(eras.map(era=>C.config(1,era).costLimit),[3000,4500,6000,6750,9000]);
  assert.deepEqual([1,2,3,4,5,6].map(n=>C.config(n).costLimit),[3000,4500,6000,9000,12000,15000]);
  assert.deepEqual([1,2,3,4,5,6].map(n=>C.config(n,"UC_0079_T2").costLimit),[4500,6750,9000,13500,18000,22500]);
  for (let n = 1; n <= 6; n++) {
    for (const [stage, era] of eras.entries()) {
      const d = C.config(n, era), settings = C.roomSettings({ sweepDifficulty: n, sweepEra: era, sweepEnvironment: "ground" });
      const scale=stage>0?1.5*1.25**(stage-1):1;
      assert.equal(d.costLimit, Math.round(C.config(n).costLimit / 1.5 * scale / 500) * 500 * 1.5);
      assert.equal(d.costLimit % 250,0);
      assert.equal(settings.costLimit, d.costLimit);
      assert.equal(d.events, n);
      assert.equal(d.fleetLimit, C.config(n).fleetLimit);
      assert.equal(d.fleetLimit, 3 + Math.floor((n - 1) / 3));
      if (n > 1) {
        assert(d.width > C.config(n - 1).width);
        assert(d.height > C.config(n - 1).height);
      }
    }
  }
});
test("enemy factions belong to their selected timeline and era, including cross-tagged imports", () => {
  for (const era of ["UC_0079_T1", "UC_0079_T2"])
    assert.deepEqual(C.factionsForEra(G, era).sort(), ["EFSF", "ZEON"]);
  for (const era of ["UC_0087_T1", "UC_0087_T2"]) {
    const factions = C.factionsForEra(G, era);
    assert(factions.includes("AEUG") && factions.includes("TITANS"));
    assert(factions.every((f) => ["AEUG", "TITANS", "NEO_ZEON"].includes(f)));
  }
  assert(C.factionsForEra(G, "CE_0071_T1").every((f) => ["OMNI", "ZAFT"].includes(f)));
  assert(C.factionsForEra(G, "UC_0093_T1").every((f) => ["EFSF_0093", "NEO_ZEON_0093"].includes(f)));
});

test("contract technology phases follow the selected faction and era rather than kit COST", () => {
  const room={settings:{sweepEra:"UC_0079_T1",sweepFaction:"ZEON"}};
  for(const [id,stage] of [["MS_06F",0],["MS_06G",0],["MS_09",1],["MS_06F2",1]]) {
    const models=Object.values(G.models).filter(model=>model.prefabId===id);
    assert(models.length);
    for(const model of models) {
      assert.equal(C.enemyStage(room,G,model),stage);
      assert.equal(C.enemyStage(room,G,{...model,cost:999999}),stage);
    }
  }
  room.settings.sweepEra="UC_0079_T2";
  assert.equal(C.enemyStage(room,G,G.models.MS_14A__beam_rifle),0,"the next era starts a fresh progression band");
});

test("era milestones split T1 at Operation V and T2 at GM Kai while later eras remain locked",()=>{
 const model=id=>Object.values(G.models).find(m=>m.prefabId===id);
 const room={settings:{sweepEra:'UC_0079_T1',sweepFaction:'EFSF'}};
 for(const [id,stage] of [['RGM_79_G',0],['RX_78_1',1],['RGM_79',1]])assert.equal(C.enemyStage(room,G,model(id)),stage,id);
 room.settings.sweepEra='UC_0079_T2';
 for(const [id,stage] of [['RX_78NT_1',0],['RGM_79C',1],['RGM_79N',1]])assert.equal(C.enemyStage(room,G,model(id)),stage,id);
 assert.deepEqual(C.difficulties.map(d=>d.id),[1,2,3,4,5,6]);
 for(const n of [7,8,9]){
  assert.throws(()=>C.config(n),/合约难度无效/);
  assert.throws(()=>C.generateMap(G.catalog,{sweepDifficulty:n,sweepEnvironment:'ground'},1),/合约难度无效/);
  assert(!G.catalog.maps['contract_ground_n'+n]);assert(!G.catalog.maps['contract_space_n'+n]);
 }
 assert.doesNotThrow(()=>G.validateOpenContent({mode:'sweep',sweepDifficulty:6,sweepEra:'UC_0079_T2'}));
 assert.throws(()=>G.validateOpenContent({mode:'sweep',sweepDifficulty:6,sweepEra:'UC_0087_T1'}),/仅开放/);
});

test("N1-N3 draw only early units and N4-N6 draw only late units", () => {
  for(const faction of ["EFSF","ZEON"]) for(let difficulty=1;difficulty<=6;difficulty++) {
    const room={settings:{sweepEra:"UC_0079_T1",sweepFaction:faction,sweepEnvironment:"ground",sweepDifficulty:difficulty}};
    for(let sample=1;sample<=500;sample++) for(const item of C.enemies(room,G,Math.imul(sample,0x9e3779b1)>>>0))
      assert.equal(C.enemyStage(room,G,G.models[item.unitId+"__"+item.kitId]),difficulty<=3?0:1);
  }
});

test("0079T1 N1-N3 Zeon combat pools favor Zaku and tanks with a minority of aircraft", () => {
  for (const difficulty of [1, 2, 3]) {
    const room = { settings: { sweepEra: "UC_0079_T1", sweepFaction: "ZEON", sweepEnvironment: "ground", sweepDifficulty: difficulty } };
    const counts = { ms: 0, tank: 0, aircraft: 0 }, ids = new Set();
    for (let seed = 1; seed <= 500; seed++) for (const entry of C.enemies(room, G, Math.imul(seed, 0x9e3779b1) >>> 0)) {
      const model = G.models[entry.unitId + "__" + entry.kitId];
      const tags = model.unitTags;
      assert(!tags.some(tag => ["Support", "Transport", "Infantry"].includes(tag)), model.prefabId);
      const role = tags.includes("MS") ? "ms" : tags.includes("Tank") ? "tank" : "aircraft";
      if (role === "ms") assert(/^MS_0[56]/.test(model.prefabId), model.prefabId);
      if (role === "aircraft") assert(tags.includes("Aircraft") && !tags.includes("Recon"));
      counts[role]++;
      ids.add(model.prefabId);
    }
    assert(counts.ms > 550 && counts.tank > 150 && counts.aircraft > 30 && counts.aircraft < 150, JSON.stringify(counts));
    for (const id of ["MS_05", "MS_06F", "MS_06J", "MS_06K", "MTank", "MTank_Eins", "Dopp"])
      assert(ids.has(id), id);
  }
});

for (const difficulty of [1, 2, 3]) for (const [type, seed] of [["capture", 11], ["defend", 4]])
  test(`N${difficulty} ${type} event waves spawn fighting formations instead of supply vehicles`, t => {
    const f = fixture(t, { difficulty, seed }), g = f.room.game;
    const objective = g.contract.objectives.find(o => o.type === type);
    assert(objective, type);
    clearEnemies(f);
    moveTo(G, f.actor, { x: objective.x + 1, y: objective.y });
    const before = new Set(g.units.map(u => u.id));
    C.poll(f.room, G);
    for (let turn = 0; turn < 4; turn++) { g.round += 2; C.poll(f.room, G); }
    const arrivals = g.units.filter(u => u.team === 1 && !before.has(u.id));
    assert(arrivals.length, "event reinforcements arrived");
    for (const unit of arrivals) {
      const model = G.modelOf(unit), tags = model.unitTags;
      assert(!tags.some(tag => ["Support", "Transport", "Infantry"].includes(tag)), model.prefabId);
      assert(tags.includes("MS") ? /^MS_0[56]/.test(model.prefabId) : tags.includes("Tank") || tags.includes("Aircraft"), model.prefabId);
      assert.equal(C.enemyStage(f.room, G, model), 0);
      assert(C.suitableEnvironment(model, "ground"));
    }
  });

test("phase pools retain era, faction and environment restrictions across the complete catalog", () => {
  for(const era of G.eras) for(const faction of C.factionsForEra(G,era))
    for(const environment of ["ground","space"]) for(const difficulty of [1,4]) {
      const room={settings:{sweepEra:era,sweepFaction:faction,sweepEnvironment:environment,sweepDifficulty:difficulty}};
      for(let seed=1;seed<=12;seed++) for(const item of C.enemies(room,G,Math.imul(seed,0x9e3779b1)>>>0)) {
        const model=G.models[item.unitId+"__"+item.kitId],stage=C.enemyStage(room,G,model);
        assert(G.aiTechnologyAllows(model, faction), `${faction}: ${model.prefabId}`);
        assert(model.tags.includes(era));
        assert((model.availableFactions||[model.faction]).includes(faction));
        assert(C.suitableEnvironment(model,environment));
        assert(stage===(difficulty<=3?0:1),
          JSON.stringify({era,faction,environment,difficulty,id:model.prefabId,stage}));
      }
    }
});

for(const difficulty of [1,4]) test(`N${difficulty} garrisons, roaming waves and transported passengers share the phase filter`,t=>{
  const f=fixture(t,{difficulty}),g=f.room.game;
  const check=()=>{
    for(const unit of g.units.filter(unit=>unit.team===1&&!unit.facility&&!G.isFleetCarrier(G.modelOf(unit)))) {
      const stage=C.enemyStage(f.room,G,G.modelOf(unit));
      assert(stage===(difficulty<=3?0:1));
    }
  };
  check();
  const salvage=g.contract.objectives.find(o=>o.type==="salvage");
  if(salvage) {
    moveTo(G,f.actor,salvage);
    C.action(f.room,G,f.member,{action:"contract_interact",unitId:f.actor.id,objectiveId:salvage.id});
  }
  for(let turn=0;turn<4;turn++){g.round+=2;C.poll(f.room,G);}
  check();
});
test("server applies era budget through deployment and rejects enemy factions from another era", (t) => {
  const f = fixture(t, { difficulty: 1, era: "UC_0087_T2", faction: "TITANS", validateEraRules: true });
  assert.equal(f.room.settings.costLimit, 4500);
  assert.equal(f.frames.get(f.clients[0]).contract.difficulty.costLimit, 4500);
});
for (const environment of ["ground", "space"])
  for (const difficulty of [1, 2, 3, 4, 5, 6])
    test(`${environment} difficulty ${difficulty}: direct deployment and ${C.config(difficulty).events} events`, (t) => {
      const f = fixture(t, { difficulty, environment }),
        s = f.room.game.contract;
      assert.equal(s.objectives.length, difficulty);
      assert.equal(new Set(s.objectives.map((o) => o.type)).size, Math.min(C.kinds.length, s.objectives.length));
      assert.equal(f.room.game.mapId, C.mapId(environment, difficulty));
      assert.equal(f.engine.roomList()[0].capacity, 5);
      assert.equal(f.engine.roomList()[0].players, 1);
      assert(!G.catalog.maps.battlefield_sweep);
      assert.equal(
        G.getMap(f.room.game.mapId).deploymentAreas.filter((_, i) => i % 2 === 0).length,
        5,
      );
      assert.equal(f.frames.get(f.clients[0]).contract.seed, undefined);
      assert.equal(f.frames.get(f.clients[0]).game.contract.seed, undefined);
      for (const o of s.objectives.filter((o) => ["factory", "command"].includes(o.type)))
        assert(o.targets.length);
      const ids = new Set();
      for (let i = 0; i < 30; i++)
        for (const e of C.enemies(f.room, G, i)) {
          ids.add(e.unitId);
          const m = G.models[e.unitId + "__" + e.kitId];
          assert(m.tags.includes(f.room.settings.sweepEra));
          assert(!m.ship);
          assert(C.suitableEnvironment(m, environment));
        }
      assert(ids.size > 1);
    });
test("contract completion budget prorates objectives before era and preview multipliers", (t) => {
  const f = fixture(t, { difficulty: 3 });
  for (const o of f.room.game.contract.objectives) o.status = "available";
  assert.deepEqual(C.reward(f.room, G), { money: 0, supplies: 0, technology: 0, experience: 0, inventory: {} });
  f.room.game.contract.objectives[0].status = "completed";
  f.room.game.contract.objectives[1].status = "completed";
  const factor = 2 * 1.5 * 1.25 * 1.2;
  assert.deepEqual(C.reward(f.room, G), { money: 4800, supplies: 6400, technology: 125 * factor, experience: 750, inventory: {} });
  f.room.settings.sweepEra = "UC_0087_T1";
  const reward = C.reward(f.room, G), era = 1.25 ** 2;
  assert.equal(reward.money, 4800 * era);
  assert(Math.abs(reward.supplies - 6400 * era) < 1e-8);
  assert.equal(reward.technology, 125 * factor * era);
  const bonuses = { money: 1.5, supplies: 2, technology: 0 };
  const pending = C.view(f.room, G, bonuses).pending;
  for (const key of Object.keys(bonuses)) assert.equal(pending[key], Math.round(reward[key] * bonuses[key] / 25) * 25);
});

test("N1-N6 full completion rewards match final budgets and partial extraction pays only its share", () => {
  const economy = require("../shared/battle-economy"),
    budgets = [[3125,4375],[5000,7500],[9000,12000],[14625,17875],[24000,30000],[35625,47500]],
    rates = economy.settlementMultipliers(economy.rewardMultipliers());
  for (let d = 1; d <= 6; d++) {
    const room = {seats:[],settings:{sweepDifficulty:d,sweepEra:"UC_0079_T1"},game:{units:[],contract:{objectives:Array.from({length:d},()=>({status:"completed"}))}}};
    const final = () => {
      const base = C.reward(room,G);
      return [economy.roundReward(base.money*rates.money),economy.roundReward(base.supplies*rates.supplies)];
    };
    assert.deepEqual(final(),budgets[d-1]);
    const preview=C.view(room,G,rates).pending;
    assert.deepEqual([preview.money,preview.supplies],budgets[d-1]);
    room.game.contract.objectives.push({status:"completed",contactTaskId:"liaison"});
    assert.deepEqual(final(),budgets[d-1]);
    room.game.contract.objectives[0].status="available";
    assert.deepEqual(final(),budgets[d-1].map(n=>economy.roundReward(n*(d-1)/d)));
  }
});

test("salvage validates range and ownership, consumes one action and cannot pay twice", (t) => {
  const f = fixture(t),
    o = f.room.game.contract.objectives.find((o) => o.type === "salvage");
  clearEnemies(f);
  assert.throws(
    () =>
      C.action(f.room, G, f.member, {
        action: "contract_interact",
        objectiveId: o.id,
        unitId: f.actor.id,
      }),
    /3×3/,
  );
  moveTo(G, f.actor, o);
  const msg = { action: "contract_interact", objectiveId: o.id, unitId: f.actor.id };
  assert.throws(() => C.action(f.room, G, { ...f.member, seat: null }, msg), /参战/);
  C.action(f.room, G, f.member, msg);
  assert.equal(o.status, "completed");
  assert(f.actor.acted);
  const before = C.reward(f.room, G);
  assert.throws(() => C.action(f.room, G, f.member, msg), /不能交互/);
  assert.deepEqual(C.reward(f.room, G), before);
  assert(!f.room.economyAwards.some((a) => a.kind === "result"));
});
test("capture activates on entry, advances once per own turn, pauses under contest and schedules scaled waves", (t) => {
  const f = fixture(t),
    g = f.room.game,
    o = g.contract.objectives.find((o) => o.type === "capture");
  clearEnemies(f);
  moveTo(G, f.actor, o);
  C.poll(f.room, G);
  assert.equal(o.status, "active");
  assert.equal(o.progress, 0);
  assert.equal(G.fits(g, f.actor, o.x, o.y), false);
  g.round += 2;
  C.poll(f.room, G);
  assert.equal(o.progress, 1);
  C.poll(f.room, G);
  assert.equal(o.progress, 1);
  const before = g.units.length;
  g.round += 2;
  C.poll(f.room, G);
  assert(!o.airdrop);
  assert.equal(g.units.length, before);
  g.round += 2;
  C.poll(f.room, G);
  assert(o.airdrop);
  assert.equal(g.units.length - before, 5);
  // Airborne defenders outside the perimeter do not prevent progress until they enter it.
  const enemy = g.units.at(-1);
  moveTo(G, enemy, o);
  const held = o.progress;
  g.round += 2;
  const waves = g.contract.wave;
  C.poll(f.room, G);
  assert.equal(o.progress, held);
  assert.equal(g.contract.wave - waves, 3); // Two objective squads plus the periodic edge patrol.
  clearEnemies(f);
  while (o.progress < 5) {
    g.round += 2;
    C.poll(f.room, G);
    clearEnemies(f);
  }
  assert.equal(o.status, "completed");
  assert.equal(C.squadCount(3), 1);
  assert.equal(C.squadCount(4), 2);
  assert.equal(C.squadCount(6), 2);
  assert.throws(()=>C.squadCount(7),/合约难度无效/);
});

test("factories have difficulty-scaled health, summon one squad per loss exactly once and alert nearby patrols on damage", (t) => {
  for (const difficulty of [1, 6]) {
    // Find a seed including factories even when N1 only selects two event kinds.
    let f, o;
    for (let seed = 10; !o; seed++) {
      f = fixture(t, { difficulty, seed });
      o = f.room.game.contract.objectives.find((o) => o.type === "factory");
    }
    const g = f.room.game,
      targets = o.targets.map((id) => g.units.find((u) => u.id === id));
    assert.equal(targets.length, difficulty === 1 ? 2 : 3);
    assert(
      targets.every((u) => u.hp === (difficulty === 1 ? 20000 : 45000) && G.modelOf(u).hp === u.hp),
    );
    // Keep players out of sensor range so damage, rather than detection, triggers awareness.
    moveTo(G, f.actor, { x: 0, y: 0 });
    const guard = g.units.find(
      (u) => u.team === 1 && !u.facility && Math.max(Math.abs(u.x - o.x), Math.abs(u.y - o.y)) < 9,
    );
    assert.equal(C.aiOrder(g, G, guard).alerted, false);
    targets[0].hp -= 1;
    C.poll(f.room, G);
    assert.equal(C.aiOrder(g, G, guard).alerted, true);
    const count = g.units.length;
    targets[0].hp = 0;
    C.poll(f.room, G);
    assert.equal(g.units.length - count, Math.round(3 * 0.75 * 1.1));
    C.poll(f.room, G);
    assert.equal(g.units.length - count, Math.round(3 * 0.75 * 1.1));
    for (const u of targets) u.hp = 0;
    C.poll(f.room, G);
    assert.equal(o.status, "completed");
    assert.equal(g.units.length - count, Math.round(targets.length * 3 * 0.75 * 1.1));
  }
});

for (const trigger of ["factory", "capture", "salvage", "guard damage"])
  test(`contract ${trigger} signals do not recruit another event's garrison`, t => {
    const f = fixture(t), g = f.room.game;
    const commands = g.contract.objectives.filter(o => o.type === "command");
    const objective = trigger === "guard damage" ? g.contract.objectives.find(o=>o.type === "factory") :
      g.contract.objectives.find(o => o.type === trigger);
    const foreign = g.units.find(u => u.id === commands[0].targets[0]);
    const own = g.units.find(u => u.team === 1 && u.id.startsWith("contract-") && !u.facility && !commands[0].targets.includes(u.id) &&
        Math.max(Math.abs(u.x-objective.x),Math.abs(u.y-objective.y)) < 9);
    // Configured event guards are created before the initial roaming formations.
    const roaming = g.units.findLast(u => u.team === 1 && !u.facility);
    assert.notEqual(own.id, foreign.id);
    assert.notEqual(roaming.id, own.id);
    const noContact = {...G, sensors:{...G.sensors,visible:()=>false,detected:()=>false}};
    moveTo(G, f.actor, {x:0,y:0});
    moveTo(G, foreign, {x:objective.x+1,y:objective.y});
    moveTo(G, roaming, {x:objective.x+8,y:objective.y});
    for (const unit of [own,foreign,roaming]) assert.equal(C.aiOrder(g,noContact,unit).alerted,false);
    if (trigger === "factory") g.units.find(u=>u.id===objective.targets[0]).hp--;
    else if (trigger === "guard damage") own.hp--;
    else moveTo(G,f.actor,objective);
    if (trigger === "salvage") C.action(f.room,G,f.member,{
      action:"contract_interact",unitId:f.actor.id,objectiveId:objective.id,
    });
    else C.poll(f.room,G);
    assert.equal(C.aiOrder(g,noContact,own).alerted,true,"the event's own guards respond");
    const investigation = C.aiOrder(g,noContact,roaming);
    assert.equal(investigation.alerted,false,"support signals do not reveal players");
    const signal = trigger === "guard damage" ? own : objective;
    assert.deepEqual(investigation.goal,{x:signal.x,y:signal.y},"nearby patrols investigate the signal");
    assert.equal(C.aiOrder(g,noContact,foreign).alerted,false,"other event guards remain on local patrol");
    moveTo(G,f.actor,{x:foreign.x+1,y:foreign.y});
    assert.equal(C.aiOrder(g,G,foreign).alerted,true,"direct contact still triggers self-defense");
  });

test("recovery pursuit really arrives aboard a compatible transport on ground and in space", (t) => {
  for (const environment of ["ground", "space"]) {
    const f = fixture(t, { environment }),
      g = f.room.game,
      o = g.contract.objectives.find((o) => o.type === "salvage");
    clearEnemies(f);
    moveTo(G, f.actor, o);
    C.action(f.room, G, f.member, {
      action: "contract_interact",
      unitId: f.actor.id,
      objectiveId: o.id,
    });
    const carrier = g.units.find((u) => u.team === 1 && u.hp > 0 && G.modelOf(u).hangars.length);
    assert(carrier);
    const cargo = g.units.filter((u) => u.hp > 0 && u.embarked?.carrierId === carrier.id);
    assert.equal(cargo.length, 2);
    assert(carrier.contractReinforcement && cargo.every(unit=>unit.contractReinforcement),"transport hull and cargo both count toward the shared cap");
    const noContact = {...G,sensors:{...G.sensors,visible:()=>false,detected:()=>false}};
    assert.equal(C.aiOrder(g, noContact, carrier).alerted, false);
    const contact = {...G,sensors:{...G.sensors,visible:()=>true,detected:()=>false}};
    assert.equal(C.aiOrder(g, contact, carrier).alerted, true);
    assert.equal(C.aiOrder(g, noContact, carrier).alerted, false,"losing contact ends tracking");
    assert(
      carrier.x <= 12 ||
        carrier.y <= 12 ||
        carrier.x >= G.mapWidth(g) - 12 ||
        carrier.y >= G.mapHeight(g) - 12,
    );
  }
});

test("contract enemies require full ground/flight or space adaptation across all available eras", () => {
  const groundZaku = Object.values(G.models).find((m) => m.prefabId === "MS_06J");
  assert(groundZaku);
  assert.equal(C.suitableEnvironment(groundZaku, "space"), false);
  assert.equal(C.suitableEnvironment(G.models.Medea__standard, "space"), false);
  assert.equal(C.suitableEnvironment(G.models.Medea__standard, "ground"), true);
  for (const era of G.eras)
    for (const faction of C.factionsForEra(G, era))
      for (const environment of ["ground", "space"])
        for (let seed = 0; seed < 12; seed++) {
          const room = { settings: { sweepEra: era, sweepFaction: faction, sweepEnvironment: environment, sweepDifficulty: 6 } };
          for (const item of C.enemies(room, G, seed))
            assert(C.suitableEnvironment(G.models[item.unitId + "__" + item.kitId], environment));
        }
});

test("enemy numbers gain ten percent and twenty-five percent per extra human, including event pursuit", (t) => {
  for (const environment of ["ground", "space"]) {
    let baseline;
    for (let players = 1; players <= 5; players++) {
      const f = fixture(t, { players, environment }), g = f.room.game;
      const count = () => g.units.filter((u) => u.team === 1 && !u.facility).length;
      if (players === 1) baseline = g.contract.enemyBaseCount;
      assert.equal(g.contract.enemyBaseCount, baseline);
      assert.equal(count(), Math.round(baseline * 1.1 * (1 + (players - 1) * 0.25)));
      for (const u of g.units.filter((u) => u.team === 1 && !u.facility))
        assert(C.suitableEnvironment(G.modelOf(u), environment));
      clearEnemies(f);
      const o = g.contract.objectives.find((o) => o.type === "salvage");
      moveTo(G, f.actor, o);
      C.action(f.room, G, f.member, { action: "contract_interact", unitId: f.actor.id, objectiveId: o.id });
      assert.equal(count(), Math.round(baseline * 1.1 * (1 + (players - 1) * 0.25)) + Math.round(3 * 1.1 * (1 + (players - 1) * 0.25)));
      for (const u of g.units.filter((u) => u.team === 1 && u.hp > 0))
        assert(C.suitableEnvironment(G.modelOf(u), environment));
    }
  }
});

test("contract settings force full fog and enabled pilots even when clients submit other policies", (t) => {
  const f = fixture(t);
  assert.equal(f.room.settings.fogMode, "full");
  assert.equal(f.room.game.fogMode, "full");
  assert.equal(f.room.settings.pilotPolicy, "allow");
  assert.deepEqual(C.roomSettings({ ...f.room.settings, fogMode: "disabled", pilotPolicy: "none" }), {
    costLimit: 15000, mapId: C.mapId("ground", 6), fogMode: "full", pilotPolicy: "allow",
  });
});

test("unaware guards patrol locally while roaming forces cross the map, awareness uses their own sensors even with fog disabled", (t) => {
  const f = fixture(t),
    g = f.room.game,
    o = g.contract.objectives.find((o) => o.type === "command"),
    guard = g.units.find((u) => u.id === o.targets[0]);
  moveTo(G, f.actor, { x: 0, y: 0 });
  g.fogMode = "disabled";
  const idle = C.aiOrder(g, G, guard);
  assert.equal(idle.alerted, false);
  assert(Math.max(Math.abs(idle.goal.x - o.x - 3), Math.abs(idle.goal.y - o.y - 2)) <= 5);
  const step = G.aiChoice(g, guard);
  assert(step);
  assert(!step.target);
  moveTo(G, f.actor, { x: guard.x + 1, y: guard.y });
  assert.equal(C.aiOrder(g, G, guard).alerted, true);
  const view = C.view(f.room, G);
  assert.equal(view.groups, undefined);
  assert.equal(view.health, undefined);
});

test("target objectives complete on destruction; eliminating all enemies does not win the contract", (t) => {
  const f = fixture(t),
    g = f.room.game;
  clearEnemies(f);
  G.resolveAutomatic(f.room, [], () => "last-enemy-combat");
  assert.equal(g.winner, null);
  G.end(g);
  G.end(g);
  C.poll(f.room, G);
  assert.equal(g.winner, null);
  for (const o of g.contract.objectives.filter((o) => o.targets.length))
    assert.equal(o.status, "completed");
});
test("individual extraction is owner-only, idempotent and waits for every player before paying", (t) => {
  const f = fixture(t, { players: 2 }),
    g = f.room.game;
  clearEnemies(f);
  g.contract.objectives[0].status = "completed";
  const p1 = g.units.find((u) => u.ownerSeat === 0),
    p2 = g.units.find((u) => u.ownerSeat === 2),
    zone = g.contract.extraction;
  moveTo(G, p1, { x: zone.x + 4, y: zone.y + 4 });
  assert.throws(
    () => C.action(f.room, G, f.room.seats[2], { action: "contract_extract", unitId: p1.id }),
    /自己的/,
  );
  const rev = f.room.revision;
  f.act(0, "contract_extract", { unitId: p1.id }, "extract-once");
  f.act(0, "contract_extract", { unitId: p1.id }, "extract-once");
  assert.equal(f.room.revision, rev + 1);
  assert(p1.contractExtracted);
  assert(p1.hp > 0);
  assert(!G.onMap(p1));
  assert.equal(g.winner, null);
  assert(!f.room.economyAwards.some((a) => a.kind === "result"));
  f.engine.disconnect(f.clients[0]);
  assert.equal(f.room.phase, "idle");
  f.act(1, "wait", { unitId: p2.id, single: true });
  const secondZone = g.contract.extractions[1];
  moveTo(G, p2, { x: secondZone.x + 2, y: secondZone.y + 2 });
  f.act(1, "contract_extract", { unitId: p2.id });
  assert.equal(g.winner, 0);
  const awards = f.room.economyAwards.filter((a) => a.kind === "result");
  assert.equal(awards.length, 2);
  assert(awards.every((a) => a.money > 0 && !Object.keys(a.losses).length));
  f.engine.broadcast(f.room);
  assert.equal(f.room.economyAwards.filter((a) => a.kind === "result").length, 2);
});

test("extraction rejects units outside the zone; complete loss without survivors is defeat", (t) => {
  const f = fixture(t),
    g = f.room.game;
  moveTo(G, f.actor, { x: 0, y: 0 });
  assert.throws(
    () => C.action(f.room, G, f.member, { action: "contract_extract", unitId: f.actor.id }),
    /撤离区/,
  );
  f.actor.hp = 0;
  C.poll(f.room, G);
  assert.equal(g.winner, 1);
  assert.equal(f.room.phase, "finished");
});

test("stale network event actions and spectators are rejected, valid action is idempotent", (t) => {
  const f = fixture(t),
    g = f.room.game,
    o = g.contract.objectives.find((o) => o.type === "salvage");
  clearEnemies(f);
  moveTo(G, f.actor, o);
  assert.throws(
    () =>
      f.engine.action(f.clients[0], {
        id: "stale-request",
        revision: -1,
        action: "contract_interact",
        objectiveId: o.id,
        unitId: f.actor.id,
      }),
    /更新/,
  );
  assert.equal(o.status, "available");
  const rev = f.room.revision;
  f.act(0, "contract_interact", { objectiveId: o.id, unitId: f.actor.id }, "interact-once");
  f.act(0, "contract_interact", { objectiveId: o.id, unitId: f.actor.id }, "interact-once");
  assert.equal(f.room.revision, rev + 1);
  assert.equal(o.status, "completed");
});
test("edge patrols retain their four-turn cadence with the ten-percent base count adjustment", (t) => {
  const f = fixture(t),
    g = f.room.game;
  clearEnemies(f);
  for (const o of g.contract.objectives) o.status = "completed";
  G.resolveAutomatic(f.room, [], () => "cleared-enemies");
  const count = g.units.length;
  for (let turn = 1; turn <= 16; turn++) {
    G.end(g);
    C.poll(f.room, G);
    assert.equal(g.units.length, count + Math.round(Math.floor((turn - 1) / 4) * 2.475));
    G.end(g);
    C.poll(f.room, G);
    const expected = count + Math.round(Math.floor(turn / 4) * 2.475);
    assert.equal(g.units.length, expected);
    C.poll(f.room, G);
    assert.equal(g.units.length, expected);
    assert.equal(g.winner, null);
    assert.equal(f.room.phase, "idle");
  }
  for (const u of g.units.slice(count)) {
    if (u.squadId) assert(G.squadMembers(g,u).length<=3);
    assert(C.suitableEnvironment(G.modelOf(u), "ground"));
    const noContact = {...G, sensors: {...G.sensors, visible: () => false, detected: () => false}};
    assert.equal(C.aiOrder(g, noContact, u).alerted, false);
  }
  assert(g.units.slice(count).some(u=>G.squadMembers(g,u).length>=2),"compatible reinforcements share a battle cell as a real squad");
});

test("multiplayer edge reinforcements form several legal squads and only track their own contacts", t => {
  const f = fixture(t,{players:4,difficulty:3}), g=f.room.game;
  clearEnemies(f);
  for(const objective of g.contract.objectives) objective.status="completed";
  const before=g.units.length;
  for(let turn=0;turn<8;turn++) { g.round+=2; C.poll(f.room,G); }
  const patrols=g.units.slice(before);
  assert.equal(patrols.length,9,"six base units times 75% times 110% times 175%, rounded cumulatively");
  const squads=new Set(patrols.filter(u=>u.squadId).map(u=>u.squadId));
  assert(squads.size>=2);
  const noContact={...G,sensors:{...G.sensors,visible:()=>false,detected:()=>false}};
  for(const unit of patrols) {
    assert.equal(C.aiOrder(g,noContact,unit).alerted,false);
    assert(G.squadMembers(g,unit).length<=3);
    assert(G.fits(g,unit,unit.x,unit.y,unit.angle),"squad stacking respects the shared movement rules");
  }
  const unit=patrols.find(u=>u.squadId), members=G.squadMembers(g,unit);
  const contact={...G,sensors:{...G.sensors,visible:(game,team,target,query)=>{
    assert(query.observers.every(observer=>members.some(member=>member.id===observer.id)));
    return target.id===f.actor.id;
  },detected:()=>false}};
  const order=C.aiOrder(g,contact,unit);
  assert.equal(order.alerted,true);
  assert.deepEqual(order.targetIds,[f.actor.id]);
  assert.equal(C.aiOrder(g,noContact,unit).alerted,false);
});

test("extracted shared-control players are excluded from response review and cannot block surviving players",t=>{
 const f=fixture(t,{players:2}),g=f.room.game,departed=g.units.find(u=>G.ownerOf(u)===2);
 moveTo(G,departed,g.contract.extraction);f.act(1,'contract_extract',{unitId:departed.id});
 f.room.settings.shareAlliedUnits=true;
 const enemy=g.units.find(u=>u.team===1&&!u.facility);
 f.room.phase='reaction';f.room.reactions=[];f.room.pending=null;f.room.reactionReviewId='extracted-review';
 f.room.responses=[{intent:{id:'incoming',target:f.actor.id,attacker:enemy.id},response:'evade'}];
 f.engine.broadcast(f.room);
 assert.deepEqual(f.frames.get(f.clients[0]).reactionReview.required,[0]);
 assert.equal(f.frames.get(f.clients[1]).reactionReview,null);
 assert.equal(f.frames.get(f.clients[0]).connected[2],true);
});

test("shared-control combat advances with only the remaining human confirming responses and playback",t=>{
 const f=fixture(t,{players:2}),g=f.room.game,departed=g.units.find(u=>G.ownerOf(u)===2);
 moveTo(G,departed,g.contract.extraction);f.act(1,'contract_extract',{unitId:departed.id});
 f.room.settings.shareAlliedUnits=true;g.team=1;g.round=2;f.room.turnDone.fill(false);
 for(const u of g.units){delete u.squadId;delete u.squadSlot;if(u.team===1)u.hp=0;}
 const enemy=g.units.find(u=>G.ownerOf(u)===1);
 enemy.model='RGM_79__machine_gun';Object.assign(enemy,{x:5,y:6,hp:300000,en:10000,acted:false,moved:false});
 Object.assign(f.actor,{x:7,y:6,hp:300000,en:10000});
 const weapon=G.modelOf(enemy).weapons.find(w=>G.canAttack(g,enemy,f.actor,w));assert(weapon);
 let serial=0;const botAct=(action,fields={})=>f.engine.action(f.room.seats[1].ws,{
  id:'bot-regression-'+ ++serial,matchId:f.room.matchId,revision:f.room.revision,round:g.round,phase:f.room.phase,action,...fields});
 botAct('attack',{unitId:enemy.id,targetId:f.actor.id,weaponId:weapon.id});botAct('end_turn');
 assert.equal(f.room.phase,'reaction');
 const reactionId=f.room.reactions[0].id;
 f.act(0,'respond',{reactionId,response:'defend'});
 assert.deepEqual(f.frames.get(f.clients[0]).reactionReview.required,[0]);
 f.act(0,'confirm_responses',{reviewId:f.room.reactionReviewId});
 assert.equal(f.room.phase,'playback');
 assert.deepEqual(f.room.playback.members,[f.member.id]);
 f.act(0,'playback_ready',{batchId:f.room.playback.id});
 assert.equal(f.room.phase,'idle');assert.equal(g.team,0);assert(g.round>2);
 assert.deepEqual(f.errors,[]);
});

test("a remaining player can end turns after their teammate extracts and disconnects",async t=>{
 const f=fixture(t,{players:2}),g=f.room.game,departed=g.units.find(u=>G.ownerOf(u)===2);
 moveTo(G,departed,g.contract.extraction);f.act(1,'contract_extract',{unitId:departed.id});
 f.engine.disconnect(f.clients[1]);
 for(let n=0;n<2;n++){
  g.team=0;f.room.phase='idle';f.room.turnDone.fill(false);f.room.turnNotBefore=0;
  for(const u of g.units){if(u.team===1)u.hp=0;if(u.contractAlly)u.acted=true;}
  if(f.room.missionAllySeat!==undefined)f.room.turnDone[f.room.missionAllySeat]=true;
  departed.acted=false; // Old restored snapshots may retain pre-extraction action flags.
  f.actor.acted=true;assert.equal(G.hasActions(g),false);
  const round=g.round;f.act(0,'end_turn');
  assert(g.round>round,'ended human and departed teammate must not hold the team turn');
  assert.deepEqual(f.errors,[]);
 }
});

test("last active human ends a contract turn after teammate extraction while autonomous allies remain",async t=>{
 const f=fixture(t,{players:2,aiDelayMs:0}),g=f.room.game;
 const departed=g.units.find(u=>G.ownerOf(u)===2);
 moveTo(G,departed,g.contract.extraction);f.act(1,'contract_extract',{unitId:departed.id});
 f.act(0,'wait',{unitId:f.actor.id});
 const round=g.round;f.act(0,'end_turn');
 const deadline=Date.now()+6000;
 while(g.round===round&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
 assert(g.round>round,JSON.stringify({phase:f.room.phase,turnDone:f.room.turnDone,
  units:g.units.filter(u=>u.team===0).map(u=>({id:u.id,seat:G.ownerOf(u),acted:u.acted,extracted:u.contractExtracted,plan:!!u.plan}))}));
 assert.deepEqual(f.errors,[]);
});

for(const shared of [false,true])test(`ending first then teammate extraction advances the turn (shared ${shared})`,async t=>{
 const f=fixture(t,{players:2,aiDelayMs:0}),g=f.room.game;
 f.room.settings.shareAlliedUnits=shared;
 const departing=g.units.find(u=>G.ownerOf(u)===2);
 moveTo(G,departing,g.contract.extraction);
 f.act(0,'wait',{unitId:f.actor.id});
 const round=g.round;f.act(0,'end_turn');
 assert.equal(f.room.turnDone[0],true);
 assert.equal(f.room.turnDone[2],false);
 assert.equal(g.round,round,'the other active player still has their own turn');
 f.act(1,'contract_extract',{unitId:departing.id});
 assert(departing.contractExtracted);
 const deadline=Date.now()+6000;
 while(g.round===round&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
 assert(g.round>round,JSON.stringify({phase:f.room.phase,turnDone:f.room.turnDone,
  units:g.units.filter(u=>u.team===0).map(u=>({id:u.id,seat:G.ownerOf(u),acted:u.acted,extracted:u.contractExtracted,plan:!!u.plan}))}));
 assert.deepEqual(f.errors,[]);
});

for(const shared of [false,true])test(`ending first with passengers in hangar then teammate extraction cannot stall planning (shared ${shared})`,async t=>{
 const f=fixture(t,{players:2,difficulty:1,seed:11,aiDelayMs:0}),g=f.room.game;
 f.room.settings.shareAlliedUnits=shared;
 const departing=g.units.find(u=>G.ownerOf(u)===2);
 const passenger=G.makeUnit({unitId:'RGM_79',kitId:'machine_gun'},0,'waiting-cargo',{x:f.actor.x,y:f.actor.y});
 passenger.ownerSeat=0;g.units.push(passenger);
 passenger.embarked={carrierId:f.actor.id,hangarId:G.hangars.of(f.actor)[0].id};
 G.hangars.sync(g);
 passenger.acted=false;
 assert(G.hangars.launchCells(g,passenger).length,'cargo has a legal launch opportunity');
 moveTo(G,departing,g.contract.extraction);
 const round=g.round;f.act(0,'end_turn');
 assert.equal(f.room.turnDone[0],true);
 assert.equal(g.round,round);
 f.act(1,'contract_extract',{unitId:departing.id});
 const deadline=Date.now()+6000;
 while(g.round===round&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,30));
 assert(g.round>round,JSON.stringify({phase:f.room.phase,turnDone:f.room.turnDone,
  hasActions:G.hasActions(g),cargoActed:passenger.acted,embarked:passenger.embarked}));
 assert.deepEqual(f.errors,[]);
});

test("N1-N4 pilots stay general and N5-N6 mix veterans and elites at defined probability boundaries",()=>{
 for(let n=1;n<=4;n++)for(const roll of [0,.04,.09,.24,.39,.999999])assert.equal(C.enemyPilotGrade(n,roll),null);
 for(const [n,elite,veteran] of [[5,.05,.2],[6,.1,.3]]){
  assert.equal(C.enemyPilotGrade(n,0),'elite');
  assert.equal(C.enemyPilotGrade(n,elite-1e-6),'elite');
  assert.equal(C.enemyPilotGrade(n,elite),'veteran');
  assert.equal(C.enemyPilotGrade(n,elite+veteran-1e-6),'veteran');
  assert.equal(C.enemyPilotGrade(n,elite+veteran),null);
  const grades=Array.from({length:1000},(_,i)=>C.enemyPilotGrade(n,(i+.5)/1000));
  assert.equal(grades.filter(g=>g==='elite').length,elite*1000);
  assert.equal(grades.filter(g=>g==='veteran').length,veteran*1000);
 }
});

for(const difficulty of [5,6])test(`N${difficulty} pilot mixes are deterministic and vary across neighboring spawn seeds`,t=>{
 const grades=[];
 for(let sample=0;sample<4;sample++){
  const f=fixture(t,{difficulty,seed:1936384585+sample*1979});
  const enemies=f.room.game.units.filter(u=>u.team===1&&!u.facility);
  assert(enemies.length>0);
  grades.push(...enemies.map(u=>u.pilot.genericGrade || 'general'));
  if(sample===0){
   const replay=fixture(t,{difficulty,seed:1936384585});
   assert.deepEqual(replay.room.game.units.filter(u=>u.team===1&&!u.facility).map(u=>u.pilot),enemies.map(u=>u.pilot));
  }
 }
 assert(grades.includes('general'));assert(grades.includes('veteran'));assert(grades.includes('elite'));
 assert(!grades.includes('ace'));
 assert(grades.filter(g=>g==='general').length>grades.length*.4);
});

test("contract hull selection favors stronger chassis while retaining multiple hulls and kits",()=>{
 for(const difficulty of [1,6]){
  const room={settings:{sweepDifficulty:difficulty,sweepEra:'UC_0079_T2',sweepFaction:'EFSF',sweepEnvironment:'space'}};
  const eligible=Object.values(G.models).filter(m=>!m.formOnly&&!m.wip&&!m.facility&&!m.requiredPilotId&&!m.ship&&
   (!G.isFleetCarrier(m)||m.unitTags?.includes('MA'))&&m.tags?.includes('UC_0079_T2')&&
   (m.availableFactions||[m.faction]).includes('EFSF')&&m.weapons?.length&&C.suitableEnvironment(m,'space')&&
   !(G.aiUnitBans.sweep||[]).includes(m.prefabId)&&C.enemyStage(room,G,m)===(difficulty<=3?0:1));
  const ids=[...new Set(eligible.filter(m=>!m.unitTags?.includes('MA')).map(m=>m.prefabId))];assert(ids.length>1);
  const uniformMean=ids.reduce((sum,id)=>{const kits=eligible.filter(m=>m.prefabId===id);return sum+kits.reduce((n,m)=>n+m.cost,0)/kits.length;},0)/ids.length;
  const generated=[];
  for(let seed=1;seed<=1000;seed++)for(const e of C.enemies(room,G,Math.imul(seed,0x9e3779b1)>>>0))generated.push(G.formationModel(e));
  const ordinary=generated.filter(m=>!m.unitTags?.includes('MA'));
  const mean=ordinary.reduce((sum,m)=>sum+m.cost,0)/ordinary.length;
  assert(mean>uniformMean*1.05,`N${difficulty}: weighted COST ${mean}, uniform COST ${uniformMean}`);
  assert(new Set(generated.map(m=>m.prefabId)).size>1);
 }
});

test("random contract MA remain rare while normal units retain diversity across eras and environments",()=>{
 let seenMA=0;
 for(const era of ['UC_0079_T1','UC_0079_T2'])for(const environment of ['ground','space'])
 for(const faction of ['EFSF','ZEON'])for(const difficulty of [1,6]){
  const room={settings:{sweepEra:era,sweepEnvironment:environment,sweepFaction:faction,sweepDifficulty:difficulty}};
  let count=0,ma=0;const hulls=new Set();
  for(let seed=1;seed<=600;seed++)for(const e of C.enemies(room,G,Math.imul(seed,0x9e3779b1)>>>0)){
   const model=G.formationModel(e);count++;hulls.add(e.unitId);
   if(model.unitTags?.includes('MA'))ma++;
   assert(model.tags.includes(era));assert(C.suitableEnvironment(model,environment));
  }
  assert(ma/count<.13,`${era} ${environment} ${faction} N${difficulty}: MA ${ma}/${count}`);
  assert(hulls.size>1);seenMA+=ma;
 }
 assert(seenMA>0,'MA remain available as rare encounters');
});

test("casualties and remaining HP are committed only at final settlement, even on defeat", (t) => {
  const f = fixture(t),
    g = f.room.game,
    inventory = structuredClone(f.member.inventory),
    o = g.contract.objectives[0];
  o.status = "completed";
  const current = f.actor.hp;
  f.actor.hp = Math.floor(current / 2);
  f.engine.broadcast(f.room);
  assert.deepEqual(f.member.inventory, inventory);
  assert(!f.room.economyAwards.some((a) => a.kind === "result" || a.stockLost));
  f.actor.hp = 0;
  f.engine.broadcast(f.room);
  assert.equal(g.winner, 1);
  const result = f.room.economyAwards.find((a) => a.kind === "result");
  assert(result.money > 0);
  assert.deepEqual(result.settledStockIds, ["stock"]);
  assert(f.room.economyAwards.find((a) => a.stockLost)?.stockLost.inventory.Medea === 1);
  assert.equal(
    result.stockLostItems?.[0]?.stockId ||
      f.room.economyAwards.find((a) => a.stockLostItems)?.stockLostItems?.[0]?.stockId,
    "stock",
  );
  const count = f.room.economyAwards.length;
  f.engine.broadcast(f.room);
  assert.equal(f.room.economyAwards.length, count);
});
test("carrier extraction includes cargo and freezes HP, EN and parts while teammates continue", (t) => {
  const f = fixture(t, { players: 2 }),
    g = f.room.game,
    zone = g.contract.extraction;
  const passenger = G.makeUnit({ unitId: "Type61", kitId: "standard" }, 0, "passenger", {
    x: 0,
    y: 0,
  });
  passenger.embarked = { carrierId: f.actor.id, hangarId: "Hangar_1" };
  passenger.hp = 100;
  passenger.en = 0;
  passenger.brokenParts = { head: true };
  g.units.push(passenger);
  moveTo(G, f.actor, { x: zone.x + 5, y: zone.y + 5 });
  f.act(0, "contract_extract", { unitId: f.actor.id });
  assert(passenger.contractExtracted);
  const before = { hp: passenger.hp, en: passenger.en, brokenParts: { ...passenger.brokenParts } };
  G.end(g);
  G.end(g);
  assert.deepEqual(
    { hp: passenger.hp, en: passenger.en, brokenParts: passenger.brokenParts },
    before,
  );
  assert.equal(g.winner, null);
  const cells = G.deploymentCells(g, 0),
    areas = g.contract.entries;
  assert(
    cells.every(
      p => areas.some(area => p.x >= area.x && p.x < area.x + area.width && p.y >= area.y && p.y < area.y + area.height),
    ),
  );
});

test("a late spectator cannot interact or extract and does not enter the participant wait list", (t) => {
  const f = fixture(t),
    ws = f.clients[1];
  f.engine.join(ws, { mode: "join", room: "CONTRACT", name: "Observer", characterFaction: "PMC" });
  const spectator = [...f.room.members.values()].find((p) => p.ws === ws);
  assert.equal(spectator.seat, null);
  assert.throws(() => C.action(f.room, G, spectator, { action: "contract_extract" }), /参战/);
  assert.equal(f.room.seats.filter((p) => p && !p.bot).length, 1);
  f.engine.disconnect(ws);
  assert.equal(f.room.phase, "idle");
});

test("procedural maps vary by seed, increase by difficulty, and have navigable edge zones and valid tilemaps", () => {
  const M = require("../shared/map-document");
  let previous = 0;
  for (const environment of ["ground", "space"]) {
    previous = 0;
    for (let difficulty = 1; difficulty <= 6; difficulty++) {
      const settings = { sweepDifficulty: difficulty, sweepEnvironment: environment },
        a = C.generateMap(G.catalog, settings, 910 + difficulty),
        b = C.generateMap(G.catalog, settings, 1710 + difficulty);
      assert(a.width * a.height > previous);
      previous = a.width * a.height;
      assert.notDeepEqual(a.tiles, b.tiles);
      assert.deepEqual(a, C.generateMap(G.catalog, settings, 910 + difficulty));
      assert.equal(
        C.config(difficulty).costLimit,
        [3000, 4500, 6000, 9000, 12000, 15000][difficulty - 1],
      );
      assert.equal(
        G.fleetLimit({ mode: "sweep", sweepDifficulty: difficulty }),
        Math.ceil(difficulty / 3) + 1,
      );
      assert.equal(a.cover, C.covers[environment]);
      assert.equal(a.contractLayout.entries.length,2);
      assert.equal(a.contractLayout.entry.width, 8 + C.config(difficulty).fleetLimit * 2);
      assert.equal(a.contractLayout.entry.height, 8 + C.config(difficulty).fleetLimit);
      assert.equal(a.contractLayout.extractions.length, 2);
      assert.equal(a.contractLayout.extraction.width, 6);
      assert.equal(a.contractLayout.extraction.height, 6);
      const [firstExit, secondExit] = a.contractLayout.extractions;
      assert(firstExit.x + 8 <= secondExit.x || secondExit.x + 8 <= firstExit.x ||
        firstExit.y + 8 <= secondExit.y || secondExit.y + 8 <= firstExit.y);
      for (const spawn of a.spawns) {
        const zones = spawn.team === 0 ? a.contractLayout.entries : [a.contractLayout.extraction];
        assert(
          zones.some(zone => spawn.x >= zone.x &&
            spawn.x < zone.x + zone.width &&
            spawn.y >= zone.y &&
            spawn.y < zone.y + zone.height),
        );
      }
      for (const zone of [...a.contractLayout.entries, ...a.contractLayout.extractions]) {
        if (!a.contractLayout.entries.includes(zone)) {
          assert.equal(zone.width,6);
          assert.equal(zone.height,6);
        }
        assert(
          zone.x === 0 ||
            zone.y === 0 ||
            zone.x + zone.width === a.width ||
            zone.y + zone.height === a.height,
        );
        for (let y = zone.y; y < zone.y + zone.height; y++)
          for (let x = zone.x; x < zone.x + zone.width; x++) assert.equal(a.tiles[y][x], "plain");
      }
      const game = { ...a, environment, contractLayout: a.contractLayout, mapId: a.id };
      const visual = C.visualMap(G.catalog, game);
      M.validate(visual.tileMap);
      assert.equal(visual.tileMap.layers[0].data.length, a.width * a.height);
    }
  }
});
test("difficulty locks formation COST and ship count, ignoring custom room budgets", (t) => {
  const f = fixture(t, { difficulty: 4 });
  assert.equal(f.room.settings.costLimit, 6000);
  assert.equal(G.fleetLimit(f.room.settings), 3);
  const rules = G.armyRestrictions(f.room.settings, f.member);
  const units = Array.from({ length: 4 }, () => ({ unitId: "Medea", kitId: "standard" }));
  const plan = G.planFormation(
    units,
    8000,
    { ...rules, inventory: { Medea: 5 }, licenses: { Medea: true } },
    18,
  );
  assert.equal(plan.deployable.length, 3);
});

test("five-player contracts share two opposite deployment edges on ground and in space", (t) => {
  for (const environment of ["ground", "space"]) {
    const f = fixture(t, { players: 5, environment, difficulty: 6 });
    assert.equal(f.room.settings.costLimit, 10000);
    assert.equal(C.progress(f.room, G).length, 5);
    assert.equal(f.engine.roomList()[0].capacity, 5);
    assert.equal(f.room.seats.filter(player=>player && !player.bot).length,5);
    assert.equal(f.room.game.contract.players,5);
    assert(C.progress(f.room, G).every((p) => p.remaining === 1));
  }
});

test("contract lobby admits five players and keeps the sixth as a spectator", t => {
  let serial=0;
  const engine=createRoomEngine({rules:G,randomId:()=>"five-"+ ++serial,
    randomToken:()=>"token-"+ ++serial,randomSeed:()=>123,send(){}});
  t.after(()=>engine.close());
  const clients=Array.from({length:6},()=>({readyState:1}));
  for(let i=0;i<clients.length;i++) engine.join(clients[i],{
    mode:i?"join":"create",room:"FIVE_PLAYERS",roomMode:"sweep",characterFaction:"PMC",
  });
  const room=engine.rooms.get("FIVE_PLAYERS");
  assert.equal(room.seats.filter(player=>player&&!player.bot).length,5);
  assert.equal(room.members.get(clients[4].memberId).seat,8);
  assert.equal(room.members.get(clients[5].memberId).seat,null);
  assert.equal(engine.roomList()[0].capacity,5);
  for(const environment of ["ground","space"])
    for(const difficulty of C.difficulties) {
      const map=G.getMap(C.mapId(environment,difficulty.id));
      assert.equal(map.playersPerTeam,5);
      assert.equal(map.spawns.filter(spawn=>spawn.team===0).length,5);
      map.spawns.forEach((spawn,seat)=>{
        const zone=map.deploymentAreas[seat];
        assert(spawn.x>=zone.x&&spawn.x<zone.x+zone.width);
        assert(spawn.y>=zone.y&&spawn.y<zone.y+zone.height);
      });
    }
});
test("multiple random seeds keep every event and exit reachable from entry", () => {
  for (const environment of ["ground", "space"])
    for (const difficulty of [1, 3, 6])
      for (let seed = 0; seed < 12; seed++) {
        const m = C.generateMap(
            G.catalog,
            { sweepDifficulty: difficulty, sweepEnvironment: environment },
            seed,
          ),
          entry = m.contractLayout.entry,
          start = { x: entry.x + 5, y: entry.y + 5 },
          queue = [start],
          seen = new Set([start.x + "," + start.y]);
        for (let i = 0; i < queue.length; i++)
          for (const [dx, dy] of [
            [0, 1],
            [0, -1],
            [1, 0],
            [-1, 0],
          ]) {
            const x = queue[i].x + dx,
              y = queue[i].y + dy,
              k = x + "," + y;
            if (
              x >= 0 &&
              y >= 0 &&
              x < m.width &&
              y < m.height &&
              !seen.has(k) &&
              !["rock", "water"].includes(m.tiles[y][x])
            ) {
              seen.add(k);
              queue.push({ x, y });
            }
          }
        for (const p of [
          ...m.contractLayout.locations,
          ...m.contractLayout.entries.map(zone=>({x:zone.x+3,y:zone.y+3})),
          ...m.contractLayout.extractions.map(zone=>({x:zone.x+3,y:zone.y+3})),
        ])
          assert(seen.has(p.x + "," + p.y));
      }
});

test("compact shared deployment supports five full three-carrier fleets and large ships fit extraction", () => {
  for (const environment of ["ground", "space"]) {
    const unitId = environment === "space" ? "AlbionClass" : "Medea",
      settings = {
        mode: "sweep",
        sweepDifficulty: 6,
        costLimit: 20000,
        sweepEnvironment: environment,
        sweepEra: "UC_0087_T2",
        sweepFaction: "AEUG",
      },
      formations = Array.from({ length: 10 }, (_, seat) =>
        seat % 2 ? null : Array.from({ length: 3 }, () => ({ unitId, kitId: "standard" })),
      ),
      game = G.create(false, 190, formations, true, settings);
    // Exercise the real deployment solver, not just rectangle arithmetic.
    for (const seat of [0, 2, 4, 6, 8]) {
      G.autoPlaceDeployment(game, seat);
      const actors = game.units.filter((u) => G.ownerOf(u) === seat && !u.embarked);
      assert.equal(actors.length, 3);
      assert(actors.every((u) => G.fits(game, u, u.x, u.y, u.angle, false, seat)));
    }
    for (const zone of game.contractLayout.extractions) {
    const model = G.models[unitId + "__standard"],
      u = G.makeUnit(
        { unitId: model.prefabId, kitId: model.kitId },
        0,
        "exit-probe",
        { x: zone.x + 3, y: zone.y + 3 },
        90,
        1,
      );
    const fits = [];
    for(let y=Math.max(0,zone.y-6);y<Math.min(G.mapHeight(game),zone.y+6);y++)
      for(let x=Math.max(0,zone.x-6);x<Math.min(G.mapWidth(game),zone.x+6);x++) {
        Object.assign(u,{x,y,deployed:true});
        game.contract={extractions:game.contractLayout.extractions,objectives:[]};
        if(G.fits(game,u)&&C.canExtract(game,G,u,G.ownerOf(u))) fits.push({x,y});
      }
    assert(fits.length>0,"large ships can reach and extract at either smaller exit");
    }
  }
});

test("legacy single-exit saves still allow extraction", t => {
  const f=fixture(t),g=f.room.game;
  delete g.contract.extractions;
  moveTo(G,f.actor,g.contract.extraction);
  assert.equal(C.extractionZones(g.contract).length,1);
  assert(C.canExtract(g,G,f.actor,f.member.seat));
});

test("both deployment pads are shared by every player and remain distinct", t => {
  const f=fixture(t,{players:5}),g=f.room.game;
  const [first,second]=g.contract.entries;
  assert(first.x+first.width+2<=second.x || second.x+second.width+2<=first.x ||
    first.y+first.height+2<=second.y || second.y+second.height+2<=first.y);
  for(const seat of [0,2,4,6,8]) {
    const cells=G.deploymentCells(g,seat);
    for(const area of g.contract.entries) assert(cells.some(p=>p.x===area.x+2&&p.y===area.y+2));
  }
  delete g.contract.entries;
  assert.deepEqual(C.deploymentZones(g.contract),[g.contract.entry]);
});

for(const [difficulty,limit] of [[1,12],[5,24],[6,27]])
  test(`N${difficulty} caps live reinforcements at ${limit} and resumes after casualties`, t => {
    const f=fixture(t,{difficulty}),g=f.room.game;
    clearEnemies(f);
    for(const objective of g.contract.objectives) objective.status="completed";
    const alive=()=>g.units.filter(unit=>unit.contractReinforcement&&unit.hp>0);
    assert.equal(C.config(difficulty).patrolLimit,limit);
    for(let turn=0;turn<4*(limit+1);turn++) {
      g.round+=2;C.poll(f.room,G);
      assert(alive().length<=limit);
    }
    assert.equal(alive().length,limit);
    const count=g.units.length,budget=g.contract.reinforcementBaseCount;
    for(let turn=0;turn<8;turn++) {g.round+=2;C.poll(f.room,G);}
    assert.equal(g.units.length,count,"no queued or hidden reinforcements while full");
    assert.equal(g.contract.reinforcementBaseCount,budget);
    alive()[0].hp=0;
    for(let turn=0;turn<4;turn++) {g.round+=2;C.poll(f.room,G);}
    assert.equal(alive().length,limit-1,"one slot cannot fit a complete configured formation");
    assert.equal(g.units.length,count);
    for(const unit of alive().slice(0,2))unit.hp=0;
    for(let turn=0;turn<4;turn++) {g.round+=2;C.poll(f.room,G);}
    assert.equal(alive().length,limit);
    assert.equal(g.units.length,count+3,"replace casualties only with a complete formation");
  });

test("event transports, factory defenders and capture airdrops cannot bypass the shared reinforcement cap", t => {
  const f=fixture(t),g=f.room.game,limit=C.config(6).patrolLimit;
  const template=g.units.find(unit=>unit.team===1&&!unit.facility&&!G.modelOf(unit).ship);
  for(let i=0;i<limit;i++) g.units.push({...structuredClone(template),id:"cap-test-"+i,
    x:0,y:0,contractReinforcement:true});
  const count=g.units.length;
  const salvage=g.contract.objectives.find(o=>o.type==="salvage");
  moveTo(G,f.actor,salvage);
  C.action(f.room,G,f.member,{action:"contract_interact",unitId:f.actor.id,objectiveId:salvage.id});
  assert.equal(salvage.status,"completed");
  assert.equal(g.units.length,count,"full cap does not prevent recovery but blocks its transport wave");
  const factory=g.contract.objectives.find(o=>o.type==="factory");
  for(const id of factory.targets) g.units.find(unit=>unit.id===id).hp=0;
  C.poll(f.room,G);
  assert.equal(factory.status,"completed");
  const capture=g.contract.objectives.find(o=>o.type==="capture");
  moveTo(G,f.actor,capture);
  C.poll(f.room,G);
  for(let turn=0;turn<4;turn++) {g.round+=2;C.poll(f.room,G);}
  assert(capture.airdrop);
  assert.equal(g.units.length,count,"event and periodic waves share the same cap");
  assert.equal(g.contract.reinforcementBaseCount,undefined,"blocked waves are not queued");
});

test("event cut-ins preserve start/complete order, all-clear follows the final completion, repeated polls never duplicate", (t) => {
  const f = fixture(t),
    g = f.room.game;
  clearEnemies(f);
  C.poll(f.room, G);
  const killEvents = g.contract.objectives.filter((o) => ["factory", "command"].includes(o.type));
  for (const o of killEvents) {
    assert.deepEqual(
      g.contract.cues.filter((c) => c.objectiveId === o.id).map((c) => c.type),
      ["started", "completed"],
    );
  }
  const capture = g.contract.objectives.find((o) => o.type === "capture");
  moveTo(G, f.actor, { x: capture.x + 1, y: capture.y });
  C.poll(f.room, G);
  assert.equal(
    g.contract.cues.filter((c) => c.objectiveId === capture.id && c.type === "started").length,
    1,
  );
  const recovery = g.contract.objectives.find((o) => o.type === "salvage");
  for (const o of g.contract.objectives) if (o !== recovery) o.status = "completed";
  moveTo(G, f.actor, recovery);
  C.action(f.room, G, f.member, {
    action: "contract_interact",
    unitId: f.actor.id,
    objectiveId: recovery.id,
  });
  assert.deepEqual(
    g.contract.cues.slice(-3).map((c) => c.type),
    ["started", "completed", "all_completed"],
  );
  assert(g.contract.allCompleted);
  const count = g.contract.cues.length;
  C.poll(f.room, G);
  C.poll(f.room, G);
  assert.equal(g.contract.cues.length, count);
  assert.deepEqual(
    g.contract.cues.map((c) => c.id),
    Array.from({ length: count }, (_, i) => i + 1),
  );
});
