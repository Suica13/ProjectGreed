const test=require("node:test"),assert=require("node:assert/strict");
const G=require("../shared/rules.js");

test("G3 and GP03 dual bazookas fire the surviving hand and spend only that hand's EN",()=>{
 for(const id of ["RX_78_3","RX_78GP03S","MS_18E","YMS_18"])
  for(const broken of ["leftArm","rightArm"]) {
   const m=Object.values(G.models).find(m=>m.prefabId===id&&m.weapons.some(w=>w.id.includes("Bazooka")&&w.pairedChannels?.length===2));
   assert(m,id);
   const g=G.create(false,1,[[{unitId:id,kitId:m.kitId}],[{unitId:"Type61",kitId:"standard"}]],false,{costLimit:99999,unitCostLimit:99999,mapId:id==="RX_78GP03D"?"asteroid_crossing_1v1":undefined});
   g.fogMode="disabled";g.tiles.forEach(row=>row.fill("plain"));
   const [u,target]=g.units,w=m.weapons.find(w=>w.id.includes("Bazooka")&&w.pairedChannels?.length===2);
   Object.assign(u,{x:10,y:10,brokenParts:{[broken]:true},en:100000,pilot:{stats:Object.fromEntries(Object.keys(G.pilots.baseStats()).map(key=>[key,200]))}});
   Object.assign(target,{x:10+w.min,y:10,hp:1000000,shield:0});
   assert(G.canUse(u,w),id+":"+broken);
   const strikes=G.availableStrikes(u,w,target),energy=G.weaponStats(w,u).en;
   assert.equal(strikes.length,w.shotCount/2,id);
   assert.equal(energy,w.en/2,id);
   assert(strikes.every(step=>!step.requiredParts.includes(broken)));
   assert.doesNotThrow(()=>G.counterQueue(g,u,target,[w]));
   const before=u.en,events=G.fight(g,u,target,w,"evade",null,false);
   assert.equal(before-u.en,energy);
   assert.equal(events[0].strikes.filter(s=>s.executed!==false).length,strikes.length);
   u.brokenParts={leftArm:true,rightArm:true};assert(!G.canUse(u,w));
  }
});

test("dual-hand close-combat sequences allow the intact hand but reject two broken arms",()=>{
 let count=0;
 for(const m of Object.values(G.models))for(const w of m.weapons) {
  if(w.type!=="melee"||!w.anyParts?.includes("leftArm")||!w.anyParts.includes("rightArm"))continue;
  const u={id:"dual-hand",model:m.id||Object.keys(G.models).find(id=>G.models[id]===m),x:10,y:10,hp:m.hp,en:100000,shield:100000,pilot:{stats:Object.fromEntries(Object.keys(G.pilots.baseStats()).map(key=>[key,200]))}};
  for(const broken of ["leftArm","rightArm"]) {
   u.brokenParts={[broken]:true};
   assert(G.canUse(u,w),m.prefabId+":"+w.id+":"+broken);
   assert(G.availableStrikes(u,w).every(step=>!step.requiredParts.includes(broken)));
  }
  u.brokenParts={leftArm:true,rightArm:true};assert(!G.canUse(u,w));count++;
 }
 assert(count>10);
});
