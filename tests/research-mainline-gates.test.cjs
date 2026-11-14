const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../shared/development');
const main = f => D.nodes(f).filter(n => n.row === 'mid').map(n => n.id);
const progress = (...factions) => Object.fromEntries(factions.map(f => [f, main(f)]));

test('0079 faction main lines open only their matching 0087 trees without side branches', () => {
  const federation = progress('EFSF');
  assert.equal(D.eraLocked('AEUG', federation), false);
  assert.equal(D.eraLocked('TITANS', federation), false);
  assert.equal(D.eraLocked('NEO_ZEON', federation), true);
  const zeon = progress('ZEON');
  assert.equal(D.eraLocked('AEUG', zeon), true);
  assert.equal(D.eraLocked('TITANS', zeon), true);
  assert.equal(D.eraLocked('NEO_ZEON', zeon), false);
  for (const f of ['EFSF', 'ZEON']) {
    assert(D.mainlineComplete(f, progress(f)));
    const partial = {[f]: main(f).slice(0,-1)};
    assert(!D.mainlineComplete(f, partial));
    const branches = {[f]: D.nodes(f).filter(n => n.row !== 'mid').map(n => n.id)};
    assert(!D.mainlineComplete(f, branches));
  }
});

test('0093 Federation accepts either complete AEUG or Titans main line, Zeon requires Neo Zeon', () => {
  for (const prior of ['AEUG','TITANS']) {
    const research = progress('EFSF',prior);
    assert(!D.eraLocked('EFSF_0093',research));
    assert(D.eraLocked('NEO_ZEON_0093',research));
    research[prior].pop();
    assert(D.eraLocked('EFSF_0093',research));
  }
  assert(!D.eraLocked('NEO_ZEON_0093',progress('ZEON','NEO_ZEON')));
  assert(D.eraLocked('EFSF_0093',progress('ZEON','NEO_ZEON')));
  assert(D.eraLocked('EFSF_0093',progress('AEUG','TITANS')));
  assert(D.eraLocked('NEO_ZEON_0093',progress('NEO_ZEON')));
});

test('locked stored research survives export but cannot unlock units until its upstream main lines complete', () => {
  const saved = D.validateProgress({points:{EFSF_0093:12000},claimed:{},researched:progress('EFSF_0093')});
  assert(saved.researched.EFSF_0093.includes('Tech_0093_EFSF_Mid03'));
  assert.deepEqual(D.normalizeResearch(saved.researched).EFSF_0093,[]);
  assert(!D.allows('PMC','RX_93',saved.researched));
  const restored = {...saved.researched,...progress('EFSF','AEUG')};
  assert(D.allows('PMC','RX_93',restored));
  assert(D.mainlineComplete('EFSF_0093',restored));
  assert.deepEqual(D.normalizeResearch(D.normalizeResearch(restored)),D.normalizeResearch(restored));
});

test('0093 production caps use doubled native costs and contain no placeholder stages', () => {
  for (const f of ['EFSF_0093','NEO_ZEON_0093']) {
    assert.deepEqual(D.nodes(f).map(n=>n.points),[0,2400,7200,12000]);
    assert(!D.nodes(f).some(n=>n.placeholder));
    for (const node of D.nodes(f)) assert.equal(node.points,node.sourceCosts.points*2);
    assert.equal(D.maximumPoints(f),12000);
  }
  assert(!D.allowsPointCaps('RX_93',{EFSF_0093:11999}));
  assert(D.allowsPointCaps('RX_93',{EFSF_0093:12000}));
});

test('AI research retains the matching legacy main-line proof without requiring branch research', () => {
  const active = D.aiResearch([{characterFaction:'AEUG',researched:progress('EFSF','AEUG')}]);
  assert(D.mainlineComplete('AEUG',active));
  assert(!D.eraLocked('TITANS',active));
  assert(D.eraLocked('NEO_ZEON',active));
});
