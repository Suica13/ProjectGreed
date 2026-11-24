const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules.js');
function battle(id){const g=G.create(false,1,[[{unitId:'GN_001',kitId:'default'}],[{unitId:id,kitId:'default'}]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});g.deployment=null;g.tiles.forEach(r=>r.fill('plain'));const[a,b]=g.units;Object.assign(a,{x:3,y:5});Object.assign(b,{x:4,y:5});return{g,a,b};}
test('specified GN profiles preserve per-projectile payloads, complete volleys, EN and rounds',()=>{
 for(const [id,expected]of Object.entries({GN_005:[1500,5,115,125,140,10,12,150,10,60],GN_002:[1000,6,125,140,150,12,14,140,25,50]})){
  const m=G.models[id+'__default'];assert.deepEqual([m.en,m.move,m.speed,m.mobility,m.accuracy,m.sensors.sight,m.sensors.radar,m.partStructuralStrength,m.attackBonuses.melee,m.attackBonuses.shooting],expected);
  assert.equal(m.iField,undefined);
  const flat=id==='GN_005'?500:400;assert.deepEqual(['beam','shell','melee'].map(k=>m.defenses[k].flat),[flat,flat,flat]);
 }
 for(const[id,key,min,max,perShot,shots,rounds,en]of [
  ['GN_005','CB_GN_005_GNBazooka',3,5,24000,1,1,100],['GN_005','CB_GN_005_BeamCannon',2,3,4000,4,1,100],
  ['GN_002','CB_GN_002_BSR',3,6,15000,1,1,75],['GN_002','CB_GN_002_BG_Double',1,2,2000,4,2,35]
 ]){const w=G.models[id+'__default'].weapons.find(w=>w.id===key);assert.deepEqual([w.min,w.max,w.damagePerShot,w.shotCount,w.attackRounds,w.en],[min,max,perShot,shots,rounds,en]);}
});
test('GN fields independently consume durability against every channel only while defending',()=>{
 for(const id of ['GN_005','GN_002','GN_001','GN_003','GN_003_MA'])for(const channel of ['beam','beamAP','shell','shellAP','melee','meleeAP','meleeBeam','meleeBeamAP','meleeShell','meleeShellAP']){
  const{g,a,b}=battle(id),base=G.modelOf(a).weapons[0],dc={[channel]:50000};
  const w={...base,type:channel.startsWith('melee')?'melee':'beam',min:1,max:9,hit:1000,damageComponents:dc,attack:{...base.attack,strikes:[{...base.attack.strikes[0],damageComponents:dc,damageMultiplier:1}]}};
  b.gnFieldHp=1000;assert.equal(G.iFieldHP(b),0);
  assert.equal(G.estimate(g,a,b,w,'defend').iFieldDamage,1000);
  for(const stance of ['counter','evade'])assert.equal(G.estimate(g,a,b,w,stance).iFieldDamage,0);
  const events=G.resolveProjectile(g,a,b,w,'defend');assert.equal(G.gnFieldHP(b),0);assert.equal(b.iFieldHp,undefined);assert(events.some(e=>e.fieldName==='GN立场'));
 }
});
test('solar furnace and GN field regenerate exactly once on incoming own turn, including empty fields',()=>{
 for(const id of ['GN_005','GN_002','GN_001','GN_003','GN_003_MA']){
  const{g,a,b}=battle(id),m=G.modelOf(b);b.en=0;b.gnFieldHp=0;
  G.end(g);assert.equal(b.en,m.en*.05);assert.equal(b.gnFieldHp,m.gnField.capacity*.05);
  G.end(g);assert.equal(b.en,m.en*.05);assert.equal(b.gnFieldHp,m.gnField.capacity*.05);
  b.en=m.en-1;b.gnFieldHp=m.gnField.capacity-1;G.end(g);assert.equal(b.en,m.en);assert.equal(b.gnFieldHp,m.gnField.capacity);
 }
});
