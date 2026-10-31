const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules.js');
test('sniper normal and charged ranges each gain two cells without changing minimum or AP',()=>{
 let normal=0,charged=0;
 for(const m of Object.values(G.models))for(const w of m.weapons){
  if(w.category!=='sniper')continue;
  assert.equal(w.min,3);assert.equal(w.max,w.special?.type==='snipe'?11:8,m.prefabId+'/'+w.id);
  assert.equal(w.actionCost,4);
  if(w.special?.type==='snipe'){charged++;assert.equal(w.special.delayOwnTurns,1);}else normal++;
 }
 assert(normal>10&&charged>5);
 const m=Object.values(G.models).find(m=>m.prefabId==='RGM_79_G_SP');
 const w=m.weapons.find(w=>w.id==='EF_LongRangeBeamSniperRifle'),a={model:m.prefabId+'__'+m.kitId,x:10,y:10,hp:m.hp};
 assert(G.inRange(a,{x:18,y:10},w));assert(!G.inRange(a,{x:19,y:10},w));assert(!G.inRange(a,{x:12,y:10},w));
});
