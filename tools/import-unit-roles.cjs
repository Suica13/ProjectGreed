/* Audited role assignments for every prefab; native MOD files stay read-only. */
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const nativeRoot=process.argv[2] || 'E:/RustedWarfare_Reunion/mods/GundamWars_BattleOperation2_V5';
const native=JSON.parse(execFileSync('python',[path.join(__dirname,'read-gbo2-roles.py'),nativeRoot],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'},maxBuffer:8*1024*1024}));
const normalize=value=>String(value||'').replace(/[^a-z0-9]/gi,'').toLowerCase();
const nativeById=new Map(native.map(record=>[normalize(record.id),record]));
const catalog=require('./load-catalog.cjs').loadCatalog({embedAssets:false}),prefabs=new Map(catalog.prefabs.map(p=>[p.id,p]));
const overrides=require('../shared/unit-role-overrides.json');
const roles={},categories=['normal','general','raid','support'];
const bases=new Map();
for(const p of catalog.prefabs)for(const s of p.skills||[])
  if(['transform','armor_purge','overdrive'].includes(s.type)&&s.source?.unitId&&p.id!==s.source.unitId)
    if(!bases.has(s.source.unitId)||!p.formOnly)bases.set(s.source.unitId,p.id);
function assign(p,seen=new Set()){
  if(roles[p.id])return roles[p.id];
  seen=new Set(seen).add(p.id);
  if(overrides[p.id])return roles[p.id]={role:overrides[p.id].role,method:'manual-override',source:overrides[p.id].reason};
  const baseId=p.formOf||bases.get(p.id),base=prefabs.get(baseId);
  if((p.formOnly||/(_MA|_Mode[A-Z]|_NA|_DeployState|_EXAM|_HADES|_ALICE)/.test(p.id))&&base&&!seen.has(base.id)){
    const inherited=assign(base,seen);return roles[p.id]={role:inherited.role,method:'base-form',source:base.id};
  }
  if(p.stats.ship||p.stats.facilityType||(p.unitTags||[]).some(t=>['Ship','Aircraft','Tank','Vehicle','Helicopter','Building','Infantry','MobilePod'].includes(t)))
    return roles[p.id]={role:'normal',method:'platform',source:(p.unitTags||[]).join(',')};
  const match=nativeById.get(normalize(p.id))||nativeById.get(normalize(p.code));
  if(match)return roles[p.id]={role:categories[match.category],method:'native',source:match.source,nativeId:match.id,nativeCategory:match.category};
  const variant=native.filter(n=>normalize(p.id).startsWith(normalize(n.id))&&normalize(n.id).length>=5).sort((a,b)=>normalize(b.id).length-normalize(a.id).length)[0];
  if(variant)return roles[p.id]={role:categories[variant.category],method:'native-variant',source:variant.source,nativeId:variant.id,nativeCategory:variant.category};

  const text=p.id+' '+p.name+' '+(p.description||'');
  let role='general',reason='balanced-mobile-suit';
  if(/加农|加農|钢坦克|刚坦克|炮击|炮战|狙击|侦察|支援|扎梅尔|大扎姆|精神感应|精神力|FAZZ|GP03D|GAT_X103|Providence/i.test(text)){role='support';reason='artillery-sniper-support';}
  else if(/伊芙利特|老虎|魔蟹|高战蟹|精灵|肯普法|近战|格斗|突击|突袭|GAT_X207|GAT_X303|GAT_X09A|正义|正義|异端.*红|异端.*金/i.test(text)){role='raid';reason='close-assault';}
  return roles[p.id]={role,method:'role-inference',source:reason};
}
for(const p of catalog.prefabs)assign(p);
const sorted=Object.fromEntries(Object.entries(roles).sort(([a],[b])=>a.localeCompare(b)));
fs.writeFileSync(path.join(root,'shared/unit-roles.json'),JSON.stringify({schemaVersion:1,nativeSource:path.basename(nativeRoot),units:sorted},null,2)+'\n');
const summary={units:Object.keys(roles).length,roles:{},methods:{},nativeCards:native.length};
for(const value of Object.values(roles)){summary.roles[value.role]=(summary.roles[value.role]||0)+1;summary.methods[value.method]=(summary.methods[value.method]||0)+1;}
fs.mkdirSync(path.join(root,'tmp/verification/reports'),{recursive:true});
fs.writeFileSync(path.join(root,'tmp/verification/reports/unit-roles-import.json'),JSON.stringify(summary,null,2)+'\n');
console.log(summary);
