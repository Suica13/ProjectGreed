/* Derived charged shot: current GN rifle payload, GM Sniper II charge ratio/control. */
const fs=require('node:fs'),path=require('node:path');
function apply(prefab,rules,definitions,adjustments){
 if(prefab.id!=='GN_002')return;
 const key='CB_GN_002_BSR_Charged',base=prefab.weapons.CB_GN_002_BSR;
 const raw=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/units/RGM_79SP2/unit.json'),'utf8'));
 const ref=require('./weapon-store.cjs').expandPrefab(raw,definitions);
 require('./weapon-balance.cjs').applyWeaponBalance(ref,rules,definitions,{adjustments});
 require('../shared/catalog-adjustments.cjs').unit(ref,adjustments,raw.weapons);
 const normal=ref.weapons.EF_R4_BeamSniperRifle,charged=ref.weapons.EF_R4_BeamSniperRifle_Sniper_Aim;
 const total=w=>Object.values(require("../shared/weapon-sequence.js").roundComponents(w.damageComponents)).reduce((s,n)=>s+n,0),ratio=total(charged)/total(normal);
 const shot=structuredClone(base);shot.name='蓄力狙击';
 shot.localization={zh:{name:'蓄力狙击'},en:{name:'Charged Sniper Shot'},ja:{name:'チャージ狙撃'}};
 Object.assign(shot,{slot:'skill',special:{type:'snipe',delayOwnTurns:1,baseWeapon:'CB_GN_002_BSR'},noCounter:true,hitScale:charged.hitScale,
  min:base.min,max:base.max+(charged.max-normal.max),en:base.en,attackRounds:1,
  description:'锁定目标，下次己方回合开始时目标仍在射程内则自动射击；命中率×2，伤害倍率参考吉姆狙击II光束狙击。',
  derivedSnipe:{referenceUnit:'RGM_79SP2',baseWeapon:normal.sourceName,chargedWeapon:charged.sourceName,damageRatio:ratio}});
 shot.damageComponents=Object.fromEntries(Object.entries(base.damageComponents).map(([k,v])=>[k,v*ratio]));shot.damagePerShot=total(shot);
 for(const step of shot.attack.steps)if(step.damageComponents)for(const k of Object.keys(step.damageComponents))step.damageComponents[k]*=ratio;
 delete shot.gbo2DamageScale;delete shot.gbo2SharedRef;delete shot.conversionMultipliers;
 prefab.weapons[key]=shot;for(const kit of prefab.weaponKits)if(kit.weapons.includes('CB_GN_002_BSR')&&!kit.weapons.includes(key))kit.weapons.push(key);
}
module.exports={apply};
