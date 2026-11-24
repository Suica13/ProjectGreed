/* Final charged payload derives from one complete, adjusted ordinary volley. */
const Sequence=require('../shared/weapon-sequence.js'),Adjust=require('../shared/catalog-adjustments.cjs');
function volley(weapon){
 const w=structuredClone(weapon);w.damageComponents=Sequence.roundComponents(w.damageComponents);
 for(const s of w.attack.steps)if(s.damageComponents)s.damageComponents=Sequence.roundComponents(s.damageComponents);
 const compiled=Sequence.compile(w),components={};
 for(const s of compiled.attack.strikes)for(const[k,v]of Object.entries(s.damageComponents||w.damageComponents))components[k]=(components[k]||0)+v*(s.damageMultiplier??1);
 return components;
}
function apply(prefab,rules,adjustments){
 for(const[id,w]of Object.entries(prefab.weapons)){
  if(w.special?.type!=='snipe')continue;
  const base=prefab.weapons[w.special.baseWeapon];if(!base)throw Error('Missing charged sniper base: '+prefab.id+'/'+id);
  const components=volley(base),ratio=rules.weapons.chargedSniperDamage;
  w.damageComponents=Object.fromEntries(Object.entries(components).map(([k,v])=>[k,v*ratio]));
  w.damagePerShot=Object.values(w.damageComponents).reduce((s,n)=>s+n,0);
  w.hit=rules.weapons.chargedSniperHit;w.hitScale=2;
  const emissions=w.attack.steps.reduce((n,s)=>n+(s.shots||0)*(s.repeat||1),0);
  for(const s of w.attack.steps){if(s.shots){delete s.damageComponents;s.damageMultiplier=1/emissions;}if(s.accuracy!==undefined)s.accuracy=w.hit;}
  w.chargedSniperPolicy={baseWeapon:w.special.baseWeapon,multiplier:ratio,baseVolleyComponents:components,baseHit:w.hit};
  if(w.derivedSnipe)w.derivedSnipe.damageRatio=ratio;
  w.description=`锁定目标，下一己方回合开始仍在射程内则自动射击；伤害为普通武器完整齐射的${ratio}倍，基础命中${w.hit}%，命中率×2。`;
  for(const lang of Object.keys(w.localization||{}))delete w.localization[lang].description;
  const prefix='/weapons/'+id;
  const overrides=Object.fromEntries(Object.entries(adjustments.units[prefab.id]||{}).filter(([p])=>p.startsWith(prefix+'/damageComponents/')||p===prefix+'/hit'||p===prefix+'/hitScale').map(([p,v])=>[p.slice(prefix.length),v]));
  Adjust.apply(w,overrides);
 }
}
module.exports={apply,volley};
