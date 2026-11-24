/* Duel TB animations retain native strikes; complete volleys follow the named UC reference. */
const fs=require('node:fs'),path=require('node:path');
const config=require('../shared/thunderbolt-import-policy.json');
const Conversion=require('../shared/conversion-rules.cjs');
function total(weapon){
 return (weapon.attack?.steps||[]).reduce((sum,step)=>sum+(step.shots||0)*(step.repeat||1)*(step.damageMultiplier??1)*
  Object.values(step.damageComponents||weapon.damageComponents||{}).reduce((a,b)=>a+b,0),0);
}
function prepare(prefab){
 if(!config.units[prefab.id])return;
 for(const weapon of Object.values(prefab.weapons||{}))if(weapon.thunderboltDamageScale){
  Conversion.scaleDamage(weapon,1/weapon.thunderboltDamageScale);delete weapon.thunderboltDamageScale;
 }
}
function apply(prefab,rules,definitions,adjustments){
 if(!config.units[prefab.id])return prefab;
 const refs=new Map(),root=path.resolve(__dirname,'..');
 for(const weapon of Object.values(prefab.weapons||{})){
  const reference=weapon.thunderboltReference;if(!reference)throw Error('Missing TB weapon reference: '+prefab.id);
  const [unitId,id]=reference;
  if(!refs.has(unitId)){
   const raw=JSON.parse(fs.readFileSync(path.join(root,'assets/units',unitId,'unit.json'),'utf8'));
   const p=require('./weapon-store.cjs').expandPrefab(raw,definitions);
   require('./weapon-balance.cjs').applyWeaponBalance(p,rules,definitions,{adjustments});
   require('../shared/catalog-adjustments.cjs').unit(p,adjustments,raw.weapons);
   refs.set(unitId,p);
  }
  const baseline=refs.get(unitId).weapons[id];if(!baseline)throw Error('Unknown TB reference weapon: '+unitId+'/'+id);
  const sourceTotal=total(weapon),target=total(baseline);
  if(!(sourceTotal>0&&target>0))throw Error('Empty TB firing chain: '+prefab.id+'/'+weapon.sourceName);
  const scale=target/sourceTotal;Conversion.scaleDamage(weapon,scale);weapon.thunderboltDamageScale=scale;
  weapon.thunderboltReferenceTotal=target;
  // Duel uses engine-native projectile speeds; ProjectGreed's spawned-carrier
  // speed uses different units. Borrow the converted reference's speed while
  // retaining Duel's original value in nativePayload for provenance.
  if(weapon.projectile&&Number.isFinite(baseline.projectile?.speed))weapon.projectile.speed=baseline.projectile.speed;
 }
 return prefab;
}
module.exports={prepare,apply,total};
