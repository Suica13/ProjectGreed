const test = require('node:test');
const assert = require('node:assert/strict');
const G = require('../shared/rules');
const B = G.battlefieldMode;

test('era strength is authoritative for both sides, including mixed eras and control damage', () => {
  const rows = [['0079T1',20000],['0079T2',30000],['0087T1',45000],['0087T2',60000]];
  for (const [era, maximum] of rows) {
    const settings = {...B.presetSettings(era+'-standard',null,G.eras),mode:'battlefield',mapId:B.defaultMapId};
    const game = G.create(false,7319,Array(12).fill(null),false,settings);
    assert.deepEqual(game.battlefield.maximum,[maximum,maximum]);
    assert.deepEqual(game.battlefield.strength,[maximum,maximum]);
    const base = game.units.find(u=>u.facility?.type==='base' && u.team===0);
    base.hp *= 0.5;
    B.sync(G,game);
    assert.equal(game.battlefield.strength[0],maximum/2);
    game.battlefield.points[0].owner = 0;
    game.round = 2;
    B.advance(G,game);
    assert.equal(game.battlefield.strength[1],maximum-maximum/100);
  }
  const game=G.create(false,3,Array(12).fill(null),false,{mode:'battlefield',mapId:B.defaultMapId,
    battlefieldTeams:[{faction:'EFSF',era:'0079T1'},{faction:'TITANS',era:'0087T2'}]});
  assert.deepEqual(game.battlefield.maximum,[20000,60000]);
});

test('fixed eras require compatible teams and an exact scale, custom keeps arbitrary valid scales', () => {
  for (const preset of B.roomPresets) {
    const settings={mode:'battlefield',...B.presetSettings(preset.id,null,G.eras)};
    assert.equal(B.validateRoomSelection(settings),preset.era);
    assert.throws(()=>B.validateRoomSelection({...settings,costLimit:settings.costLimit+25}),/固定年代/);
    assert.throws(()=>B.validateRoomSelection({...settings,battlefieldEra:'invalid'}),/年代/);
    assert.equal(B.validateRoomSelection({...settings,battlefieldEra:'custom',costLimit:99999}),'custom');
    assert.throws(()=>B.validateRoomSelection({...settings,battlefieldEra:B.eras[(B.eras.indexOf(preset.era)+1)%4]}),/固定年代/);
  }
});

test('all four turret base payloads use the increased source damage with normal rounding',()=>{
  const expected={MG:425,Beam:3750,Missile:2250,Cannon:7500};
  const library=require('../assets/weapons.json');
  // Resolve the source reference, including the unit-local increase, without applying runtime conversion twice.
  for(const [name,damage] of Object.entries(expected)) {
    const unit=require('../assets/units/Facility_'+name+'/unit.json');
    const entry=Object.values(unit.weapons)[0];
    const weapon={...library.definitions[entry.ref],...entry.overrides};
    assert.equal(weapon.damagePerShot,damage,name);
    assert.equal(Object.values(weapon.damageComponents).reduce((a,b)=>a+b,0),damage);
  }
});
