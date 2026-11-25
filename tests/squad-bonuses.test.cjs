const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),Fire=require('../shared/automatic-fire');
const ids=Object.fromEntries(['general','raid','support'].map(role=>[role,Object.keys(G.models).find(id=>G.models[id].combatRole===role && !G.models[id].ship)]));
function fixture(roles){
 const e={unitId:'RGM_79',kitId:'machine_gun'},g=G.create(false,9,[[e],[e]],false,{fogMode:'disabled'});
 g.tiles.forEach(row=>row.fill('plain'));g.deployment=null;
 const members=roles.map((role,i)=>({...structuredClone(g.units[0]),id:'squad-'+i,model:ids[role],hp:G.models[ids[role]].hp,en:99999,x:5,y:5,squadId:'six',squadSlot:i}));
 const enemy=g.units[1];Object.assign(enemy,{x:6,y:5});g.units=[...members,enemy];return {g,members,enemy};
}
test('all six squad compositions activate only for six living same-controller actors in the same cell',()=>{
 for(const [roles,id] of [[['general','general','general','support','support','support'],'general_support'],[['raid','raid','raid','general','general','general'],'raid_general'],[['raid','raid','raid','support','support','support'],'raid_support'],[Array(6).fill('general'),'general'],[Array(6).fill('raid'),'raid'],[Array(6).fill('support'),'support']]){
  const {g,members}=fixture(roles),[a,b]=members;assert.equal(G.squadBonuses(g,a).id,id);
  for(const change of [{hp:0},{x:4},{embarked:{carrierId:a.id,exposed:false}},{ownerSeat:2},{contractExtracted:true}]){
   const saved=structuredClone(b);Object.assign(b,change);assert.equal(G.squadBonuses(g,a).id,null,JSON.stringify(change));Object.keys(b).forEach(k=>delete b[k]);Object.assign(b,saved);
  }
 }
});
test('primary shooting bonus adds one final round without boosting secondary or melee',()=>{
 const {g,members}=fixture(['general','general','general','support','support','support']),a=members[0],w=G.modelOf(a).weapons.find(w=>w.slot==='primary'&&w.type!=='melee');
 const before=Fire.roundCount(G,g,a,w);members[5].hp=0;const ordinary=Fire.roundCount(G,g,a,w);assert.equal(before,ordinary+1);
 members[5].hp=1;
 for(const other of G.modelOf(a).weapons.filter(other=>other.id!==w.id))assert.equal(G.squadPrimaryRounds(g,a,other),0);
 assert.equal(Fire.roundCount(G,g,a,{...w,maxUsesPerTurn:ordinary}),ordinary);
});
test('six raid bonus expands authoritative reachability by one and disappears with a casualty',()=>{
 const {g,members}=fixture(Array(6).fill('raid')),a=members[0];g.units=g.units.filter(u=>u.team===0);
 assert.equal(G.modelOf(a,g).move,G.modelOf(a).move+1);
 const boosted=G.reachable(g,a).size;members[5].hp=0;assert.equal(G.modelOf(a,g).move,G.modelOf(a).move);assert(G.reachable(g,a).size<boosted);
});
test('shooting accuracy, evasion and final damage reductions apply to authoritative forecasts',()=>{
 const hitOf=f=>{const a=f.members[0],w=G.modelOf(a).weapons.find(w=>w.type!=='melee');return G.estimate(f.g,a,f.enemy,w,'defend');};
 const support=fixture(Array(6).fill('support'));const full=hitOf(support);support.members[5].hp=0;const solo=hitOf(support);assert.equal(full.hit,Math.min(100,solo.hit+5));
 for(const [roles,multiplier] of [[Array(6).fill('general'),.9],[['raid','raid','raid','general','general','general'],.95]]){
  const f=fixture(roles),a=f.enemy,b=f.members[0],source=G.modelOf(a).weapons.find(w=>w.type!=='melee'),w={...source,damageComponents:{shell:100000},attack:{...source.attack,strikes:[{...source.attack.strikes[0],damageComponents:{shell:100000}}]}};
  const boosted=G.estimate(f.g,a,b,w,'defend');f.members[5].hp=0;const base=G.estimate(f.g,a,b,w,'defend');
  assert(Math.abs(boosted.damage-base.damage*multiplier)<=75,JSON.stringify([boosted.damage,base.damage]));
 }
 const f=fixture(['raid','raid','raid','support','support','support']);const boosted=hitOf(f);f.members[5].hp=0;const base=hitOf(f);assert(Math.abs(boosted.damage-base.damage*1.05)<=225);
});
