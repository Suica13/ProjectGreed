const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules');
const C = require('../shared/contract-mode');
const { createRoomEngine } = require('../shared/room-engine');

function fixture(t, difficulty, { ace = false, multiplier = 1, aiDelayMs = 999999 } = {}) {
  let serial = 0;
  const errors = [], frames = [];
  const engine = createRoomEngine({ rules: G, randomId: () => 'cxp-' + ++serial,
    randomToken: () => 'token-' + ++serial, randomSeed: () => 1936384585,
    aiDelayMs, roomReturnMs: 999999,
    getRewardMultipliers: () => ({ money: 1, supplies: 1, technology: 1, experience: multiplier }),
    send: (ws, message) => { frames.push(message); if (message.type === 'error') errors.push(message.message); },
  });
  t.after(() => engine.close());
  const ws = { readyState: 1 }, pilot = ace
    ? G.pilots.createAce(G.pilots.catalog.aces.find(p => p.id.endsWith('_CHA')).id)
    : G.pilots.createCustom('custom-contract-xp', 'Contract');
  engine.join(ws, { mode: 'create', room: 'CONTRACTXP', roomMode: 'sweep', characterFaction: 'PMC',
    inventory: { Medea: 2 }, licenses: { Medea: true } });
  const room = engine.rooms.get('CONTRACTXP');
  const act = (action, fields = {}) => engine.action(ws, { id: 'act-' + ++serial,
    revision: room.revision, round: room.game.round, phase: room.phase, matchId: room.matchId, action, ...fields });
  act('configure_room', { ...room.settings, sweepDifficulty: difficulty });
  act('start_game', { formation: [{ unitId: 'Medea', kitId: 'standard', customPilot: pilot }] });
  act('confirm_formation');
  act('auto_place_deployment');
  act('confirm_deployment');
  assert.deepEqual(errors, []);
  assert.equal(room.phase, 'idle');
  const actor = room.game.units.find(u => u.pilot?.id === pilot.id);
  const settle = () => {
    const exit = room.game.contract.extractions[0];
    Object.assign(actor, { x: exit.x + 1, y: exit.y + 1, acted: false, moved: false });
    act('contract_extract', { unitId: actor.id });
    assert.deepEqual(errors, []);
    assert.equal(room.economySettled, true);
  };
  return { room, actor, pilot, act, settle, frames };
}

for (const [difficulty, expected] of [[1,500],[2,1000],[3,1500],[4,3000],[5,4000],[6,5000]])
  test(`N${difficulty} pays ${expected} XP per deployed PMC/ACE at settlement only`, t => {
    const f = fixture(t, difficulty, { ace: difficulty % 2 === 0 });
    for (const o of f.room.game.contract.objectives) o.status = 'completed';
    f.room.game.contract.objectives.push({ id: 'contact-extra', contactTaskId: 'extra', status: 'active' });
    assert.equal(f.actor.pilot.experience, 0);
    assert.equal(C.reward(f.room, G).experience, expected);
    f.settle();
    const awards = f.room.pilotAwards.filter(a => a.kind === 'contract');
    assert.equal(awards.length, 1);
    assert.equal(awards[0].experiencePoints, expected);
    assert.equal(f.actor.pilot.experience, expected);
    const store = { pilots: [f.pilot], awards: [] };
    assert.equal(G.pilots.creditAwards(store, awards, { settled: false }), false);
    assert(G.pilots.creditAwards(store, f.room.pilotAwards));
    assert.equal(store.pilots[0].experience, expected);
    assert.equal(store.pilots[0].record.battles, 1);
    assert.equal(store.pilots[0].record.kills, 0);
    f.act('sync'); f.act('sync');
    assert.equal(f.room.pilotAwards.filter(a => a.kind === 'contract').length, 1);
    assert.equal(G.pilots.creditAwards(store, f.room.pilotAwards), false);
  });

test('partial completion scales XP, excludes contact events and retains activity multiplier', t => {
  const f = fixture(t, 3, { multiplier: 2 });
  f.room.game.contract.objectives.forEach((o, i) => o.status = i === 0 ? 'completed' : 'failed');
  f.room.game.contract.objectives.push({ id: 'contact-extra', contactTaskId: 'extra', status: 'completed' });
  f.settle();
  assert.equal(f.actor.pilot.experience, 1000);
});

test('zero ordinary completion grants no XP even with completed contact event', t => {
  const f = fixture(t, 1);
  f.room.game.contract.objectives.push({ id: 'contact-extra', contactTaskId: 'extra', status: 'completed' });
  f.settle();
  assert.equal(f.actor.pilot.experience, 0);
  assert.equal(f.room.pilotAwards.filter(a => a.kind === 'contract').length, 0);
});

test('casualties receive settlement XP, while undeployed and maximum-level pilots do not', t => {
  const f = fixture(t, 1);
  const casualty = { ...f.actor, id: 'casualty', hp: 0,
    pilot: G.pilots.battleResult(G.pilots.createCustom('custom-casualty-xp', 'Casualty'), 'loss', 0, 0) };
  const undeployed = { ...f.actor, id: 'not-deployed', hp: 0,
    pilot: G.pilots.createCustom('custom-unspawned-xp', 'Not deployed') };
  const capped = { ...f.actor, id: 'capped', hp: 0,
    pilot: G.pilots.custom({ ...G.pilots.createCustom('custom-capped-xp', 'Capped'), level: 8 }) };
  f.room.game.units.push(casualty, undeployed, capped);
  for (const actor of [casualty, capped]) f.room.pilotParticipants.add('0:' + actor.pilot.id);
  f.room.game.contract.objectives[0].status = 'completed';
  f.settle();
  assert.equal(casualty.pilot.experience, 500);
  assert.equal(casualty.pilot.needsRecruitment, true);
  assert.equal(undeployed.pilot.experience, 0);
  assert.equal(capped.pilot.experience, 0);
  assert.equal(f.room.pilotAwards.filter(a => a.kind === 'contract' && a.pilotId === undeployed.pilot.id).length, 0);
});

test('contract kills record combat results without immediate XP', async t => {
  const f = fixture(t, 1, { aiDelayMs: 1 });
  const target = f.room.game.units.find(u => u.team === 1 && !u.facility);
  const model = G.models.Type61__standard;
  G.models.Type61__standard = { ...model, weapons: model.weapons.map(w => ({ ...w, hitScale: 1e6 })) };
  t.after(() => { G.models.Type61__standard = model; });
  for (const u of [f.actor, target]) Object.assign(u, { model: 'Type61__standard', hp: model.hp,
    en: model.en, shield: 0, moved: false, acted: false });
  Object.assign(f.actor, { x: 4, y: 4 });
  Object.assign(target, { x: 6, y: 4, hp: 1 });
  f.room.game.tiles.forEach(row => row.fill('plain'));
  f.room.game.seed = 1;
  f.act('attack', { unitId: f.actor.id, targetId: target.id });
  f.act('end_turn');
  for (let i=0;i<100 && target.hp>0;i++) await new Promise(resolve => setTimeout(resolve,25));
  assert.equal(target.hp, 0);
  const kill = f.room.pilotAwards.find(a => a.kind === 'kill' && a.pilotId === f.pilot.id);
  assert(kill);
  assert.equal(kill.experiencePoints, 0);
  assert.equal(f.actor.pilot.experience, 0);
  assert.equal(f.actor.pilot.record.kills, 1);
  assert.equal(f.room.economySettled, false);
});
