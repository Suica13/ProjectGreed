const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const { createRequire } = require('node:module');
const G = require('../shared/rules');
const { createRoomEngine } = require('../shared/room-engine');
const catalog = require('../tools/load-catalog.cjs').loadCatalog({ embedAssets: false });

function economy(saved) {
  const records = new Map(saved ? [['projectgreed.economy.v1', JSON.stringify(saved)]] : []);
  const context = vm.createContext({ require: createRequire(path.resolve('shared/economy.js')),
    module: { exports: {} }, structuredClone, ART: catalog,
    localStorage: { getItem: k => records.get(k) ?? null, setItem: (k,v) => records.set(k,v), removeItem: k => records.delete(k) } });
  vm.runInContext(fs.readFileSync('shared/economy.js', 'utf8'), context);
  return context.module.exports;
}

test('discard queued reward only, reject stale confirmation, and persist across reload', () => {
  const E = economy();
  E.creditActivity({ id:'depot-test', matchId:'depot-test', money:0, supplies:0, inventory:{ RGM_79:40 } });
  const before = E.snapshot(), queued = before.storage.deliveries;
  assert(queued.length > 2);
  assert.throws(() => E.discardDelivery(0, { ...queued[0], unitId:'stale' }), /保管库内容已变化/);
  assert.equal(JSON.stringify(E.snapshot()), JSON.stringify(before));
  assert.equal(E.discardDelivery(0, queued[0]), true);
  const after = E.snapshot();
  assert.equal(after.storage.deliveries.length, queued.length - 1);
  assert.equal(JSON.stringify(after.inventory), JSON.stringify(before.inventory));
  assert.equal(JSON.stringify(after.storage.units), JSON.stringify(before.storage.units));
  assert.equal(after.money, before.money); assert.equal(after.supplies, before.supplies);
  assert.equal(JSON.stringify(economy(after).snapshot().storage.deliveries), JSON.stringify(after.storage.deliveries));
});

test('all three weapon-container ground units and their kits are support roles', () => {
  for (const id of ['RGM_79_G_WithBackpack','RX_79_G_WithBackpack','RX_79_G_Ez8_WithBackpack']) {
    const models = Object.values(G.models).filter(m => m.prefabId === id);
    assert(models.length > 0);
    for (const model of models) assert.equal(model.combatRole, 'support', model.id);
  }
});

test('in-place armor purge keeps warehouse identity and installed plugins', () => {
  const game=G.create(false,1,[[{unitId:'RX_78_1',kitId:'beam_rifle'}],[{unitId:'MS_06F',kitId:'machine_gun'}]]);
  const unit=game.units[0],model=G.models[unit.model],saved=model.skills;
  const skill=structuredClone(G.unitSkills(unit)[0]);
  skill.source={mode:'transform',unitId:'RGM_79',kitId:'machine_gun',inheritResources:true,
    hpRecoveryPercent:0,enRecoveryPercent:0,shieldRecoveryPercent:0,repairAllParts:false};
  delete skill.spawn;
  Object.assign(unit,{x:4,y:5,stockId:'stored-purge',plugins:[null,null,null,null],
    deploymentUnitId:'RX_78_1',deploymentModel:'RX_78_1__beam_rifle'});
  model.skills=[skill];
  try {
    G.useSkill(game,unit,skill.id,4,5);
    assert.equal(unit.model,'RGM_79__machine_gun');assert.equal(unit.stockId,'stored-purge');
    assert.deepEqual(unit.plugins,[null,null,null,null]);
    assert.equal(unit.deploymentModel,'RX_78_1__beam_rifle');
  } finally {model.skills=saved;}
});

test('settlement restores sortie form and kit with proportional damage, EN and broken parts', t => {
  let n = 0;
  const engine = createRoomEngine({ rules:G, randomId:()=>'return-'+ ++n, randomToken:()=>'token-'+ ++n,
    randomSeed:()=>7319, aiDelayMs:999999, send:()=>{} });
  t.after(()=>engine.close());
  const host={readyState:1};
  engine.join(host,{mode:'create',room:'RETURN',roomMode:'mission',characterFaction:'PMC',
    inventory:{ColumbusClass:5},licenses:{ColumbusClass:true}});
  const room=engine.rooms.get('RETURN');
  const act=(action,data={})=>engine.action(host,{id:'req-'+ ++n,revision:room.revision,round:room.game.round,
    phase:room.phase,matchId:room.matchId,action,...data});
  act('start_game',{formation:[{unitId:'ColumbusClass',kitId:'standard'}]});
  act('confirm_formation');G.aiDeployment(room.game,0);act('confirm_deployment');
  while(room.game.mission.dialogue){const d=room.game.mission.dialogue;act('mission_dialogue_next',{dialogueId:d.id,lineIndex:d.index});}
  const actor=room.game.units.find(u=>!u.missionGuest&&G.ownerOf(u)===0);
  const record=room.battleRoster[actor.id];
  const original='RX_78_1__beam_rifle';
  Object.assign(record,{unitId:'RX_78_1',stockModel:original,stockId:'stored-return'});
  Object.assign(actor,{model:'RGM_79__machine_gun',brokenParts:{leftArm:true}});
  const current=G.modelOf(actor), target=G.modelOf({...actor,model:original});
  actor.hp=current.hp*0.4;actor.en=current.en*0.2;
  room.game.units.find(u=>u.missionActor==='whitebase').hp=0;
  engine.broadcast(room);
  const award=room.economyAwards.find(a=>a.kind==='result');
  assert(award);
  const state=award.stockStates.find(s=>s.stockId==='stored-return');
  assert.equal(state.unitId,'RX_78_1');assert.equal(state.kitId,'beam_rifle');
  assert.equal(state.hp,Math.round(target.hp*0.4));assert.equal(state.en,target.en*0.2);
  assert.deepEqual(state.brokenParts,{leftArm:true});
  engine.broadcast(room);
  assert.equal(room.economyAwards.filter(a=>a.kind==='result').length,1);
});
