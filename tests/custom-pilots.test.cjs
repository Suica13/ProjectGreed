const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../shared/pilots.js');
const G = require('../shared/rules.js');
const fresh = () => P.createCustom('custom-test-1', '驾驶员[X29]', P.catalog.named[1].id);
const entry = p => ({unitId: 'RGM_79', kitId: 'machine_gun', customPilot: p});
test('custom pilot creation, leveling, overflow reset and strengthening budget', () => {
  let p = fresh();
  assert.equal(p.level, 1); assert.equal(p.points, 0); assert.equal(P.cost(p), 25);
  assert.equal(p.stats.awakening, 50); assert.equal(p.stats.shooting, 100);
  p = P.gainExperience(p, 999); assert.equal(p.experience, 999);
  p = P.gainExperience(p, 4000);
  assert.equal(p.level, 2); assert.equal(p.experience, 0); assert.equal(p.points, 10);
  assert.equal(P.experienceRequired(p.level), 2000); assert.equal(P.cost(p), 50);
  p.stats.shooting += 10;
  assert.equal(P.custom(p).points, 0);
  p.stats.defense++;
  assert.throws(() => P.custom(p), /强化点/);
  p = fresh(); p.level = 20; p.stats.shooting = 161;
  assert.throws(() => P.custom(p), /属性/);
});
test('custom attachment survives authoritative validation and deployment with fixed stats', () => {
  const p = fresh();
  const e = entry(p), base = G.models['RGM_79__machine_gun'].cost;
  assert.deepEqual(G.validateFormation([e], base + 25)[0].customPilot, p);
  assert.throws(() => G.validateFormation([e], base + 24), /COST/);
  assert.throws(() => G.validateFormation([e, e], Infinity), /同一驾驶员/);
  const plan = G.planFormation([e], base + 24);
  assert.equal(plan.totalCost, base + 25); assert.equal(plan.deployCost, 0);
  const g = G.create(false, 42, [[e], [{unitId:'RGM_79',kitId:'machine_gun'}]]);
  assert.deepEqual(g.units[0].pilot, p);
  assert.equal(P.portrait(g.units[0].pilot), P.catalog.named[1].icon);
  assert.equal(JSON.stringify(e).includes('data:image'), false);
});
test('default pilots retain faction and seeded variation, custom values reject malformed progression', () => {
  for (const faction of ['EFSF', 'ZEON']) {
    const model = Object.values(G.models).find(m => m.faction === faction && !P.commandUnit(m));
    for (let seed=0;seed<50;seed++) {
      const p = P.roll(null, seed, 0, 0, model);
      assert.match(p.name, faction === 'EFSF' ? /联邦/ : /吉翁/);
      for (const [key, [lo, hi]] of Object.entries(P.catalog.defaultRanges))
        assert.ok(p.stats[key] >= lo && p.stats[key] <= hi);
    }
  }
  for (const patch of [{level:0}, {level:1.5}, {experience:1000}, {experience:-1}, {name:''}])
    assert.throws(() => P.custom({...fresh(), ...patch}));
});

test('battle logs identify custom pilots while default pilots retain unit identity', () => {
  const u = { model: 'RGM_79__machine_gun', customName: '吉姆[X29]', pilot: fresh() };
  assert.equal(G.pilotUnitName(u), '驾驶员[X29]驾驶的吉姆[X29]');
  delete u.pilot;
  assert.equal(G.pilotUnitName(u), '吉姆[X29]');
});

test('room kill awards are authoritative, private to the owner, and logged with the pilot name', t => {
  const {createRoomEngine} = require('../shared/room-engine.js');
  let seq=0;
  const frames = new Map();
  const engine = createRoomEngine({rules:G, randomId:()=>`id-${++seq}`, randomSeed:()=>1,
    randomToken:()=>`token-${++seq}`, send:(ws,msg)=>frames.set(ws,msg)});
  t.after(()=>engine.close());
  const clients=[{readyState:1},{readyState:1}];
  clients.forEach((ws,i)=>engine.join(ws,{mode:i?'join':'create',room:'PILOT',characterFaction:'PMC'}));
  const room=engine.rooms.get('PILOT');
  function act(i,action,fields={}) {
    const request = {id:`req-${++seq}`,revision:room.revision,round:room.game.round,
      matchId:room.matchId,reactionId:frames.get(clients[i])?.pending?.id,action,...fields};
    engine.action(clients[i], request);
    return request;
  }
  act(0, "configure_room", {...G.defaultRoomSettings(), costLimit:99999, unitCostLimit:99999, fogMode:"disabled"});
  const tank = {unitId:'Type61',kitId:'standard'};
  const victim = P.custom({...fresh(), id:"custom-victim", experience:600});
  const formations=[[{...tank,customPilot:fresh()}],[{...tank,customPilot:victim}]];
  clients.forEach((_,i)=>act(i,'set_ready',{ready:true,formation:formations[i]}));
  act(0,'start_game',{formation:formations[0]});
  clients.forEach((_,i)=>act(i,'confirm_formation'));
  clients.forEach((_,i)=>act(i,'confirm_deployment'));
  const [a,b]=room.game.units;
  Object.assign(a,{x:2,y:4,hp:100000,shield:0});
  Object.assign(b,{x:4,y:4,hp:1,shield:0});
  room.game.tiles.forEach(row=>row.fill('plain'));
  // Force the deterministic hit roll, not a client-supplied damage result.
  room.game.seed=1;
  act(0,'attack',{unitId:a.id,targetId:b.id,weaponId:'EF_Type61_Cannon'});
  act(0,'end_turn');
  const response = act(1,'respond',{response:'defend'});
  engine.action(clients[1], response);
  assert.equal(b.hp,0);
  const awards=frames.get(clients[0]).pilotAwards;
  assert.equal(awards.length,1);
  assert.equal(awards[0].points,G.models[b.model].cost);
  assert.equal(awards[0].pilotId,a.pilot.id);
  const losses = frames.get(clients[1]).pilotAwards;
  assert.equal(losses.length, 1);
  assert.equal(losses[0].kind, "loss");
  assert.equal(losses[0].pilotId, victim.id);
  assert.equal(b.pilot.experience, 350);
  assert.equal(b.pilot.record.losses, 1);
  assert.equal(b.pilot.record.lostCost, G.models[b.model].cost);
  assert.equal(a.pilot.record.kills, 1);
  assert.equal(a.pilot.record.destroyedCost, G.models[b.model].cost);
  assert(room.log.some(line=>line.includes('驾驶员[X29]驾驶的')));
  assert.equal(a.pilot.experience,G.models[b.model].cost);
});

test('loss deducts one quarter of the level threshold, preserves levels and never goes negative', () => {
  let p=P.custom({...fresh(),level:3,experience:3000});
  p=P.battleResult(p,'loss',500);
  assert.equal(p.experience,2000); assert.equal(p.level,3); assert.equal(p.points,20);
  assert.deepEqual(p.record,{kills:0,losses:1,destroyedCost:0,lostCost:500});
  p=P.battleResult(p,'loss',250);
  p=P.battleResult(p,'loss',250);
  p=P.battleResult(p,'loss',250);
  assert.equal(p.experience,0); assert.equal(p.record.losses,4); assert.equal(p.record.lostCost,1250);
  assert.throws(()=>P.custom({...p,record:{kills:-1}}),/战绩/);
});

test('persisted award receipts deduplicate kills and losses across repeated snapshots and reloads', () => {
  let store={pilots:[P.custom({...fresh(),experience:900})],awards:[]};
  const kill={id:'event-1',pilotId:fresh().id,kind:'kill',points:100};
  const loss={id:'event-2',pilotId:fresh().id,kind:'loss',points:50};
  assert(P.creditAwards(store,[kill,loss,kill]));
  assert.equal(store.pilots[0].level,2);
  assert.equal(store.pilots[0].experience,0);
  assert.deepEqual(store.pilots[0].record,{kills:1,losses:1,destroyedCost:100,lostCost:50});
  store=JSON.parse(JSON.stringify(store));
  assert.equal(P.creditAwards(store,[kill,loss]),false);
  assert.equal(store.pilots[0].record.losses,1);
});

test('match saves preserve pilot progression and records, rejecting invalid imported stats', () => {
  const R=require('../shared/match-records.js');
  const tank={unitId:'Type61',kitId:'standard'};
  const p=P.battleResult(P.custom({...fresh(),level:2,experience:800}),'loss',50);
  const game=G.create(false,5,[[{...tank,customPilot:p}],[tank]]);
  const room={game,settings:{...G.defaultRoomSettings(),mapId:game.mapId},seats:[{},{}]};
  const save=R.createSave(G,room);
  assert.deepEqual(R.validateSave(G,save).game.units[0].pilot,p);
  save.game.units[0].pilot.stats.shooting=161;
  assert.throws(()=>R.validateSave(G,save),/属性/);
});
