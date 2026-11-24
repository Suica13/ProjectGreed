const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules.js');
function battle(id='GN_003'){const g=G.create(false,1,[[{unitId:id,kitId:'default'}],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'full'});g.deployment=null;g.tiles.forEach(r=>r.fill('plain'));const[a,b]=g.units;Object.assign(a,{x:3,y:5,deploymentStaged:false});Object.assign(b,{x:4,y:5,deploymentStaged:false});return{g,a,b};}
test('Exia and Kyrios profiles match requested attributes, defenses and complete native volleys',()=>{
 assert.equal(G.models.GN_005__default.hp,65000);
 for(const[id,expected,defense,flat]of [
  ['GN_001',[1000,10,12,7,150,140,140,145,55,15],[20,25,25],600],
  ['GN_003',[1000,10,12,6,160,145,145,135,35,35],[15,20,20],400]
 ]){const m=G.models[id+'__default'];assert.deepEqual([m.en,m.sensors.sight,m.sensors.radar,m.move,m.speed,m.mobility,m.accuracy,m.partStructuralStrength,m.attackBonuses.melee,m.attackBonuses.shooting],expected);assert.deepEqual(['beam','shell','melee'].map(k=>m.defenses[k].percent),defense);assert.deepEqual(['beam','shell','melee'].map(k=>m.defenses[k].flat),[flat,flat,flat]);assert.equal(m.gnField.capacity,7500);}
 for(const[id,key,min,max,perShot,shots,rounds,en]of [
  ['GN_001','CB_GN_001_BG',1,3,2500,3,2,75],['GN_001','CB_GN_001_GNArmGun',1,2,200,16,2,35],
  ['GN_003','CB_GN_003_BMG',1,3,600,8,3,75],['GN_003','Common_ShieldAttack_BL',1,1,6000,1,1,0],['GN_003_MA','CB_GN_003_BMG',1,3,600,8,3,75]
 ]){const w=G.models[id+'__default'].weapons.find(w=>w.id===key);assert.deepEqual([w.min,w.max,w.damagePerShot,w.shotCount,w.attackRounds,w.en],[min,max,perShot,shots,rounds,en]);}
});
test('Kyrios pincer threshold includes exactly 175 and has 80 base accuracy',()=>{
 const{a}=battle(),w=G.modelOf(a).weapons.find(w=>w.id==='CB_GN_003_Combo');assert.equal(w.hit,80);assert.equal(w.shotCount,13);
 a.pilot={stats:{shooting:100,melee:174,defense:100,speed:100,accuracy:100,reaction:100,leadership:100,awakening:0}};assert.equal(G.pilotWeaponAllowed(a,w),false);a.pilot.stats.melee=175;assert.equal(G.pilotWeaponAllowed(a,w),true);
});
test('MA retains two extra movement cells and identical resistances; transformation preserves GN durability and EN',()=>{
 const ms=G.models.GN_003__default,ma=G.models.GN_003_MA__default;assert.equal(ma.move,ms.move+2);assert.deepEqual(ma.defenses,ms.defenses);assert.deepEqual(ma.gnField,ms.gnField);assert.deepEqual(ma.solarFurnace,ms.solarFurnace);
 for(const k of ['speed','mobility','accuracy','partStructuralStrength'])assert.equal(ma[k],ms[k]);
 for(const id of ['GN_003','GN_003_MA']){const{g,a}=battle(id);a.en=321;a.gnFieldHp=1234;G.useSkill(g,a,'Transform',a.x,a.y);assert.equal(a.en,321);assert.equal(a.gnFieldHp,1234);assert.equal(a.iFieldHp,undefined);}
});
test('all solar furnaces grant anti-detection and stealth through the authoritative sensor rules',()=>{
 for(const id of ['GN_001','GN_002','GN_003','GN_003_MA','GN_005']){
  const{g,a,b}=battle(id),r=G.sensors.ranges(a,g);assert.equal(r.antiDetect,true);assert.equal(r.stealth,true);
  // Standard GM radar10 -> 10*.5*.75=3.75 cells against a solar furnace.
  Object.assign(a,{x:7,y:5});assert.equal(G.sensors.detected(g,b.team,a),true);
  a.x=8;assert.equal(G.sensors.detected(g,b.team,a),false);
 }
});
