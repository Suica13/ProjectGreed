const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const Codec=require('../tools/weapon-store.cjs'),Classes=require('../shared/weapon-classes.js');
const {loadCatalog}=require('../tools/load-catalog.cjs');
const catalog=loadCatalog({embedAssets:false});
const ids=['GAT_01','GAT_01A1','GAT_01D','GAT_01D1','GAT_01D_AS','GAT_01D1_AS'];
test('CE underbarrel tubes use their own shell payload, timing and physical barrel',()=>{
 for(const id of ids){
  const raw=Codec.expandPrefab(JSON.parse(fs.readFileSync(`assets/units/${id}/unit.json`,'utf8')));
  const prefab=catalog.prefabs.find(p=>p.id===id);
  const [key,grenade]=Object.entries(raw.weapons).find(([key])=>key.endsWith('_GL'));
  assert.deepEqual(grenade.damageComponents,{shell:1500},id);
  assert.equal(grenade.nativePayload.ShellDamage,1500);
  assert.equal(grenade.nativePayload.BeamDamage,undefined);
  assert.equal(grenade.nativeTiming.barrel,key);
  assert.equal(grenade.nativeTiming.firingEvents,1);
  assert.equal(grenade.nativeTiming.projectiles,1);
  assert.equal(grenade.projectile.speed,55);
  assert.equal(grenade.type,'shell');assert.equal(grenade.name,'下挂榴弹发射器');
  assert.equal(Classes.classify(grenade),'grenade_launcher');
  assert.equal(prefab.weapons[key].damageComponents.shell,1125);
  const rifle=raw.weapons[key.slice(0,-3)];
  assert.equal(Classes.classify(rifle),'beam_rifle');
  assert.equal(rifle.nativeTiming.firingEvents,1);
  assert.equal(rifle.nativeTiming.barrel,key.slice(0,-3));
  assert(Object.keys(rifle.damageComponents).every(channel=>channel==='beam'));
  for(const step of rifle.attack.steps)if(step.shots)assert(!step.damageComponents?.shell);
  for(const step of grenade.attack.steps)if(step.shots)assert(!step.damageComponents?.beam);
 }
});
test('compiled Strike Dagger separates rifle and grenade damage without phantom double volleys',()=>{
 const model=catalog.models.GAT_01__standard;
 const rifle=model.weapons.find(w=>w.id==='OMNI_57mmBR');
 const grenade=model.weapons.find(w=>w.id==='OMNI_57mmBR_GL');
 assert.equal(rifle.damageComponents.beam,6750);
 assert.deepEqual(grenade.damageComponents,{shell:1125});
 assert.equal(rifle.type,'beam');assert.equal(grenade.type,'shell');
 assert.equal(grenade.name,'下挂榴弹发射器');
});
