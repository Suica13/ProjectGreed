const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),D=require('../shared/development'),E=require('../shared/economy');
const Coatings=require('../shared/armor-coatings');
const Eras=require('../shared/technology-eras');
const entry=id=>({unitId:id,kitId:G.catalog.prefabs.find(p=>p.id===id).weaponKits[0].id});

test('SEED roster and native technology expose playable OMNI and ZAFT units and factory prices',()=>{
  const roster=G.catalog.prefabs.filter(p=>p.source.startsWith('GW_BattleUniverse_DLC_SEED/'));
  assert(roster.length>=62);
  for(const p of roster){
    assert(['OMNI','ZAFT'].includes(p.faction),p.id);
    assert(p.tags.includes('CE_0071_T1'),p.id);
    assert(E.defaultKit(p.id),p.id);
  }
  assert.equal(D.nodes('OMNI').length+D.nodes('ZAFT').length,13);
  for(const faction of ['OMNI','ZAFT'])assert(D.unlockedTech(faction).includes('Tech_'+faction+'_CE71_BaseTech'));
  assert(E.initial().licenses.LinearGunTank);
  for(const id of ['GAT_X105','GAT_X105_A','GAT_X105_L','GAT_X105_S','GAT_X303_MA','ArchangelClass','ZGMF_1017'])assert(G.models[id+'__'+entry(id).kitId],id);
});

test('UC and CE weights normalize legacy eras and compare parallel timelines',()=>{
  assert.deepEqual(Object.values(Eras.weights),[1,2,3,4,5,1]);
  assert.equal(Eras.normalize('0083'),'UC_0079_T2');
  assert.equal(Eras.normalize('0087T1'),'UC_0087_T1');
  const cap=G.armyRestrictions({...G.defaultRoomSettings(),mode:'sweep',sweepEra:'CE_0071_T1'},{});
  assert(cap.allowedEras.includes('UC_0079_T1'));
  assert(!cap.allowedEras.includes('UC_0087_T1'));
  for(const p of G.catalog.prefabs)assert(p.tags.some(t=>G.eras.includes(t)),p.id);
});

test('ABC and PS keep separate finite resources and previews never mutate actors',()=>{
  const model={en:1000,abc:{capacity:15000,reductions:{beam:.6,meleeBeam:.3}},phaseShift:{capacity:15000,energyPercent:20,reductions:{shell:.8,melee:.2}}};
  const unit={en:1000},state=Coatings.snapshot(model,unit),tracker={};
  assert.equal(Coatings.protect(1000,'beam',false,model,state,tracker),400);
  assert.equal(Coatings.protect(1000,'shell',false,model,state,tracker),200);
  assert.deepEqual(unit,{en:1000});
  Coatings.advance(state,tracker);Coatings.consume(model,unit,state);
  assert.equal(unit.abcHp,14400);assert.equal(unit.phaseShiftHp,14200);assert.equal(unit.en,989);
  unit.phaseShiftEnabled=false;
  assert(!Coatings.active(model,unit,'phaseShift'));
  unit.phaseShiftEnabled=true;unit.en=0;
  assert(!Coatings.active(model,unit,'phaseShift'));
  assert(Coatings.active(model,unit,'abc'));
});

test('PS toggle is authoritative, round limited, and disables the actual armor state',()=>{
  const game=G.create(false,1,[[entry('GAT_X105')],[entry('ZGMF_1017')]],false,{costLimit:99999,unitCostLimit:99999});
  const unit=game.units[0];
  assert(G.phaseShiftActive(unit));
  assert(G.canUseSkill(game,unit,'PhaseShift'));
  const event=G.useSkill(game,unit,'PhaseShift',unit.x,unit.y);
  assert.equal(event.phaseShiftEnabled,false);assert(!G.phaseShiftActive(unit));
  assert(!G.canUseSkill(game,unit,'PhaseShift'));
  game.round+=2;
  assert(G.canUseSkill(game,unit,'PhaseShift'));
  G.useSkill(game,unit,'PhaseShift',unit.x,unit.y);
  assert(G.phaseShiftActive(unit));
});

test('transformations preserve PS durability and its disabled state instead of refilling armor',()=>{
  const game=G.create(false,1,[[entry('GAT_X303')],[entry('ZGMF_1017')]],false,{costLimit:99999,unitCostLimit:99999});
  const unit=game.units[0];unit.phaseShiftHp=1234;unit.phaseShiftEnabled=false;
  G.useSkill(game,unit,'Transform',unit.x,unit.y);
  const next=game.units.find(u=>u.id===unit.id);
  assert.equal(G.modelOf(next).prefabId,'GAT_X303_MA');
  assert.equal(next.phaseShiftHp,1234);
  assert.equal(next.phaseShiftEnabled,false);
  assert.equal(G.modelOf(next).technologyWeight,1);
});

test('confirmed PS hits spend coating durability and EN, while misses and forecasts spend nothing',()=>{
  const game=G.create(false,1,[[entry('ZGMF_1017')],[entry('GAT_X105')]],false,{costLimit:99999,unitCostLimit:99999});
  const [a,b]=game.units;
  Object.assign(a,{x:2,y:4});Object.assign(b,{x:4,y:4,shield:0,hp:1000000});
  const base=G.modelOf(a).weapons.find(w=>w.type!=='melee');
  const weapon={...base,min:0,max:30,en:0,hitScale:100,damageComponents:{shell:2000},shotCount:1,
    attack:{...base.attack,strikes:[{...base.attack.strikes[0],at:0,shotIndex:0,damageComponents:{shell:2000}}]}};
  const before=b.en,estimate=G.estimate(game,a,b,weapon);
  assert.equal(b.phaseShiftHp,undefined);
  assert(estimate.coatingDamage.phaseShift.loss>0);
  G.fight(game,a,b,weapon,'counter',null,false);
  assert(b.phaseShiftHp<G.modelOf(b).phaseShift.capacity);
  assert(b.en<before);
  const missed=G.create(false,1,[[entry('ZGMF_1017')],[entry('GAT_X105')]],false,{costLimit:99999,unitCostLimit:99999});
  const [c,d]=missed.units;
  Object.assign(c,{x:2,y:4});Object.assign(d,{x:4,y:4,shield:0,hp:1000000});
  const en=d.en;
  G.fight(missed,c,d,{...weapon,hitScale:0.0000001},'counter',null,false);
  assert.equal(d.phaseShiftHp,undefined);assert.equal(d.en,en);
});

test('CE battlefield presets use matching factions and era-weight rewards across all wave stages',()=>{
  const B=G.battlefieldMode,preset=B.presetSettings('CE_0071_T1-cost-1500',null,G.eras);
  assert.deepEqual(preset.battlefieldTeams.map(t=>t.faction),['OMNI','ZAFT']);
  B.teams(G,preset.battlefieldTeams);
  for(const team of preset.battlefieldTeams)for(const turn of [1,21,61]){
    const units=B.wavePlan(G,team,turn,1,()=>.5);assert(units.length>0);
    for(const unit of units)assert(G.models[unit.unitId+'__'+unit.kitId].tags.includes('CE_0071_T1'));
  }
  const uc=B.baseReward({mode:'battlefield',costLimit:1500,battlefieldTeams:[{era:'UC_0079_T1'}]},0);
  assert.deepEqual(B.baseReward({mode:'battlefield',...preset},0),uc);
});

test('I-fields recover five percent and native remote volleys retain every child emission',()=>{
  for(const p of G.catalog.prefabs){
    if(p.stats.iField)assert.equal(p.stats.iField.recoveryPercent,5,p.id);
    for(const w of Object.values(p.weapons))if(w.remote){
      const count=w.remote.units.reduce((n,u)=>n+u.cycles*u.burstShots,0);
      assert.equal(w.nativeTiming.projectiles,count,p.id);
      assert.equal(w.attack.steps.reduce((n,s)=>n+(s.shots||0)*(s.repeat||1),0),count,p.id);
      assert(w.remote.shotsPerUnit>=5,p.id);
      assert.equal(w.nativeRemote.damageScale,.5,p.id);
    }
  }
});

test('Smart beam guns use native segmented blue effects and 150-speed damage carriers',()=>{
  for(const id of ['MSA_0011','MSA_0011_Ext','MSZ_006C1']){
    const p=G.catalog.prefabs.find(p=>p.id===id);
    const guns=Object.values(p.weapons).filter(w=>w.sourceName.includes('BeamSmartGun')&&!w.special);
    assert(guns.length,id);
    for(const w of guns){assert.equal(w.projectile.sequence.color,'Blue');assert.equal(w.projectile.nativeSpeed,150);assert(w.projectile.sequence.segments.length>=2);}
  }
  for(const id of ['MSZ_006','MSZ_006A1']){
    const layers=G.catalog.prefabs.find(p=>p.id===id).layers.filter(l=>l.name.includes('HML')&&/_(Idle|Attack)$/.test(l.name));
    assert.equal(layers.length,2,id);
    for(const l of layers)assert.equal(l.visibleWhen.heldAttacking,l.name.endsWith('_Attack'),l.name);
  }
});
