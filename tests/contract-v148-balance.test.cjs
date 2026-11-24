const test = require('node:test'), assert = require('node:assert/strict');
const G = require('../shared/rules'), C = require('../shared/contract-mode'), F = require('../shared/contract-forces');
const E = require('../shared/battle-economy');
test('difficulty budgets apply once to initial forces and reinforcements with multiplayer rounding', () => {
  for (let n=1;n<=6;n++) for (let players=1;players<=5;players++) {
    const room={settings:{sweepDifficulty:n},game:{contract:{players}}};
    const expected=Math.round(1000*[1,1,1.1,1.15,1.15,1.15][n-1]*(1+.25*(players-1))/25)*25;
    assert.equal(F.budget(room,1000),expected);
    assert.equal(F.budget(room,1000,true),expected);
  }
});
test('all four faction pools retain mainline weights while N5+ elite formations gain relative weight', () => {
  const data=require('../tools/compile-contract-force-pools.cjs').generate({check:true});
  for(const source of [data,...Object.values(data.eras)])for(const levels of Object.values(source.factions))for(const [n,p]of Object.entries(levels)){
    assert(p.formations.some(f=>f.weight===8));
    for(const f of p.formations)assert([8,4,1*(n>=5?1.15:1),.25*(n>=5?1.15:1)].includes(f.weight));
  }
});
test('N5+ pilot rolls increase both veteran and elite weights without upgrading lower tiers', () => {
  const samples=100000;
  for(let n=1;n<=6;n++) {
    const counts={standard:0,veteran:0,elite:0};
    for(let i=0;i<samples;i++)counts[C.enemyPilotGrade(n,(i+.5)/samples)||'standard']++;
    if(n<5){assert.equal(counts.standard,samples);continue;}
    const old=n===5?{standard:.75,veteran:.2,elite:.05}:{standard:.6,veteran:.3,elite:.1};
    for(const grade of ['veteran','elite'])assert(Math.abs(counts[grade]/counts.standard-old[grade]/old.standard*1.15)<.0001);
  }
});
test('settlement and preview apply new rewards once across completion, eras and intervention', () => {
  const budgets=[[2500,3500],[4000,6000],[6000,8000],[9000,11000],[12000,15000],[15000,20000]];
  const rates=E.settlementMultipliers({money:1,supplies:1,technology:1});
  for(let n=1;n<=6;n++)for(const era of ['UC_0079_T1','CE_0071_T1']) {
    if(n===1&&era.startsWith('CE'))continue;
    for(const noAllies of [false,true])for(const completed of [0,1,n]){
      const room={settings:{sweepDifficulty:n,sweepEra:era},game:{contract:{noAllies,objectives:Array.from({length:n},(_,i)=>({status:i<completed?'completed':'failed'}))}}};
      const r=C.reward(room,G),scale=1.25*[1,1,1.2,1.3,1.6,1.9][n-1]*(noAllies?1.25:1)*completed/n;
      for(const [i,k]of ['money','supplies'].entries())assert.equal(E.roundReward(r[k]*rates[k]),E.roundReward(budgets[n-1][i]*scale));
      assert.equal(r.experience,Math.floor([500,1000,1500,3000,4000,5000][n-1]*scale));
    }
  }
});
