const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules');
const D = require('../shared/development');
const E = require('../shared/economy');
const B = require('../shared/battle-economy');
const Sweep = require('../shared/sweep-mode');
const Production = require('../shared/production-data.cjs');
const factions = ['EFSF_0093', 'NEO_ZEON_0093'];
const prerequisites = Object.fromEntries(['EFSF','ZEON','AEUG','NEO_ZEON'].map(f=>[f,D.nodes(f).filter(n=>n.row==='mid').map(n=>n.id)]));

test('0093 native research has valid prerequisites, stock IDs and separate faction progress', () => {
  for (const faction of factions) {
    assert(G.factions.includes(faction));
    const nodes = D.nodes(faction), ids = new Set(nodes.map(n => n.id));
    assert.equal(nodes.length, 4);
    assert.equal(nodes.filter(n => n.placeholder).length, 0);
    assert(D.normalizeResearch(prerequisites)[faction].includes(nodes[0].id));
    for (const node of nodes) {
      assert.equal(node.era, 'UC_0093_T1');
      assert.equal(node.technologyWeight, 5);
      assert(node.column >= 1);
      assert(node.requires.every(id => ids.has(id)));
      for (const id of node.unlocks) {
        const p = G.catalog.prefabs.find(p => p.id === id);
        assert(p, id);
        assert.equal(p.faction, faction);
        assert(E.productionOffer(id, E.defaultKit(id)), id);
      }
      if (node.placeholder) assert.equal(node.unlocks.length, 0);
    }
  }
  assert.equal(G.factionInfo.OMNI.name, '地球联合军');
  assert.equal(G.factionInfo.ZAFT.name, '扎夫特军');
  assert.equal(G.factionInfo.EFSF.color, G.factionInfo.EFSF_0093.color);
  assert.equal(G.factionInfo.ZEON.color, G.factionInfo.NEO_ZEON_0093.color);
  assert.notEqual(G.factionInfo.NEO_ZEON.color, G.factionInfo.ZEON.color);
});

test('0093 point caps and completed research unlock native units without using old EFSF points', () => {
  const researched = {...prerequisites,...Object.fromEntries(factions.map(f => [f, D.nodes(f).map(n => n.id)]))};
  assert(D.allows('PMC', 'RX_93', researched));
  assert(!D.allows('PMC', 'RX_93', {}));
  assert(D.allowsPointCaps('RX_93', {EFSF_0093:12000}));
  assert(!D.allowsPointCaps('RX_93', {EFSF:100000, EFSF_0093:11999}));
  assert(!D.allowsPointCaps('RGZ_91B', {EFSF_0093:100000}));
  assert.deepEqual(Sweep.factionsForEra(G, 'UC_0093_T1').sort(), [...factions].sort());
});

test('legacy progress imports default missing CE and 0093 balances to zero and preserve research', () => {
  const old = D.validateProgress({points:{EFSF:1234,ZEON:5678},claimed:{legacy:'match-1'}});
  assert.equal(old.points.EFSF,1234);
  assert.equal(old.claimed.legacy,'match-1');
  for (const faction of [...factions,'OMNI','ZAFT']) assert.equal(old.points[faction],0);
  const next = D.validateProgress({...old,points:{...old.points,EFSF_0093:6000},researched:{EFSF_0093:D.nodes('EFSF_0093').map(n=>n.id)}});
  assert.equal(next.points.EFSF_0093,6000);
  assert(next.researched.EFSF_0093.includes('Tech_0093_EFSF_Mid03'));
});

test('0093 base research grants permits and research rewards stay in their faction', () => {
  const economy = E.initial();
  for (const id of ['RGM_86R_0093_EFSF','SalamisClassKai_0093_EFSF','AMX_101_0093_NZN','MusaiClassFinalType_0093_NZN'])
    assert(economy.licenses[id],id);
  for (const [id, faction] of [['RX_93','EFSF_0093'],['MSN_04','NEO_ZEON_0093']]) {
    const model = G.models[id+'__'+E.defaultKit(id)];
    assert.deepEqual(B.technologyFactions(model),[faction]);
    const weights = B.technologyWeights({one:{memberId:'p',technologyFactions:[faction]}},'p','PMC');
    assert.deepEqual(B.allocateTechnology(1000,weights,{[faction]:0},{[faction]:8400}),{[faction]:1000});
    assert.equal(Production.licenseOffers[id].faction,faction);
  }
});
