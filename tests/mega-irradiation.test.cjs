const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), G = require("../shared/rules.js");
const { parse } = require("../tools/weapon-store.cjs");
const ids = ["MSZ_010","MSZ_010S","FA_010S","FA_010A","FA_00100S","AMX_014","MRX_009","MRX_010","PMX_000"];
for (const id of ids) test(`native MEGA irradiation conversion: ${id}`, () => {
  const p = parse(fs.readFileSync(`assets/units/${id}/unit.json`,"utf8"));
  const skill = p.skills.find(s=>s.type === "irradiation");
  assert(skill); assert.equal(skill.range,10); assert.equal(skill.areaWidth,3); assert.equal(skill.baseHit,50);
  const weapon = p.weapons[skill.sourceWeapon];
  const repeat = weapon.nativePayload.ProjectileAttackTimes || 1, decay = weapon.nativePayload.ProjectileAttackTimesDamageModifier ?? 1;
  const multiplier = Array.from({length:repeat},(_,i)=>decay**i).reduce((a,b)=>a+b,0);
  const total = weapon.attack.steps.reduce((sum,step)=>sum+Object.values(step.damageComponents||weapon.damageComponents).reduce((a,b)=>a+b,0)*(step.shots||0)*(step.repeat||1)*(step.damageMultiplier??1)*multiplier,0);
  assert.equal(skill.nativeTotalDamage,total);
  assert.equal(Object.values(skill.damageComponents).reduce((a,b)=>a+b,0),Math.round(total/50/25)*25);
  assert(!p.weaponKits.some(kit=>kit.weapons.includes(skill.sourceWeapon)));
});
test("MEGA finite strip selects exactly three rows, diagonal footprint intersections, never duplicates large hulls", () => {
  const id="MSZ_010", model=Object.values(G.models).find(m=>m.prefabId===id), tank={unitId:"Type61",kitId:"standard"};
  const g=G.create(false,1,[[{unitId:id,kitId:model.kitId},tank],[tank,tank,tank,tank]],false,{costLimit:99999,unitCostLimit:99999});
  g.fogMode="disabled";g.tiles.forEach(row=>row.fill("plain"));
  const [u,ally,...enemies]=g.units;Object.assign(u,{x:3,y:8,en:100000});
  const center=G.center(u);const cy=center.y;
  Object.assign(ally,{x:8,y:cy-1,hp:1000000,shield:0});
  enemies.forEach((unit,i)=>Object.assign(unit,{x:i===3?16:8,y:cy+[0,1,2,0][i],hp:1000000,shield:0}));
  const skill=G.unitSkills(u).find(s=>s.type==="irradiation");
  const before=u.en, event=G.useSkill(g,u,skill.id,center.x+1,cy);
  assert.deepEqual(new Set(event.hits.map(hit=>hit.unitId)),new Set([ally.id,enemies[0].id,enemies[1].id]));
  assert.equal(event.areaWidth,3); assert.equal(event.to.x-event.from.x,10);
  assert.equal(u.en,before-G.modelOf(u).en*.5);
  const point={x:8,y:9,model:enemies[0].model};
  assert(G.irradiationIntersectsUnit({x:0,y:0},{x:10,y:10},point,3));
  assert(!G.irradiationIntersectsUnit({x:0,y:0},{x:10,y:10},{...point,x:0,y:7},3));
  assert(!G.irradiationIntersectsUnit({x:0,y:0},{x:10,y:0},{...point,x:12,y:0},3));
});


test("MEGA AI rejects an ally beside the center ray and large footprints resolve only once",()=>{
 const model=Object.values(G.models).find(m=>m.prefabId==="MSZ_010"),tank={unitId:"Type61",kitId:"standard"};
 const g=G.create(false,1,[[{unitId:"MSZ_010",kitId:model.kitId},tank],[tank,tank]],false,{costLimit:99999,unitCostLimit:99999});
 g.fogMode="disabled";g.tiles.forEach(row=>row.fill("plain"));
 const [u,ally,target,other]=g.units;
 Object.assign(u,{x:3,y:8,en:100000});Object.assign(ally,{x:5,y:9});Object.assign(target,{x:8,y:8,hp:1000000});other.hp=0;
 assert.equal(G.aiAreaSkill(g,u),null);
 Object.assign(ally,{x:1,y:1});assert.equal(G.aiAreaSkill(g,u).skillId,"Irradiation");
 target.model=Object.keys(G.models).find(id=>G.models[id].prefabId==="ApsarasII");
 const event=G.useSkill(g,u,"Irradiation",4,8);
 assert.equal(event.hits.filter(hit=>hit.unitId===target.id).length,1);
});
