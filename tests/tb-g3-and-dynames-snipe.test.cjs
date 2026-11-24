const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules'),{createAttackPlanner}=require('../shared/attack-plans');
test('TB ace hulls and forms match G3 attributes and default COST while retaining multi-shields',()=>{
 const ref=G.models.RX_78_3__kit_2;
 for(const id of ['FA_78_1_TB','FA_78_1_TB_WeaponModeB','FA_78_1_TB_NA','MS_06R_TB','MS_06R_TB_WeaponModeB']){
  const m=G.models[id+'__default'];for(const k of ['hp','en','speed','mobility','accuracy','partStructuralStrength'])assert.equal(m[k],ref[k],id+'/'+k);
  assert.equal(m.cost,1250);assert.deepEqual(m.defenses,ref.defenses);assert.deepEqual(m.attackBonuses,ref.attackBonuses);assert.equal(m.move,id==='FA_78_1_TB_WeaponModeB'?5:ref.move);
 }
 assert.equal(G.models.FA_78_1_TB__default.shield.hp,32000);assert.equal(G.models.MS_06R_TB__default.shield.hp,0);
});
test('requested TB weapon totals, energy, accuracy and paired native volleys are preserved',()=>{
 for(const[id,key,damage,shots,en,rounds,hit]of [
  ['FA_78_1_TB','EF_GroundTypeMissileLauncher_FA_78_1_TB',2550,3,50,1,70],
  ['FA_78_1_TB_WeaponModeB','EF_FA_78_1_TB_BeamCannon',14875,1,125,1,60],
  ['FA_78_1_TB_WeaponModeB','EF_FA_78_1_TB_BackpackMS',2550,6,150,1,50],
  ['MS_06R_TB','ZN_BeamBazooka_Lv2',10625,1,120,2,60],
  ['MS_06R_TB_WeaponModeB','ZN_360mmBazooka_D_TB_Lv2',2125,6,100,2,65]
 ]){const w=G.models[id+'__default'].weapons.find(w=>w.id===key);assert.deepEqual([w.damagePerShot,w.shotCount,w.en,w.attackRounds,w.hit],[damage,shots,en,rounds,hit]);assert.equal(w.attack.strikes.reduce((total,s)=>total+Object.values(s.damageComponents||w.damageComponents).reduce((a,b)=>a+b,0)*(s.damageMultiplier??1),0),damage*shots);}
});
test('Dynames charge follows the current GM Sniper II damage ratio and resolves on next own turn',()=>{
 const m=G.models.GN_002__default,base=m.weapons.find(w=>w.id==='CB_GN_002_BSR'),w=m.weapons.find(w=>w.derivedSnipe);
 const ref=Object.values(G.models).find(m=>m.prefabId==='RGM_79SP2'&&m.weapons.some(w=>w.id==='EF_R4_BeamSniperRifle_Sniper_Aim'));
 const rbase=ref.weapons.find(w=>w.id==='EF_R4_BeamSniperRifle'),rcharge=ref.weapons.find(w=>w.id==='EF_R4_BeamSniperRifle_Sniper_Aim');
 assert.equal(w.damagePerShot,Math.round(base.damagePerShot*1.5/25)*25);assert.equal(w.damagePerShot,22500);
 assert.deepEqual([w.min,w.max,w.en,w.hitScale,w.noCounter,w.shotCount],[3,8,75,2,true,1]);const{asset:chargedAsset,...chargedProjectile}=w.projectile,{asset:baseAsset,...baseProjectile}=base.projectile;assert.deepEqual(chargedProjectile,baseProjectile);
 const g=G.create(false,1,[[{unitId:'GN_002',kitId:'default'}],[{unitId:'RGM_79',kitId:'machine_gun'}]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});g.tiles.forEach(r=>r.fill('plain'));g.deployment=null;const[a,b]=g.units;Object.assign(a,{x:3,y:5,deploymentStaged:false});Object.assign(b,{x:7,y:5,hp:1000000,deploymentStaged:false});
 const room={game:g},planner=createAttackPlanner(G,()=>Math.random().toString(36));planner.reset(room);planner.plan(room,a,b,w,0);planner.prepare(room);planner.resolve(room);
 assert(a.snipeOrder);assert.equal(b.hp,1000000);G.end(g);assert(!a.readySnipe);G.end(g);assert(a.readySnipe);planner.resumeCharges(room);planner.prepare(room);while(room.reactions.length)planner.choose(room,room.reactions[0].id,'defend');const battles=planner.resolve(room);assert(battles.length>0);assert(battles.flatMap(b=>b.events).some(e=>e.weapon===w.id));assert(!a.snipeOrder);
});
