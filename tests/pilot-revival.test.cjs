const test=require('node:test'),assert=require('node:assert/strict'),P=require('../shared/pilots'),B=require('../shared/base-facilities');
test('PMC and ACE casualties require material-paid recovery while preserving progression',()=>{
 const profiles=[P.custom({...P.createCustom('custom-revival-pmc','PMC'),level:2}),P.custom({...P.createAce(P.catalog.aces.find(p=>p.price).id),level:2,stats:undefined})];
 for(const before of profiles){
  const lost=P.battleResult(before,'loss',0,0,{requiresRecruitment:true});assert(lost.needsRecruitment);
  assert.deepEqual(P.revivalPrice(lost),{money:0,supplies:(lost.ace?1000:500)*lost.level});
  const restored=P.revive(lost);assert.equal(restored.needsRecruitment,false);
  assert.deepEqual({...restored,needsRecruitment:true},lost);assert.throws(()=>P.revive(restored));
  if(lost.ace)assert.deepEqual(P.recruitmentPrice(lost.aceId,lost),P.revivalPrice(lost));
  const store={pilots:[before],awards:[]},award={id:'loss-'+before.id,pilotId:before.id,kind:'loss',points:0,experiencePoints:0,requiresRecruitment:true};
  assert.equal(P.creditAwards(store,[award],{settled:false}),false);assert.equal(store.pilots[0].needsRecruitment,false);
  assert(P.creditAwards(store,[award]));assert(store.pilots[0].needsRecruitment);assert.equal(P.creditAwards(store,[award]),false);
 }
 const zero=P.battleResult(P.createCustom('custom-revival-zero','Zero'),'loss',0);assert.deepEqual(P.revivalPrice(zero),{money:0,supplies:0});
});
test('ACE base COST is reduced by fifty and academy offers eight places per type per level',()=>{
 const totals=P.catalog.aces.map(p=>Object.values(p.maxStats).reduce((a,b)=>a+Math.round(b),0)),low=Math.min(...totals),high=Math.max(...totals);
 P.catalog.aces.forEach((p,i)=>{const previous=high===low?250:Math.max(200,Math.min(300,200+25*Math.round(4*(totals[i]-low)/(high-low))));assert.equal(P.aceBaseCost(p),previous-50);});
 for(let level=1;level<=5;level++){const s=B.initial();s.levels.hq=s.levels.academy=level;assert.equal(B.pilotLimit(B.normalize(s)),8*level);}
});
