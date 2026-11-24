const test=require('node:test'),assert=require('node:assert/strict'),F=require('../shared/contract-forces');
test('initial quota normalization receives all configured formations',()=>{
 for(let n=1;n<=6;n++){
  const room={settings:{sweepDifficulty:n},game:{}},formations=Array.from({length:120},(_,i)=>({id:i,models:Array(i%3?3:6).fill({})}));
  let proposed=0,retained=0;
  for(const formation of formations){
   proposed+=formation.models.length;const selected=F.selectCount(room,[formation]);
   for(const f of selected){assert.equal(f,formation);retained+=f.models.length;}
   assert.equal(retained,proposed);
  }
 }
});
test('reinforcement count quotas remain private and reset per game',()=>{
 const room={settings:{sweepDifficulty:6},game:{}},formation={models:[{},{},{}]};
 const initial=[1,2,3,4].map(()=>F.selectCount(room,[formation],true).length);
 const reinforcement=[1,2,3,4].map(()=>F.selectCount(room,[formation],true).length);
 assert.deepEqual(initial,reinforcement);assert.equal(initial.reduce((a,b)=>a+b,0),3);
 const other={settings:room.settings,game:{}};assert.equal(F.selectCount(other,[formation],true).length,initial[0]);
 assert.deepEqual(Object.keys(room.game),[]);
});
