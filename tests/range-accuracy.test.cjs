const test=require('node:test'),assert=require('node:assert/strict'),G=require('../shared/rules');
function factor(min,max,d,type='shell'){return G.rangeAccuracyFactor({x:5,y:5,visualOnly:true},{x:5+d,y:5,visualOnly:true},{min,max,type});}
test('ranged accuracy falls linearly toward both endpoints around the rounded-up midpoint',()=>{
 for(const [min,max,expected] of [[1,3,[.8,1,.8]],[1,4,[.8,.9,1,.8]],[2,6,[.8,.9,1,.9,.8]],[3,8,[.8,1-.4/3,1-.2/3,1,.9,.8]],[2,2,[.8]],[2,3,[.8,.8]]])
  expected.forEach((value,i)=>assert(Math.abs(factor(min,max,min+i)-value)<1e-12,`${min}-${max} at ${min+i}`));
 for(const d of [1,2])assert.equal(factor(1,2,d),1);assert.equal(factor(1,1,1),1);
 assert.equal(factor(1,6,1,'melee'),1);assert.equal(factor(1,6,6,'melee'),1);
});
test('shared forecasts apply the range penalty to firing and counterfire',()=>{
 const e={unitId:'RGM_79',kitId:'machine_gun'},g=G.create(false,1,[[e],[e]],false,{fogMode:'disabled'});
 g.tiles.forEach(row=>row.fill('plain'));g.deployment=null;const [a,b]=g.units;
 Object.assign(a,{x:5,y:5,pilot:null});Object.assign(b,{x:5,y:7,pilot:null});
 const w={...G.modelOf(a).weapons.find(w=>w.type!=='melee'),hit:55},evade=G.squadEvasion(g,b);
 for(const counter of [false,true]){
  const center=G.estimate(g,a,b,{...w,min:1,max:3},'counter',counter).hit;
  const edge=G.estimate(g,a,b,{...w,min:2,max:5},'counter',counter).hit;
  assert(center>edge);assert(Math.abs(edge+evade-(center+evade)*.8)<=1);
 }
});
