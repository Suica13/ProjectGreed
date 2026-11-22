const test = require("node:test"),
  assert = require("node:assert/strict");
const G = require("../shared/rules"),
  C = require("../shared/contract-mode"),
  { createRoomEngine } = require("../shared/room-engine");
function fixture(t, { difficulty = 9, environment = "ground", seed = 34567, players = 1, era = "UC_0079_T1", faction = "ZEON", validateEraRules = false, contactTasks = [], secondContactTasks = null, aiDelayMs = 999999, roomReturnMs = 999999 } = {}) {
  let serial = 0;
  const frames = new Map(),
    errors = [];
  const engine = createRoomEngine({
    // Cover retained N1-N9 mechanics independently of the temporary lobby policy.
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
    fogMode: "disabled",
    pilotPolicy: "none",
  });
  if (validateEraRules) {
    for (const invalidFaction of ["EFSF", "ZEON", "OMNI", "ZAFT"])
      assert.throws(() => act(0, "configure_room", { ...room.settings, sweepFaction: invalidFaction }));
    assert.equal(room.settings.sweepFaction, faction);
  }
  for (let i = 1; i < players; i++) act(i, "set_ready", { ready: true, formation });
  act(0, "start_game", { formation });
  for (let i = 0; i < players; i++) act(i, "confirm_formation");
  assert.equal(room.phase, "deployment", errors.join("\n"));
  for (let i = 0; i < players; i++) {
    act(i, "auto_place_deployment");
    act(i, "confirm_deployment");
  }
  assert.equal(room.phase, "idle", errors.join("\n"));
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

test("rescue requires nearby PMC, keeps at least one survivor, and withdraws only rescued NPCs", t => {
  const f=fixture(t),g=f.room.game,o=g.contract.objectives.find(o=>o.type === "rescue");
  clearEnemies(f);moveTo(G,f.actor,{x:o.x,y:o.y+1});C.poll(f.room,G);
  assert.equal(o.status,"active");
  moveTo(G,f.actor,{x:0,y:0});g.round+=2;C.poll(f.room,G);assert.equal(o.progress,0);
  for(const id of o.protected.slice(1))g.units.find(u=>u.id===id).hp=0;
  moveTo(G,f.actor,{x:o.x,y:o.y+1});
  for(let i=0;i<3;i++){clearEnemies(f);g.round+=2;C.poll(f.room,G);}
  assert.equal(o.status,"completed");
  assert(g.units.find(u=>u.id === o.protected[0]).contractExtracted);
  assert(!f.actor.contractExtracted);
  assert(!C.progress(f.room,G)[0].extracted,"rescued guards do not count as player extraction");
});

test("rescue fails if the isolated friendly squad is destroyed", t => {
  const f=fixture(t),g=f.room.game,o=g.contract.objectives.find(o=>o.type === "rescue");
  for(const id of o.protected)g.units.find(u=>u.id===id).hp=0;
  C.poll(f.room,G);assert.equal(o.status,"failed");assert.equal(g.winner,null);
});

test("upload progress pauses without PMC or while enemies contest its area", t => {
  const f=fixture(t),g=f.room.game,o=g.contract.objectives.find(o=>o.type === "upload");
  clearEnemies(f);moveTo(G,f.actor,o);C.poll(f.room,G);assert.equal(o.status,"active");
  const enemy=g.units.find(u=>u.team===1 && !u.facility);enemy.hp=G.modelOf(enemy).hp;moveTo(G,enemy,o);
  g.round+=2;C.poll(f.room,G);assert.equal(o.progress,0);
  clearEnemies(f);moveTo(G,f.actor,{x:0,y:0});g.round+=2;C.poll(f.room,G);assert.equal(o.progress,0);
  moveTo(G,f.actor,o);
  for(let i=0;i<3;i++){clearEnemies(f);g.round+=2;C.poll(f.room,G);}
  assert.equal(o.status,"completed");
});

test("radar has a real destructible target and sends its response only once", t => {
  const f=fixture(t),g=f.room.game,o=g.contract.objectives.find(o=>o.type === "radar");
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
 assert.equal(special.find(o=>o.contactTaskId==='efsf-4').targets.length,12);
 const camp=special.find(o=>o.contactTaskId==='efsf-5');assert.equal(camp.targets.length,4);
 assert.equal(g.units.filter(u=>u.facility?.type==='mg').length,4);
 for(const o of special.filter(o=>o.type==='salvage'))assert(G.models[o.wreckModel]);
 const no=fixture(t,{difficulty:3,environment:'space',contactTasks});assert.equal(no.room.game.contract.objectives.filter(o=>o.contactTaskId).length,0);
});
test("liaison kill credit is deduplicated, eligibility frozen at entry and appears only on settlement receipts",t=>{
 const f=fixture(t,{difficulty:1,contactTasks:[{id:'efsf-1',status:'accepted',progress:0}]}),g=f.room.game;
 const target=g.units.find(u=>u.team===1 && G.modelOf(u).unitTags.includes('MS'));
 C.recordDefeat(f.room,G,f.actor,target,G.modelOf(target));C.recordDefeat(f.room,G,f.actor,target,G.modelOf(target));
 assert.deepEqual(C.commissionProgress(f.room,G,f.member),[{id:'efsf-1',amount:1}]);
 assert(!f.room.economyAwards.some(a=>a.contactProgress));
 clearEnemies(f);moveTo(G,f.actor,g.contract.extraction);f.act(0,'contract_extract',{unitId:f.actor.id});
 const receipt=f.room.economyAwards.find(a=>a.memberId===f.member.id&&a.kind==='result');
 assert.deepEqual(receipt.contactProgress,[{id:'efsf-1',amount:1}]);
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
test("era budgets scale every difficulty cumulatively while fleet limits and event counts stay fixed", () => {
  const eras = ["UC_0079_T1", "UC_0079_T2", "UC_0087_T1", "UC_0087_T2"];
  for (let n = 1; n <= 9; n++) {
    for (const [stage, era] of eras.entries()) {
      const d = C.config(n, era), settings = C.roomSettings({ sweepDifficulty: n, sweepEra: era, sweepEnvironment: "ground" });
      assert.equal(d.costLimit, Math.round(C.config(n).costLimit * 1.25 ** stage));
      assert.equal(settings.costLimit, d.costLimit);
      assert.equal(d.events, n);
      assert.equal(d.fleetLimit, C.config(n).fleetLimit);
      assert.equal(d.fleetLimit, 2 + Math.floor((n - 1) / 3));
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
  for(const [id,stage] of [["MS_06F",0],["MS_06G",1],["MS_06F2",2]]) {
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

test("difficulty bands draw 80/20 neighboring phases and high difficulty draws only late units", () => {
  for(const faction of ["EFSF","ZEON"]) for(let difficulty=1;difficulty<=9;difficulty++) {
    const room={settings:{sweepEra:"UC_0079_T1",sweepFaction:faction,sweepEnvironment:"ground",sweepDifficulty:difficulty}};
    const counts=[0,0,0],phase=Math.floor((difficulty-1)/3);
    for(let sample=1;sample<=500;sample++) for(const item of C.enemies(room,G,Math.imul(sample,0x9e3779b1)>>>0))
      counts[C.enemyStage(room,G,G.models[item.unitId+"__"+item.kitId])]++;
    if(phase<2) {
      assert(counts[phase+1]>=160&&counts[phase+1]<=240,JSON.stringify({faction,difficulty,counts}));
      assert.equal(counts[phase]+counts[phase+1],1000);
    } else assert.deepEqual(counts,[0,0,1000]);
  }
});

test("phase pools retain era, faction and environment restrictions across the complete catalog", () => {
  for(const era of G.eras) for(const faction of C.factionsForEra(G,era))
    for(const environment of ["ground","space"]) for(const difficulty of [1,4,7]) {
      const room={settings:{sweepEra:era,sweepFaction:faction,sweepEnvironment:environment,sweepDifficulty:difficulty}};
      for(let seed=1;seed<=12;seed++) for(const item of C.enemies(room,G,Math.imul(seed,0x9e3779b1)>>>0)) {
        const model=G.models[item.unitId+"__"+item.kitId],stage=C.enemyStage(room,G,model);
        assert(model.tags.includes(era));
        assert((model.availableFactions||[model.faction]).includes(faction));
        assert(C.suitableEnvironment(model,environment));
        assert(difficulty===1?stage<=1:difficulty===4?stage>=1:stage===2,
          JSON.stringify({era,faction,environment,difficulty,id:model.prefabId,stage}));
      }
    }
});

for(const difficulty of [1,4,7]) test(`N${difficulty} garrisons, roaming waves and transported passengers share the phase filter`,t=>{
  const f=fixture(t,{difficulty}),g=f.room.game;
  const check=()=>{
    for(const unit of g.units.filter(unit=>unit.team===1&&!unit.facility&&!G.isFleetCarrier(G.modelOf(unit)))) {
      const stage=C.enemyStage(f.room,G,G.modelOf(unit));
      assert(difficulty===1?stage<=1:difficulty===4?stage>=1:stage===2);
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
  assert.equal(f.room.settings.costLimit, 3906);
  assert.equal(f.frames.get(f.clients[0]).contract.difficulty.costLimit, 3906);
});
for (const environment of ["ground", "space"])
  for (const difficulty of [1, 2, 3, 4, 5, 6, 7, 8, 9])
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
test("contract reward increase applies once before era, difficulty and preview multipliers", (t) => {
  const f = fixture(t, { difficulty: 3 });
  for (const o of f.room.game.contract.objectives) o.status = "available";
  assert.deepEqual(C.reward(f.room, G), { money: 0, supplies: 0, technology: 0, inventory: {} });
  f.room.game.contract.objectives[0].status = "completed";
  f.room.game.contract.objectives[1].status = "completed";
  const factor = 2 * 1.5;
  assert.deepEqual(C.reward(f.room, G), { money: 1250 * factor, supplies: 1875 * factor, technology: 125 * factor, inventory: {} });
  f.room.settings.sweepEra = "UC_0087_T1";
  const reward = C.reward(f.room, G), era = 1.25 ** 2;
  assert.equal(reward.money, 1250 * factor * era);
  assert.equal(reward.supplies, 1875 * factor * era);
  assert.equal(reward.technology, 125 * factor * era);
  const bonuses = { money: 1.5, supplies: 2, technology: 0 };
  const pending = C.view(f.room, G, bonuses).pending;
  for (const key of Object.keys(bonuses)) assert.equal(pending[key], Math.round(reward[key] * bonuses[key] / 25) * 25);
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
  assert.equal(g.units.length - before, 7);
  // Airborne defenders outside the perimeter do not prevent progress until they enter it.
  const enemy = g.units.at(-1);
  moveTo(G, enemy, o);
  const held = o.progress;
  g.round += 2;
  const waves = g.contract.wave;
  C.poll(f.room, G);
  assert.equal(o.progress, held);
  assert.equal(g.contract.wave - waves, 4); // Three objective squads plus the periodic edge patrol.
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
  assert.equal(C.squadCount(7), 3);
});

test("factories have difficulty-scaled health, summon one squad per loss exactly once and alert nearby patrols on damage", (t) => {
  for (const difficulty of [1, 9]) {
    // Find a seed including factories even when N1 only selects two event kinds.
    let f, o;
    for (let seed = 10; !o; seed++) {
      f = fixture(t, { difficulty, seed });
      o = f.room.game.contract.objectives.find((o) => o.type === "factory");
    }
    const g = f.room.game,
      targets = o.targets.map((id) => g.units.find((u) => u.id === id));
    assert.equal(targets.length, difficulty === 1 ? 2 : 4);
    assert(
      targets.every((u) => u.hp === (difficulty === 1 ? 20000 : 60000) && G.modelOf(u).hp === u.hp),
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
    assert.equal(g.units.length - count, 2);
    C.poll(f.room, G);
    assert.equal(g.units.length - count, 2);
    for (const u of targets) u.hp = 0;
    C.poll(f.room, G);
    assert.equal(o.status, "completed");
    assert.equal(g.units.length - count, Math.round(targets.length * 3 * 0.75));
  }
});

for (const trigger of ["factory", "capture", "salvage", "guard damage"])
  test(`contract ${trigger} signals do not recruit another event's garrison`, t => {
    const f = fixture(t), g = f.room.game;
    const commands = g.contract.objectives.filter(o => o.type === "command");
    const objective = trigger === "guard damage" ? g.contract.objectives.find(o=>o.type === "factory") :
      g.contract.objectives.find(o => o.type === trigger);
    const foreign = g.units.find(u => u.id === commands[0].targets[0]);
    const own = g.units.find(u => u.team === 1 && !u.facility &&
        Math.max(Math.abs(u.x-objective.x),Math.abs(u.y-objective.y)) < 9);
    const roaming = g.units.find(u => u.team === 1 && !u.facility);
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
          const room = { settings: { sweepEra: era, sweepFaction: faction, sweepEnvironment: environment, sweepDifficulty: 9 } };
          for (const item of C.enemies(room, G, seed))
            assert(C.suitableEnvironment(G.models[item.unitId + "__" + item.kitId], environment));
        }
});

test("each additional human adds twenty percent mobile enemies, including event pursuit", (t) => {
  for (const environment of ["ground", "space"]) {
    let baseline;
    for (let players = 1; players <= 5; players++) {
      const f = fixture(t, { players, environment }), g = f.room.game;
      const count = () => g.units.filter((u) => u.team === 1 && !u.facility).length;
      if (players === 1) baseline = count();
      assert.equal(g.contract.enemyBaseCount, baseline);
      assert.equal(count(), Math.round(baseline * (1 + (players - 1) * 0.2)));
      for (const u of g.units.filter((u) => u.team === 1 && !u.facility))
        assert(C.suitableEnvironment(G.modelOf(u), environment));
      clearEnemies(f);
      const o = g.contract.objectives.find((o) => o.type === "salvage");
      moveTo(G, f.actor, o);
      C.action(f.room, G, f.member, { action: "contract_interact", unitId: f.actor.id, objectiveId: o.id });
      assert.equal(count(), Math.round(baseline * (1 + (players - 1) * 0.2)) + Math.round(3 * (1 + (players - 1) * 0.2)));
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
    costLimit: 20000, mapId: C.mapId("ground", 9), fogMode: "full", pilotPolicy: "allow",
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
test("edge patrols arrive every four full player turns with 25 percent fewer reinforcements", (t) => {
  const f = fixture(t),
    g = f.room.game;
  clearEnemies(f);
  for (const o of g.contract.objectives) o.status = "completed";
  G.resolveAutomatic(f.room, [], () => "cleared-enemies");
  const count = g.units.length;
  for (let turn = 1; turn <= 16; turn++) {
    G.end(g);
    C.poll(f.room, G);
    assert.equal(g.units.length, count + Math.round(Math.floor((turn - 1) / 4) * 2.25));
    G.end(g);
    C.poll(f.room, G);
    const expected = count + Math.round(Math.floor(turn / 4) * 2.25);
    assert.equal(g.units.length, expected);
    C.poll(f.room, G);
    assert.equal(g.units.length, expected);
    assert.equal(g.winner, null);
    assert.equal(f.room.phase, "idle");
  }
  for (const u of g.units.slice(count)) {
    if (u.squadId) assert(G.squadMembers(g,u).length<=3);
    assert(C.suitableEnvironment(G.modelOf(u), "ground"));
    assert.equal(C.aiOrder(g, G, u).alerted, false);
  }
  assert(g.units.slice(count).some(u=>G.squadMembers(g,u).length>=2),"compatible reinforcements share a battle cell as a real squad");
});

test("multiplayer edge reinforcements form several legal squads and only track their own contacts", t => {
  const f = fixture(t,{players:4}), g=f.room.game;
  clearEnemies(f);
  for(const objective of g.contract.objectives) objective.status="completed";
  const before=g.units.length;
  for(let turn=0;turn<8;turn++) { g.round+=2; C.poll(f.room,G); }
  const patrols=g.units.slice(before);
  assert.equal(patrols.length,7,"six base units times 75% times 160%, rounded cumulatively");
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
    for (let difficulty = 1; difficulty <= 9; difficulty++) {
      const settings = { sweepDifficulty: difficulty, sweepEnvironment: environment },
        a = C.generateMap(G.catalog, settings, 910 + difficulty),
        b = C.generateMap(G.catalog, settings, 1710 + difficulty);
      assert(a.width * a.height > previous);
      previous = a.width * a.height;
      assert.notDeepEqual(a.tiles, b.tiles);
      assert.deepEqual(a, C.generateMap(G.catalog, settings, 910 + difficulty));
      assert.equal(
        C.config(difficulty).costLimit,
        [2000, 4000, 6000, 8000, 10000, 12500, 15000, 17500, 20000][difficulty - 1],
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
  assert.equal(f.room.settings.costLimit, 8000);
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

test("five-player contracts deploy together at one edge on ground and in space", (t) => {
  for (const environment of ["ground", "space"]) {
    const f = fixture(t, { players: 5, environment, difficulty: 9 });
    assert.equal(f.room.settings.costLimit, 20000);
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
    for (const difficulty of [1, 5, 9])
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

test("compact shared deployment supports five full four-carrier fleets and large ships fit extraction", () => {
  for (const environment of ["ground", "space"]) {
    const unitId = environment === "space" ? "AlbionClass" : "Medea",
      settings = {
        mode: "sweep",
        sweepDifficulty: 9,
        costLimit: 20000,
        sweepEnvironment: environment,
        sweepEra: "UC_0087_T2",
        sweepFaction: "AEUG",
      },
      formations = Array.from({ length: 10 }, (_, seat) =>
        seat % 2 ? null : Array.from({ length: 4 }, () => ({ unitId, kitId: "standard" })),
      ),
      game = G.create(false, 190, formations, true, settings);
    // Exercise the real deployment solver, not just rectangle arithmetic.
    for (const seat of [0, 2, 4, 6, 8]) {
      G.autoPlaceDeployment(game, seat);
      const actors = game.units.filter((u) => G.ownerOf(u) === seat && !u.embarked);
      assert.equal(actors.length, 4);
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

for(const [difficulty,limit] of [[1,24],[5,36],[9,48]])
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
    assert.equal(alive().length,limit);
    assert.equal(g.units.length,count+1,"partial wave fills only the available slot");
  });

test("event transports, factory defenders and capture airdrops cannot bypass the shared reinforcement cap", t => {
  const f=fixture(t),g=f.room.game,limit=C.config(9).patrolLimit;
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
