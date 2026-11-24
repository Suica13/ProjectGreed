const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const G=require('../shared/rules.js'),policy=require('../shared/thunderbolt-import-policy.json');
const Codec=require('../tools/weapon-store.cjs'),balance=require('../tools/thunderbolt-balance.cjs'),{applyWeaponBalance}=require('../tools/weapon-balance.cjs');
const prefab=id=>G.catalog.prefabs.find(p=>p.id===id);
function pair(id){const e={unitId:id,kitId:'default'},g=G.create(false,1,[[e],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});g.tiles.forEach(r=>r.fill('plain'));g.deployment=null;const[a,b]=g.units;Object.assign(a,{x:3,y:5});Object.assign(b,{x:4,y:5});return{g,a,b};}
test('four TB hulls and three native forms use the requested UC baselines without GBO2 multipliers',()=>{
 assert.equal(Object.keys(policy.units).length,7);
 for(const[id,ref]of Object.entries(policy.units)){
  const p=prefab(id),base=prefab(ref.stats),handling=prefab(ref.handling),m=G.models[id+'__default'];
  assert(p.source.startsWith('GundamWars_Duel_A0/'));
  for(const key of ['hp','en','cost','move'])assert.equal(p.stats[key],base.stats[key]+(require('../shared/editor-adjustments.json').units[id]?.['/stats/'+key]||0),id+'/'+key);
  assert.equal(p.stats.mobility,handling.stats.mobility);assert.equal(p.stats.accuracy,handling.stats.accuracy);
  assert.equal(p.gbo2Conversion,undefined);assert.equal(p.formOnly,id.endsWith('_WeaponModeB')||id.endsWith('_NA'));
  assert(m.weapons.length>0);assert(p.sourceStats.nativeDuel.initialization.includes('baseHpMax='));
  assert.equal(p.presentation.move,'OnMovingBoost');assert.equal(p.presentation.stagger,'Common_Stagger_A');
 }
});
test('native projectile counts and the complete purged three-stage melee are preserved',()=>{
 const expected={RGM_79_TB:[8,1,2],MS_06F_TB:[1,1,12],MS_06R_TB:[1,1,1],MS_06R_TB_WeaponModeB:[6,1,12],FA_78_1_TB:[2,1,3],FA_78_1_TB_WeaponModeB:[6,1,1],FA_78_1_TB_NA:[12,3]};
 for(const[id,counts]of Object.entries(expected))assert.deepEqual(Object.values(prefab(id).weapons).map(w=>w.nativeTiming.projectiles),counts,id);
 const melee=prefab('FA_78_1_TB_NA').weapons.EF_BeamSaber_Lv2;
 assert(melee.nativeTiming.actions.includes('hiddenAction_Weapon1C'));
 assert(melee.attack.steps.some(s=>s.damageComponents?.meleeShell));
});
test('complete volleys match ProjectGreed references while projectile artwork matches Battle Operation hashes',()=>{
 for(const id of Object.keys(policy.units))for(const[key,w]of Object.entries(prefab(id).weapons)){
  const offsets=require('../shared/editor-adjustments.json').units[id]||{}; const changed=Object.keys(offsets).some(k=>k.startsWith('/weapons/'+key+'/damageComponents/')); if(!changed)assert(Math.abs(balance.total(w)-w.thunderboltReferenceTotal)<1e-6,id+'/'+key);
  if(w.type==='melee')continue;
  assert(w.projectile.presentationSource.startsWith('GundamWars_BattleOperation2_V5/Resource/Image/Bullet/'));
  const file=path.resolve('assets/units',id,w.projectile.texture);
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),w.projectile.presentationSha256);
 }
 const raw=Codec.parse(fs.readFileSync('assets/units/FA_78_1_TB/unit.json','utf8'));
 const rules=require('../shared/conversion-rules.cjs').read();applyWeaponBalance(raw,rules);const once=structuredClone(raw);applyWeaponBalance(raw,rules);
 for(const[key,w]of Object.entries(raw.weapons))assert(Math.abs(balance.total(w)-balance.total(once.weapons[key]))<1e-6);
});
test('multi-shields are stronger and dual-hand fire disables only the broken arm',()=>{
 assert.equal(prefab('RGM_79_TB').shield.hp,8000);assert.equal(prefab('RGM_79_TB').shield.blockChance,.55);
 for(const id of ['FA_78_1_TB','FA_78_1_TB_WeaponModeB']){assert.equal(prefab(id).shield.hp,32000);assert.equal(prefab(id).shield.blockChance,.75);assert.equal(prefab(id).shield.coverage,1);}
 const{g,a}=pair('MS_06F_TB'),weapon=G.modelOf(a).weapons.find(w=>w.id==='ZN_120mmMG_D_TB');
 assert.equal(weapon.shotCount,12);assert.equal(weapon.pairedChannels.length,2);
 for(const part of ['leftArm','rightArm']){
  a.brokenParts={[part]:true};const strikes=G.availableStrikes(a,weapon);
  assert.equal(strikes.length,6,part);assert(strikes.every(s=>!s.requiredParts?.includes(part)));
 }
});
test('native weapon changes and armor purge preserve resource ratios, parts and identity',()=>{
 for(const[id,target]of [['MS_06R_TB','MS_06R_TB_WeaponModeB'],['FA_78_1_TB','FA_78_1_TB_WeaponModeB'],['FA_78_1_TB','FA_78_1_TB_NA']]){
  const{g,a}=pair(id),model=G.modelOf(a),skill=G.unitSkills(a).find(s=>s.source?.unitId===target);
  a.hp=Math.round(model.hp*.4);a.en=Math.round(model.en*.4);a.shield=Math.round(model.shield.hp*.4);
  const hpRatio=a.hp/model.hp,enRatio=a.en/model.en,identity=a.id;
  G.useSkill(g,a,skill.id,a.x,a.y);const next=G.modelOf(a);
  assert.equal(next.prefabId,target);assert.equal(a.id,identity);
  assert(Math.abs(a.hp/next.hp-hpRatio)<.001);assert(Math.abs(a.en/next.en-enRatio)<.001);
  assert.equal(a.acted,false);
  assert.equal(a.skillTurnUses[skill.type==='transform'?'transformation':skill.id],g.round);
 }
});
