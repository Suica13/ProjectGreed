/* Scoped source refresh: preserve raw imported stats and native presentation. */
const fs=require('node:fs'),path=require('node:path');
const Policy=require('./gbo2-import-policy.cjs'),Codec=require('./weapon-store.cjs');
const root=path.resolve(__dirname,'..'),definitions=JSON.parse(fs.readFileSync(path.join(__dirname,'../assets/weapons.json'),'utf8')).definitions;
for(const ref of JSON.parse(fs.readFileSync(path.join(root,'assets/unit-catalog.json'),'utf8')).units){
 const file=path.join(root,'assets',ref),raw=JSON.parse(fs.readFileSync(file,'utf8'));
 if(!Policy.isGbo2(raw))continue;
 const prefab=Policy.prepare(Codec.expandPrefab(raw,definitions),definitions);
 fs.writeFileSync(file,JSON.stringify(Codec.packPrefab(prefab,definitions,false),null,2)+'\n');
}
