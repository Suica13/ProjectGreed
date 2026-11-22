const test = require('node:test'), assert = require('node:assert/strict');
const P = require('../shared/pilots'), G = require('../shared/rules'), C = require('../shared/contract-mode');
const boost = n => Math.round(Math.round(n) * 1.25);
const officer = faction => ({faction, unitTags:['CmdUnit']});

test('ordinary and derived commanders receive a flat 25 leadership after grade scaling',()=>{
  for(const faction of Object.keys(G.factionInfo)) for(let seed=0;seed<100;seed++) {
    const model=officer(faction), ordinary=P.roll(null,seed,0,0,model);
    assert(ordinary.stats.leadership>=115 && ordinary.stats.leadership<=135);
    for(const grade of ['veteran','elite','ace']) {
      const derived=P.rollGrade(grade,seed,model);
      const expected=Math.round((ordinary.stats.leadership-25)*P.crewGrades[grade].multiplier)+25;
      assert.equal(derived.stats.leadership,grade==='ace'?boost(expected):expected);
    }
    const regular=P.roll(null,seed,0,0,{faction,unitTags:[]});
    assert(regular.stats.leadership>=48 && regular.stats.leadership<=60);
  }
  assert(P.generalPMC('pmc-general-officer',true).stats.leadership>=115);
  assert(P.generalPMC('pmc-general-officer',false).stats.leadership<=60);
  assert.equal(P.baseStats().leadership,80);
});

test('every ACE at every level gains 25 percent leadership and legacy saves normalize only once',()=>{
  for(const source of P.catalog.aces) for(let level=0;level<=source.maxLevel;level++) {
    const oldStats=Object.fromEntries(Object.entries(source.baseStats).map(([key,base])=>[key,
      Math.round(level===source.maxLevel?source.maxStats[key]:base>0?base*(source.maxStats[key]/base)**(level/source.maxLevel):0)]));
    const old={id:'ace-'+source.id,aceId:source.id,aceGrowthVersion:source.growthVersion,experienceVersion:2,
      level,experience:123,stats:oldStats,record:{kills:7,shipKills:2,battles:3,losses:1}};
    const next=P.custom(old);assert.equal(next.stats.leadership,boost(oldStats.leadership),source.id+' Lv'+level);
    for(const key of Object.keys(P.labels).filter(key=>key!=='leadership'))assert.equal(next.stats[key],oldStats[key]);
    assert.equal(next.experience,123);assert.equal(next.level,level);assert.deepEqual(next.record,old.record);
    for(let reload=0;reload<3;reload++)assert.deepEqual(P.custom(JSON.parse(JSON.stringify(next))),next);
    assert.equal(P.aceStatCap(next,'leadership'),boost(source.maxStats.leadership));
    assert.equal(P.cost(next),P.aceBaseCost(source)+source.costPerLevel*level);
  }
});

test('ACE promotion, demotion, revival and formation validation retain the new leadership without accepting forged stats',()=>{
  const source=P.catalog.aces.find(p=>p.price&&p.baseStats.leadership>50);
  let pilot=P.createAce(source.id);pilot=P.gainExperience(pilot,100000);
  pilot=P.upgrade(pilot);assert.equal(pilot.level,1);
  const validated=G.validateFormation([{unitId:'RGM_79',kitId:'machine_gun',customPilot:pilot}],99999)[0].customPilot;
  assert.equal(validated.stats.leadership,pilot.stats.leadership);
  const revived=P.revive({...pilot,needsRecruitment:true});assert.equal(revived.stats.leadership,pilot.stats.leadership);
  const demoted=P.demote(pilot);assert.equal(demoted.stats.leadership,P.createAce(source.id).stats.leadership);
  assert.throws(()=>P.custom({...pilot,stats:{...pilot.stats,leadership:pilot.stats.leadership+1}}),/不能手动修改/);
});

test('script named and generic ACE rolls gain leadership and do not receive the bonus twice',()=>{
  for(const source of P.catalog.named) {
    const model={faction:source.faction,unitTags:source.commander?['CmdUnit']:[]};
    for(let seed=0;seed<100;seed++) {
      const pilot=P.roll(source.id,seed,0,0,model), base=source.baseStats.leadership;
      assert(pilot.stats.leadership>=boost(Math.max(0,base-P.catalog.namedVariation)));
      assert(pilot.stats.leadership<=boost(Math.min(200,base+P.catalog.namedVariation)));
    }
  }
  for(const command of [false,true]){
    const model={faction:'ZEON',unitTags:command?['CmdUnit']:[]};
    const pilot=P.roll('generic:ace',123,2,1,model);
    assert.deepEqual(P.roll('generic:ace',123,2,1,model),pilot);
    assert(pilot.stats.leadership>=(command?boost(90*1.6+25):boost(48*1.6)));
  }
});

test('ACE leadership skills multiply the adjusted value without modifying permanent attributes',()=>{
  const source=P.catalog.aces.find(p=>p.price&&p.skills.some(skill=>skill.statMultipliers?.leadership));
  assert(source);const pilot=P.createAce(source.id),skill=source.skills.find(skill=>skill.statMultipliers?.leadership);
  const before=structuredClone(pilot),unit={pilot,pilotBuffs:{[skill.id]:true}};
  assert.equal(P.of(unit).stats.leadership,Math.round(pilot.stats.leadership*skill.statMultipliers.leadership));
  assert.deepEqual(pilot,before);assert.equal(P.custom(pilot).stats.leadership,pilot.stats.leadership);
});

test('all AI configurations ban MS-06C and contract pools exclude it across eras, environments and difficulties',()=>{
  for(const mode of ['regular','quick','sweep','battlefield','mission'])assert(G.aiUnitBans[mode].includes('MS_06C'));
  for(const era of ['UC_0079_T1','UC_0079_T2'])for(const environment of ['ground','space'])for(let difficulty=1;difficulty<=6;difficulty++){
    const room={settings:{sweepEra:era,sweepFaction:'ZEON',sweepEnvironment:environment,sweepDifficulty:difficulty}};
    assert(C.enemyRestrictions(room,G).aiBannedUnits.includes('MS_06C'));
    for(let seed=1;seed<=100;seed++)assert(C.enemies(room,G,seed).every(entry=>entry.unitId!=='MS_06C'));
  }
});
