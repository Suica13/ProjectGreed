/* Generated reviewable report; shares exactly the server's conversion path. */
const fs=require('node:fs'),path=require('node:path');
const {loadCatalog}=require('./load-catalog.cjs');
const root=path.resolve(__dirname,'..'),catalog=loadCatalog({embedAssets:false});
const units=catalog.prefabs.filter(require('./gbo2-import-policy.cjs').isGbo2).map(p=>({
 id:p.id,cost:p.stats.cost,hp:p.stats.hp,shield:p.shield.hp,move:p.stats.move,
 reaction:p.stats.mobility,accuracy:p.stats.accuracy,mountain:p.stats.adaptability.mountain,
 reference:p.gbo2Conversion.reference,
 weapons:Object.fromEntries(Object.entries(p.weapons).map(([id,w])=>[id,{sharedRef:w.gbo2SharedRef||null,uniqueDamageScale:w.gbo2DamageScale||1,damageComponents:w.damageComponents,nativeTiming:w.nativeTiming}])),
 skills:p.skills.filter(s=>s.damageComponents).map(s=>({id:s.id,damageComponents:s.damageComponents})),
}));
fs.writeFileSync(path.join(root,'docs/imports/reports/gbo2-conversion-policy.json'),JSON.stringify({rules:catalog.conversionRules.gbo2,units},null,2)+'\n');
console.log('GBO2 conversion report: '+units.length+' forms');
