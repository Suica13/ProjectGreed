const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const G=require('../shared/rules.js'),S=require('../shared/weapon-sequence.js'),{applyWeaponBalance}=require('../tools/weapon-balance.cjs');
test('non-ship non-MA beam policy covers native weapons and skills without changing resources or source payloads',()=>{
 let beams=0,excluded=0,skills=0;
 for(const prefab of G.catalog.prefabs){
  const raw=JSON.parse(fs.readFileSync(path.join('assets/units',prefab.id,'unit.json'),'utf8'));
  const beamFactor=raw.stats.ship||raw.unitTags.includes('MA')?1:1.5;
  const copy=structuredClone(raw);applyWeaponBalance(copy);
  for(const [id,before] of Object.entries(raw.weapons)){
   const after=copy.weapons[id];
   let factor=before.type==='melee'||before.category==='melee'?(id.startsWith('Common_Push_')?1:1.1):(['beam_rifle','bazooka'].includes(before.category)&&!/Arm|Hand/i.test(id+' '+(before.sourceName||''))?beamFactor:1);
   if(['RX_78_4','RX_78_4_Bst'].includes(raw.id)&&id==='Common_ArmBR_Pink_L')factor*=raw.weapons.Common_ArmBR_Pink.damagePerShot/before.damagePerShot;
   if(before.type==='beam'||Object.entries(before.damageComponents).some(([k,v])=>/beam/i.test(k)&&v>0)){
    if(beamFactor===1)excluded++;else beams++;
    const mg=before.category==='machine_gun'&&!/^Common_ArmGL(?:_|$)/.test(id)&&!raw.stats.ship?.valueOf()?0.75/(before.machineGunDamageScale??1):1;
    assert.ok(Math.abs(after.damagePerShot-before.damagePerShot*factor*mg)<1e-7,prefab.id+'/'+id);
    const expected=before.attack.steps.reduce((n,s)=>n+S.roundDamage(Object.values(s.damageComponents||before.damageComponents).reduce((a,b)=>a+b,0)*factor*mg*(s.damageMultiplier??1))*(s.shots||0)*(s.repeat||1),0)*(before.hitsPerShot||1);
    assert.equal(S.compile(after).damage,expected,prefab.id+'/'+id);
    assert.deepEqual(after.nativePayload,before.nativePayload);assert.deepEqual(after.nativeTiming,before.nativeTiming);
    assert.equal(after.en,before.en);assert.equal(S.compile(after).shotCount,S.compile(before).shotCount);
   }
  }
  for(const skill of raw.skills||[])if(Object.entries(skill.damageComponents||{}).some(([k,v])=>/beam/i.test(k)&&v>0)){
   skills++;assert.deepEqual(copy.skills.find(s=>s.id===skill.id).damageComponents,Object.fromEntries(Object.entries(skill.damageComponents).map(([k,v])=>[k,v])));
  }
  const once=structuredClone(copy);applyWeaponBalance(copy);assert.deepEqual(copy,once);
 }
 assert(beams>100);assert(excluded>10);assert(skills>0);
});
const root='ZN_MA_08_AA_BeamCannon';
for(const id of ['MA_08','MA_08_DZL'])test(id+' exposes exactly one 14-emitter volley with native arcs, facing and legal combat energy',()=>{
 const m=G.models[id+'__standard'],w=m.weapons.find(w=>w.id===root);
 assert(w);assert.equal(w.damage,35000);assert.equal(w.shotCount,14);assert.equal(w.en,180);assert.equal(w.actionCost,3);
 assert.equal(w.nativeTiming.projectiles,168);assert.equal(w.beamDamageScale,undefined);
 assert.equal(m.weapons.filter(w=>w.id.startsWith(root)).length,1);
 const raw=JSON.parse(fs.readFileSync('assets/units/'+id+'/unit.json','utf8'));
 assert(!raw.mechanics.some(s=>s.id.startsWith('energy_capacity_'+root)));
 for(const heading of [0,90,180,270,-90,630]){
  const a={id:'a',model:id+'__standard',x:10,y:10,hp:m.hp,en:m.en,shield:0,angle:heading,team:0,actionPoints:5};
  for(let relative=-180;relative<=180;relative+=5){
   const c=G.center(a),r=(heading+relative)*Math.PI/180;
   const b={id:'b',model:'Type61__standard',x:c.x+Math.sin(r)*4,y:c.y-Math.cos(r)*4,hp:1000000,shield:0,en:1000,team:1,angle:0};
   const active=G.availableStrikes(a,w,b);
   const expected=w.attack.strikes.filter(s=>Math.abs(((((relative-s.firingArc.idleDir+180)%360)+360)%360)-180)<=15+1e-9);
   assert.deepEqual(active.map(s=>s.shotIndex),expected.map(s=>s.shotIndex));
   G.faceTarget(a,b);assert.equal(a.angle,heading);
  }
 }
 const a={id:'a',model:id+'__standard',x:10,y:10,hp:m.hp,en:m.en,shield:0,angle:0,team:0,actionPoints:5};
 const c=G.center(a),b={id:'b',model:'Type61__standard',x:c.x,y:c.y-4,hp:1000000,shield:0,en:1000,angle:0,team:1};
 const g={units:[a,b],tiles:Array.from({length:30},()=>Array(30).fill('plain')),round:1,team:0,winner:null,fogMode:'disabled',seed:1,environment:'ground'};
 assert(G.canAttack(g,a,b,w));assert.equal(G.availableStrikes(a,w,b).length,2);
 const en=a.en;G.fight(g,a,b,w,'defend');assert.equal(a.en,en-180);assert.equal(a.angle,0);
 assert.equal(G.availableStrikes(a,w,b).length,2);
});

test('every MA and derivative is LargeUnit and Bigro beam cannons have 75% medium accuracy',()=>{
 const mas=G.catalog.prefabs.filter(p=>p.unitTags.includes('MA'));
 assert(mas.length>=14);
 for(const p of mas){
  assert(p.unitTags.includes('LargeUnit'),p.id);assert(!p.unitTags.includes('MediumUnit'));assert(!p.unitTags.includes('SmallUnit'));
  for(const m of Object.values(G.models).filter(m=>m.prefabId===p.id))assert.equal(G.unitSize(m),'large',m.id);
 }
 const bigro=G.catalog.prefabs.filter(p=>/^MA_05(?:_|$)/.test(p.id));assert(bigro.length);
 for(const p of bigro)for(const w of Object.values(p.weapons))if(w.type==='beam'&&w.category==='cannon'){
  assert.equal(w.antiSize.medium.accuracy,0.75);assert.equal(w.antiSize.medium.damage,1);
 }
});
