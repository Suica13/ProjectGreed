const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules');
const total=w=>w.attack.strikes.reduce((sum,s)=>sum+Object.values(s.damageComponents||w.damageComponents).reduce((a,b)=>a+b,0)*(s.damageMultiplier??1),0);
test('every charged sniper uses 1.5 complete ordinary volleys and 95 base accuracy with preserved double-hit multiplier',()=>{
 let count=0;
 for(const m of Object.values(G.models))for(const w of m.weapons)if(w.special?.type==='snipe'){
  const base=m.weapons.find(b=>b.id===w.special.baseWeapon);assert(base,m.prefabId+'/'+w.id);
  assert.equal(total(w),Math.round(total(base)*1.5/25)*25,m.prefabId+'/'+w.id);
  assert.equal(w.hit,95);assert.equal(w.hitScale,2);assert.equal(w.special.delayOwnTurns,1);assert.equal(w.noCounter,true);
  assert(w.attack.strikes.every(s=>s.accuracy===undefined||s.accuracy===95));count++;
 }
 assert(count>=17);
});
