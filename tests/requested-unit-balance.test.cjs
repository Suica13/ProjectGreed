const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules');
const C=require('../shared/weapon-classes');

test('all Strike non-default models and saved-form aliases cost 850 while default receives the CE increase',()=>{
 const rows=Object.entries(G.models).filter(([id])=>id.startsWith('GAT_X105'));
 assert(rows.length>=8);
 for(const [id,m] of rows){assert.equal(m.cost,id==='GAT_X105__standard'?1000:850,id);assert.equal(m.hp,41850,id);}
});

test('all Buster weapons fire at most one round including mobility bonuses and paired guns',()=>{
 const m=G.models.GAT_X103__standard;
 assert.equal(m.cost,1000);assert.equal(m.hp,36000);
 const game={round:1},u={model:'GAT_X103__standard',en:m.en};
 for(const w of m.weapons){assert.equal(C.rounds(w),1,w.id);assert.equal(G.attackRounds(game,u,w),1,w.id);}
});

test('land combat GM rail bazooka fires once and its complete kit costs 425',()=>{
 const m=G.models.RGM_79F__standard,w=m.weapons.find(w=>w.id==='EF_RailBazooka');
 assert.equal(m.cost,425);assert.equal(C.rounds(w),1);assert.equal(w.maxUsesPerTurn,1);
});

test('cannon damage increases include existing manually increased payloads',()=>{
 const p=G.catalog.prefabs.find(p=>p.id==='MS_06K');
 assert.equal(p.weapons.Common_Cannon_AntiAir.damagePerShot,2250*1.05);
});

test('Launcher Strike and Launcher Skygrasper beam cannons share the new range, accuracy and damage',()=>{
 for(const id of ['GAT_X105_L__standard','GAT_X105__variant_GAT_X105_L','FX_550__main_2']){
  const m=G.models[id],w=m.weapons.find(w=>w.id==='OMNI_GAT_X105_Launcher');
  assert.deepEqual([w.min,w.max,w.hit,w.damagePerShot],[3,5,60,18950],id);
 }
 const mg=G.models.GAT_X105_L__standard.weapons.find(w=>w.id==='OMNI_GAT_X105_L_MG');
 assert.equal(C.rounds(mg),1);assert.equal(mg.maxUsesPerTurn,1);
 assert.deepEqual(['main_1','main_2','main_3'].map(k=>G.models['FX_550__'+k].cost),[250,225,200]);
});

test('CE Gundam reductions include shield and flight transformations without changing non-Gundam CE units',()=>{
 for(const [id,hp] of [['GAT_X105',41850],['GAT_X103',36000]])
  for(const m of Object.values(G.models).filter(m=>m.prefabId===id))assert.equal(m.hp,hp);
 const forms=['GAT_X303__standard','GAT_X303_MA__standard'].map(id=>G.models[id]).filter(Boolean);
 assert.equal(forms.length,2);assert.equal(forms[0].hp,forms[1].hp);assert.equal(forms[0].cost,forms[1].cost);
 assert.equal(G.models.RGM_79F__standard.hp,24500);
});
