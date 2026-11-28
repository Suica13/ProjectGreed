const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const G=require('../shared/rules'),P=require('../shared/pilots'),F=require('../shared/contract-forces'),codec=require('../shared/save-codec');
const pilotKey='projectgreed.custom-pilots.v3.shared';
function load(saved){const data=new Map(saved?[['projectgreed.economy.v1',codec.stringify(saved)]]:[]);let fail=false;const ctx=vm.createContext({require:require('node:module').createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,ART:G.catalog,localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(fail&&k===pilotKey)throw Error('disk full');data.set(k,v)},removeItem:k=>data.delete(k)}});vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),ctx);return {E:ctx.module.exports,data,fail:()=>fail=true};}
test('either finale opens LV3 after claim, HQ still gates other facilities and beacon stays LV2',()=>{
 const saved=load().E.snapshot();saved.money=saved.supplies=1000000;for(const id in saved.baseFacilities.levels)saved.baseFacilities.levels[id]=2;
 assert(!load(saved).E.facilityUpgradeOffer('hq').available);
 for(const id of ['efsf-29','zeon-25']){
  saved.contactTasks=[{id,status:'ready',progress:1}];assert(!load(saved).E.facilityUpgradeOffer('hq').available);
  saved.contactTasks=[{id,status:'claimed',progress:1}];let {E}=load(saved);assert(E.facilityUpgradeOffer('hq').available);assert(!E.facilityUpgradeOffer('academy').available);assert(!E.facilityUpgradeOffer('beacon').available);
  E.upgradeFacility('hq');for(const key of ['factory','giantFactory','academy']){assert(E.facilityUpgradeOffer(key).available);E.upgradeFacility(key);}
  E=load(E.snapshot()).E;assert.equal(E.snapshot().baseFacilities.levels.academy,3);assert(!E.facilityUpgradeOffer('hq').available);assert(!E.facilityUpgradeOffer('beacon').available);
 }
});
test('dismissal clears stock assignments and roster in one rollback-safe transaction',()=>{
 const saved=load().E.snapshot(),pilot=P.createAce('Pilot_EFSF_0079_N_ACE_YDR');
 saved.inventory.RGM_79=1;saved.storage.units.push({id:'dismiss-stock',unitId:'RGM_79',kitId:'machine_gun',slot:0,hp:G.models.RGM_79__machine_gun.hp,en:G.models.RGM_79__machine_gun.en,pilotId:pilot.id});
 const ok=load(saved);ok.data.set(pilotKey,JSON.stringify({pilots:[pilot],awards:[]}));ok.E.dismissPilot(pilot.id,[[pilotKey,JSON.stringify({pilots:[],awards:[]})]]);
 assert.equal(ok.E.snapshot().storage.units[0].pilotId,null);assert.equal(JSON.parse(ok.data.get(pilotKey)).pilots.length,0);
 const bad=load(saved),before=bad.E.snapshot();bad.data.set(pilotKey,JSON.stringify({pilots:[pilot],awards:[]}));bad.fail();assert.throws(()=>bad.E.dismissPilot(pilot.id,[[pilotKey,'{}']]));assert.deepEqual(bad.E.snapshot(),before);assert.equal(JSON.parse(bad.data.get(pilotKey)).pilots.length,1);
});
test('actual damage uses double shooting gain for mortar and snipe, normal and melee remain unchanged',()=>{
 const e={unitId:'RGM_79',kitId:'machine_gun'},g=G.create(false,1,[[e],[e]],false,{fogMode:'disabled'}),[a,b]=g.units;
 g.tiles.forEach(r=>r.fill('plain'));Object.assign(a,{x:5,y:5});Object.assign(b,{x:6,y:5,pilot:{stats:P.baseStats()}});
 const base=G.modelOf(a).weapons[0];
 for(const kind of ['normal','mortar','snipe','melee']){
  const w={...base,id:'gain-test',type:kind==='melee'?'melee':'shell',slot:kind==='normal'?'main':'skill',special:['mortar','snipe'].includes(kind)?{type:kind}:undefined,damageComponents:{shell:10000},damagePerShot:10000,attack:{...base.attack,strikes:[{damageComponents:{shell:10000}}]}};
  a.pilot={stats:P.baseStats()};const first=G.estimate(g,a,b,w).damage;
  a.pilot={stats:{...P.baseStats(),shooting:200}};const second=G.estimate(g,a,b,w).damage;
  assert(first>0,kind);const ratio=kind==='melee'?1:kind==='normal'?1.25:1.5;assert(Math.abs(second/first-ratio)<.01,kind+': '+second/first);
 }
});
test('T2 MA and Zeong weights are rare in ground and space without changing tier shares or population cost',()=>{
 let seenMA=false,seenZeong=false;
 for(const environment of ['ground','space'])for(const n of [6,7,8,9,10]){
  const forms=F.formations({sweepEra:'UC_0079_T1',sweepFaction:'ZEON',sweepEnvironment:environment,sweepDifficulty:n},G),late=forms.filter(f=>f.kits[0][0].tags.includes('UC_0079_T2'));
  const sum=late.reduce((s,f)=>s+f.weight,0);if(n>=8){const main=late.filter(f=>['MS_14F','MS_15F'].includes(f.units[0])).reduce((s,f)=>s+f.weight,0);assert(Math.abs(main/sum-.7)<1e-9);}assert(Math.abs(sum-(n-5)/5)<1e-9);
  const normal=late.find(f=>!f.kits[0][0].unitTags.includes('MA')&&!f.units[0].startsWith('MSN_02')&&!['MS_14F','MS_15F','YMS_16M'].includes(f.units[0]));
  for(const f of late){assert.equal(f.budget,f.units.length*25);const m=f.kits[0][0];if(m.unitTags.includes('MA')||m.prefabId.startsWith('MSN_02')){seenMA ||= m.unitTags.includes('MA');seenZeong ||= m.prefabId==='MSN_02';assert(Math.abs(f.weight/normal.weight-.025)<1e-9);}}
 }
 assert(seenMA);assert(seenZeong);
});
