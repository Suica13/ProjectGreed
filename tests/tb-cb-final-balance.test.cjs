const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules');
test('all TB COST values include kits and GM TB retains the requested native projectile counts',()=>{
 for(const[id,cost]of [['FA_78_1_TB',1250],['FA_78_1_TB_WeaponModeB',1250],['FA_78_1_TB_NA',1250],['MS_06R_TB',1250],['MS_06R_TB_WeaponModeB',1250],['MS_06F_TB',375],['RGM_79_TB',425]])assert.equal(G.models[id+'__default'].cost,cost,id);
 const gm=G.models.RGM_79_TB__default;
 for(const[id,per,count,min,max]of [['EF_FA_78_1_BR_TB_GM',4000,2,1,3],['EF_BeamSprayGun',400,8,1,2]]){const w=gm.weapons.find(w=>w.id===id);assert.deepEqual([w.damagePerShot,w.shotCount,w.attackRounds,w.min,w.max],[per,count,2,min,max]);}
});
test('all CB forms receive +10 mobility, reaction and accuracy, and Virtue bazooka reaches 24000',()=>{
 const expected={GN_001:[150,140,140],GN_002:[125,140,150],GN_003:[160,145,145],GN_003_MA:[160,145,145],GN_005:[115,125,140]};
 for(const[id,values]of Object.entries(expected)){const m=G.models[id+'__default'];assert.equal(m.cost,1500,id);assert.deepEqual([m.speed,m.mobility,m.accuracy],values);}
 const w=G.models.GN_005__default.weapons.find(w=>w.id==='CB_GN_005_GNBazooka');assert.equal(w.damagePerShot,24000);
 assert.equal(G.models.GN_002__default.weapons.find(w=>w.special?.type==='snipe').damagePerShot,22500);
});
