/* GBO2 imports use shared weapons first, then scoped conversion, then editor deltas. */
const fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const Codec=require('./weapon-store.cjs'),Conversion=require('../shared/conversion-rules.cjs');
const config=require('../shared/gbo2-import-policy.json');
const isGbo2=p=>/^GundamWars_BattleOperation2[^/]*\/Units\/BattleUnits\//.test(p.source||'');
const clone=v=>structuredClone(v);
function sharedRef(weapon,definitions=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/weapons.json'),'utf8')).definitions,id='') {
 if(weapon.gbo2SharedRef && definitions[weapon.gbo2SharedRef])return weapon.gbo2SharedRef;
 const native=(weapon.sourceName||id).replace(/^GBO2_/,'');
 if(!native || weapon.sourceWeapon)return null;
 const names=[native,config.weaponAliases[native]].filter(Boolean);
 const level=weapon.level||1;
 for(const name of names)if(definitions[name+'__lv'+level])return name+'__lv'+level;
 return Object.keys(definitions).filter(ref=>names.some(name=>ref.startsWith(name+'__lv')))
  .sort((a,b)=>Math.abs((definitions[a].level||1)-level)-Math.abs((definitions[b].level||1)-level)||a.localeCompare(b))[0]||null;
}
function synchronize(weapon,ref,definitions) {
 const base=definitions[ref];
 weapon.gbo2NativeSourceName??=weapon.sourceName;
 weapon.gbo2SharedRef=ref;
 // Visual/audio mounts and the native event chain stay on this hull. The
 // common weapon supplies every combat payload, including per-strike ratios.
 const firing=[];
 for(const step of base.attack?.steps||[])for(let i=0;i<(step.shots||0)*(step.repeat||1);i++)firing.push(step);
 let cursor=0;
 weapon.attack.steps=weapon.attack.steps.flatMap(step=>{
  if(!step.shots)return [clone(step)];
  return Array.from({length:step.shots*(step.repeat||1)},(_,index)=>{
   const value={...clone(step),shots:1,delay:index===0?step.delay:0};delete value.repeat;
   const common=firing[Math.min(cursor++,firing.length-1)]||{};
   for(const field of ['damageComponents','damageMultiplier','accuracy','partBreakModifier']){
    delete value[field];if(Object.hasOwn(common,field))value[field]=clone(common[field]);
   }
   return value;
  });
 });
 for(const field of ['sourceName','name','localization','type','category','level','min','max','hit','en','sourceHit','hitMultiplier','hitBonus','damagePerShot','damageComponents','hitsPerShot','attackRounds','partBreakModifier','targetModifiers','antiSize','armorPiercingIgnore']){
  delete weapon[field];if(Object.hasOwn(base,field))weapon[field]=clone(base[field]);
 }
 delete weapon.classDamageScale;delete weapon.conversionMultipliers;
 return weapon;
}
function prepare(prefab,definitions) {
 if(!isGbo2(prefab))return prefab;
 definitions ||= JSON.parse(fs.readFileSync(path.join(ROOT,'assets/weapons.json'),'utf8')).definitions;
 const prior=prefab.gbo2Conversion;
 if(prior){
  Object.assign(prefab.stats,clone(prior.stats));prefab.shield.hp=prior.shield;
  for(const ability of [...Object.values(prefab.weapons),...(prefab.skills||[])]){
   if(ability.gbo2DamageScale){Conversion.scaleDamage(ability,1/ability.gbo2DamageScale);delete ability.gbo2DamageScale;}
  }
  delete prefab.gbo2Conversion;
 }
 for(const [id,weapon] of Object.entries(prefab.weapons)){
  const ref=sharedRef(weapon,definitions,id);if(ref)synchronize(weapon,ref,definitions);
 }
 return prefab;
}
function referenceProfile(prefab,rules,adjustments,fallback=false) {
 const finalCost=config.referenceCosts?.[prefab.id] ?? (prefab.stats.cost+(adjustments.units[prefab.id]?.['/stats/cost']||0));
 const wanted=fallback?null:config.referenceUnits[prefab.id];
 const catalog=JSON.parse(fs.readFileSync(path.join(ROOT,'assets/unit-catalog.json'),'utf8'));
 const candidates=[];
 for(const ref of catalog.units){
  if(wanted && ref!=='units/'+wanted+'/unit.json')continue;
  const raw=JSON.parse(fs.readFileSync(path.join(ROOT,'assets',ref),'utf8'));
  if(isGbo2(raw)||raw.formOnly||raw.stats.ship)continue;
  const production=require('../shared/native-production.json')[raw.id];
  const unit={...raw,stats:clone(raw.stats),sourceStats:{...raw.sourceStats,...(production?{nativeProductionQuantity:production.quantity}:{})},weapons:{},skills:[]};
  Conversion.globals(unit,rules);
  const offsets=adjustments.units[raw.id]||{};
  const cost=unit.stats.cost+(offsets['/stats/cost']||0);
  const kits=(raw.weaponKits||[]).map((kit,i)=>cost+kit.cost+(offsets['/weaponKits/'+i+'/cost']||0));
  if(!kits.includes(finalCost))continue;
  candidates.push({id:raw.id,reaction:Math.round(unit.stats.mobility+(offsets['/stats/mobility']||0)),accuracy:Math.round(unit.stats.accuracy+(offsets['/stats/accuracy']||0))});
 }
 if(!candidates.length && wanted)return referenceProfile(prefab,rules,adjustments,true);
 if(!candidates.length)throw Error('战斗行动2单位缺少同COST参照：'+prefab.id+' / '+finalCost);
 const median=key=>{const values=candidates.map(c=>c[key]).sort((a,b)=>a-b);return Math.round((values[Math.floor((values.length-1)/2)]+values[Math.ceil((values.length-1)/2)])/2/5)*5;};
 return {cost:finalCost,units:candidates.map(c=>c.id),reaction:median('reaction'),accuracy:median('accuracy')};
}
function apply(prefab,rules,adjustments=require('../shared/catalog-adjustments.cjs').read()) {
 if(!isGbo2(prefab))return prefab;
 const policy=rules.gbo2||{hp:2,shield:2,move:2,uniqueDamage:3,mountain:75};
 const reference=referenceProfile(prefab,rules,adjustments);
 prefab.gbo2Conversion={stats:Object.fromEntries(['hp','move','mobility','accuracy'].map(k=>[k,prefab.stats[k]])),shield:prefab.shield.hp,reference};
 prefab.stats.hp*=policy.hp;prefab.stats.move*=policy.move;prefab.shield.hp*=policy.shield;
 (prefab.stats.adaptability??={}).mountain=policy.mountain;
 prefab.stats.mobility=reference.reaction;prefab.stats.accuracy=reference.accuracy;
 for(const ability of [...Object.values(prefab.weapons),...(prefab.skills||[])]){
  if(!ability.damageComponents||ability.gbo2SharedRef)continue;
  Conversion.scaleDamage(ability,policy.uniqueDamage);ability.gbo2DamageScale=policy.uniqueDamage;
 }
 return prefab;
}
module.exports={isGbo2,sharedRef,prepare,apply};
