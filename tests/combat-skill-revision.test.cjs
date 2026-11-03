const test=require("node:test"),assert=require("node:assert/strict");
const G=require("../shared/rules"),C=require("../shared/weapon-classes"),Conversion=require("../shared/conversion-rules.cjs");
const {createAttackPlanner}=require("../shared/attack-plans");
function fixture(model) {
  const entry={unitId:"RGM_79",kitId:"machine_gun"};
  const game=G.create(false,1,[[entry],[entry]],false,{fogMode:"disabled"});
  game.tiles.forEach(row=>row.fill("plain"));const [a,b]=game.units;
  Object.assign(a,{model:model||a.model,x:5,y:5,hp:1000000,en:100000,acted:false});
  Object.assign(b,{x:8,y:5,hp:1000000,en:100000});
  const room={game};let n=0;const planner=createAttackPlanner(G,()=>"skill-"+ ++n);planner.reset(room);
  return {game,a,b,room,planner};
}
test("mortar is a standalone skill, cannot join automatic fire or be cancelled into normal attacks",()=>{
  const model=Object.keys(G.models).find(id=>G.models[id].prefabId==="RX_77_2"&&G.models[id].weapons.some(w=>C.classify(w)==="mortar"));
  const f=fixture(model),w=G.modelOf(f.a).weapons.find(w=>C.classify(w)==="mortar");
  assert.equal(w.slot,"skill");assert.equal(w.noCounter,true);assert.equal(w.maxUsesPerTurn,1);
  assert(!G.firePlan(f.game,f.a,f.b).weapons.some(w=>C.classify(w)==="mortar"));
  f.planner.plan(f.room,f.a,f.b,[w],0);
  assert.equal(f.a.attackSkillRound,f.game.round);assert(f.a.acted);
  assert.throws(()=>f.planner.cancel(f.room,f.a),/不能取消/);
  assert.throws(()=>f.planner.plan(f.room,f.a,f.b,null,0),/攻击类技能/);
  f.planner.prepare(f.room);
  while(f.room.reactions.length)f.planner.choose(f.room,f.room.reactions[0].id,"defend");
  const battles=f.planner.resolve(f.room);
  assert(battles.length>0);assert(battles.every(b=>b.events.every(e=>e.weapon===w.id)));
});
test("all mortar models use skill slots and a single-cell impact",()=>{
  let count=0;for(const m of Object.values(G.models))for(const w of m.weapons)if(C.classify(w)==="mortar"){
    assert.equal(w.slot,"skill");assert.equal(w.special.radius,0);assert.equal(w.projectile.motion,"mortar");count++;
  }assert(count>20);assert.equal(C.rounds({weaponClass:"beam_rifle"}),2);
});
test("sniper charge is selected separately and conflicts with ordinary fire",()=>{
  const model=Object.keys(G.models).find(id=>G.models[id].weapons.some(w=>w.special?.type==="snipe"));
  const f=fixture(model),w=G.modelOf(f.a).weapons.find(w=>w.special?.type==="snipe");
  Object.assign(f.b,{x:Math.ceil(5+w.min),y:5});
  assert(!G.firePlan(f.game,f.a,f.b).weapons.some(w=>w.special?.type==="snipe"));
  f.planner.plan(f.room,f.a,f.b,[w],0);f.planner.prepare(f.room);
  assert.equal(f.a.snipeOrder.readyRound,f.game.round+2);
  const normal=G.modelOf(f.a).weapons.find(w=>w.slot!=="skill");
  assert.equal(G.canAttack(f.game,f.a,f.b,normal),false);
});
test("transform and its reverse share a once-per-turn limit across forms",()=>{
  const model=Object.keys(G.models).find(id=>G.models[id].prefabId==="Medea");
  const f=fixture(model),skill=G.unitSkills(f.a).find(s=>s.type==="transform");
  const event=G.useSkill(f.game,f.a,skill.id,f.a.x,f.a.y);
  const changed=f.game.units.find(u=>u.id===event.resultId);changed.acted=false;
  const reverse=G.unitSkills(changed).find(s=>s.type==="transform");
  assert.equal(G.canUseSkill(f.game,changed,reverse.id),false);
  f.game.round+=2;assert.equal(G.canUseSkill(f.game,changed,reverse.id),true);
});
test("all active skills are limited even if their configured cooldown is zero",()=>{
  const f=fixture(),base=G.models[f.a.model],source=Object.values(G.models).flatMap(m=>m.skills).find(s=>s.type==="resupply");
  G.models.skill_once_test={...base,skills:[{...structuredClone(source),cooldownTurns:0}]};f.a.model="skill_once_test";
  Object.assign(f.b,{x:6,y:5,team:0,en:0});const id=source.id;
  G.useSkill(f.game,f.a,id,6,5);f.b.en=0;
  assert.equal(G.canUseSkill(f.game,f.a,id),false);
  f.game.round+=2;assert.equal(G.canUseSkill(f.game,f.a,id),true);
});
test("sniper damage increases are independent, repeatable and preserve the native base",()=>{
  for(const special of [undefined,{type:"snipe"}]){
    const weapon={id:"sniper-test",category:"sniper",type:"shell",damagePerShot:1000,damageComponents:{shell:1000},hit:100,en:0,min:1,max:5,actionCost:4,attack:{steps:[]},special};
    const raw={stats:{},weapons:{w:weapon}},rules=Conversion.read();rules.weapons.damage=1;
    Conversion.globals(raw,rules);assert.equal(weapon.damagePerShot,special?1500:1250);
    Conversion.globals(raw,rules);assert.equal(weapon.damagePerShot,special?1500:1250);
  }
  const config=Conversion.read();assert.equal(config.weaponClasses.bazooka.accuracy,.95);assert.equal(config.weaponClasses.panzerfaust.accuracy,.9);assert.equal(config.weaponClasses.cannon.accuracy,.95);assert.equal(config.weaponClasses.mortar.accuracy,.935);
});


test("charged shot arriving next own turn also excludes normal attacks",()=>{
 const f=fixture(),w=G.modelOf(f.a).weapons[0];
 f.game.round=3;f.a.readySnipe={target:f.b.id,weapon:w.id};
 f.planner.resumeCharges(f.room);
 assert.equal(f.a.attackSkillRound,3);assert.equal(f.a.acted,true);
 assert.throws(()=>f.planner.plan(f.room,f.a,f.b,null,0),/攻击类技能/);
});
