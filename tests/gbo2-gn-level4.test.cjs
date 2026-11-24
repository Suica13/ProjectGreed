const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../shared/rules.js'), fs = require('node:fs'), crypto = require('node:crypto');
const ids = ['GN_001','GN_002','GN_003','GN_005'];
const hashes=['57eeee9aea21858efe4b8805944a1d711f6b1fe7c0b86a8be889706eb864bf6d','cb4b33c5142d70ab9a7f3b3e1bc071956b3b4b88e624c1e4ae22d5cc7d6dc30f','b57ad4278bf0ba53af28305085f17ff41b3d99ef97ae4ccb081fde1aa6f76f3f','d4a5b2506efe5021798a17a16dee720fb5b29d452faffdeb912cc9af7195554f'];
const entry = id => ({unitId:id,kitId:'default'});
function pair(id='GN_001',target='GN_005') {
 const g=G.create(false,1,[[entry(id)],[entry(target)]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});
 g.tiles.forEach(r=>r.fill('plain'));g.deployment=null;
 const [a,b]=g.units;Object.assign(a,{x:3,y:5});Object.assign(b,{x:4,y:5});return {g,a,b};
}
test('four level-4 units are independent CB/AD2307 catalog units with supplied icons and no Trans-AM',()=>{
 for(const id of ids){
  const p=G.catalog.prefabs.find(p=>p.id===id),m=G.models[id+'__default'];
  assert(p && m);assert.equal(p.formOnly,false);assert.equal(p.sourceStats.nativeLevel,4);
  assert(p.tags.includes('AD_2307_T1'));assert.equal(m.faction,'CB');
  assert(!p.skills.some(s=>/trans.?am/i.test(JSON.stringify(s))));
  assert.deepEqual(G.validateFormation([entry(id)],99999),[entry(id)]);
  const icon=fs.readFileSync(`assets/units/${id}/textures/${id}.png`);
  assert.equal(crypto.createHash('sha256').update(icon).digest('hex'),hashes[ids.indexOf(id)]);
 }
 assert.equal(G.catalog.prefabs.filter(p=>/^GN_/.test(p.id)).length,5);
});
test('native firing chains retain volleys, dual carriers, AP damage, and both missile launchers',()=>{
 const weapon=(id,key)=>G.models[id+'__default'].weapons.find(w=>w.id===key);
 assert.equal(weapon('GN_001','CB_GN_001_BG').shotCount,3);
 assert.equal(weapon('GN_001','CB_GN_001_GNArmGun').shotCount,16);
 assert.equal(weapon('GN_001','EF_BeamSaber_Double_DBDF').shotCount,4);
 assert.equal(weapon('GN_002','CB_GN_002_MS').shotCount,8);
 const dual=weapon('GN_002','CB_GN_002_BG_Double');
 assert.deepEqual(dual.anyParts,['leftArm','rightArm']);
 assert.deepEqual([...new Set(dual.attack.strikes.flatMap(s=>s.requiredParts))].sort(),['leftArm','rightArm']);
 assert(weapon('GN_002','CB_GN_002_BSR').damageComponents.beamAP>0);
 assert.equal(weapon('GN_003','CB_GN_003_Combo').shotCount,13);
 assert(weapon('GN_003','CB_GN_003_Combo').attack.strikes.some(s=>s.damageComponents?.meleeAP>0));
 assert.equal(weapon('GN_005','CB_GN_005_BeamCannon').shotCount,4);
 for(const id of ids)for(const w of G.models[id+'__default'].weapons)assert.notEqual(w.nativeTiming.entry,'automatic_turret');
});
test('Kyrios respects broken-part restrictions, transforms without healing, flies and exposes its SFS slot',()=>{
 const {g,a}=pair('GN_003');a.hp=12500;a.en=321;a.brokenParts={leftArm:true};
 assert.throws(()=>G.useSkill(g,a,'Transform',a.x,a.y));
 a.brokenParts={};
 G.useSkill(g,a,'Transform',a.x,a.y);
 assert.equal(a.model,'GN_003_MA__default');assert.equal(a.hp,12500);assert.equal(a.en,321);
 assert.deepEqual(a.brokenParts,{});assert.equal(G.environmentOf(g,a),'air');
 assert(G.modelOf(a).weapons.every(w=>w.type!=='melee'));
 assert.equal(G.modelOf(a).hangars[0].kind,'sfs');
 assert.equal(G.catalog.prefabs.find(p=>p.id==='GN_003_MA').formOnly,true);
 const ma=G.catalog.prefabs.find(p=>p.id==='GN_003_MA');
 assert(ma.layers.find(l=>l.name==='MA'&&!l.hidden));
 for(const name of ['Crotch','Head','EF_BeamSaber_BF'])assert.equal(ma.layers.find(l=>l.name===name).hidden,true,name);
});
test('Virtue GN field only works while defending and cannot absorb beyond its remaining capacity',()=>{
 const {g,a,b}=pair();const base=G.modelOf(a).weapons[0];
 for(const channel of ['beam','shell','melee','beamAP','meleeAP']) {
  const components={[channel]:20000};
  const w={...base,type:channel.startsWith('melee')?'melee':'beam',min:1,max:9,damageComponents:components,attack:{...base.attack,strikes:[{...base.attack.strikes[0],damageComponents:components,damageMultiplier:1}]}};
  b.gnFieldHp=0;const without=G.estimate(g,a,b,w,'defend');
  b.gnFieldHp=10000;const defended=G.estimate(g,a,b,w,'defend');
  assert.equal(defended.iFieldDamage,10000,channel);assert.equal(without.damage-defended.damage,10000,channel);
  assert.equal(G.gnFieldHP(b),10000);
  assert.equal(G.estimate(g,a,b,w,'counter').iFieldDamage,0);
 }
 const skill=G.unitSkills(b).find(s=>s.type==='irradiation');
 assert(skill);assert.equal(skill.effectPrefix,'GBO2_Irradiation');
 assert(!G.modelOf(b).weapons.some(w=>w.id.includes('BurstMode')));
});
