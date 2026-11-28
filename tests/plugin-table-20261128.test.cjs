const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules'),P=require('../shared/unit-plugins'),C=require('../shared/contact-tasks');
const base=G.models.RGM_79__beam_spray;
test('table restrictions, era grouping and every T1 Anaheim product has a T1 commission',()=>{
 for(const p of P.catalog.filter(p=>p.merchant==='anaheim'&&p.era==='UC_0079_T1')){
  const task=C.tasks.find(t=>t.pluginUnlocks?.includes(p.id));assert(task,p.id);assert.equal(task.era,p.era);
 }
 for(const t of C.tasks.filter(t=>t.pluginUnlocks?.length))for(const id of t.pluginUnlocks)assert.equal(P.byId.get(id).era,t.era,id);
 assert(!P.allowed(P.byId.get('artillery_sight'),base));assert(P.allowed(P.byId.get('artillery_sight'),{...base,ship:true}));
 assert(!P.allowed(P.byId.get('veda'),base));assert(P.allowed(P.byId.get('veda'),G.models.GN_003__default));
 assert.equal(P.apply(base,['motion_memory']).speed,Math.round(base.speed*.9));
 assert.equal(P.apply(base,['motion_memory','armor_monitor']).pilotExperienceMultiplier,1.4);
 const m=P.apply(base,['anti_beam_coating']);assert.equal(m.abc.capacity,Math.round(m.hp*.25));
 assert.equal(P.apply({...base,abc:{capacity:100,reductions:{beam:.75}}},['anti_beam_coating']).abc.capacity,100+Math.round(base.hp*.1));
});
test('spare parts recover HP and exactly one broken limb once per battle',()=>{
 const game=G.create(false,177,[[{unitId:'RGM_79',kitId:'beam_spray',plugins:['ms_spares']}],[{unitId:'MS_06F',kitId:'machine_gun'}]],false,{costLimit:50000,formationStyle:'free'});
 const u=game.units[0],max=G.modelOf(u).hp;u.hp=Math.round(max*.5);u.brokenParts={leftArm:true,rightLeg:true};
 const skill=G.unitSkills(u).find(s=>s.id==='plugin_ms_spares');require('../shared/unit-skills').validate([skill]);
 const hp=u.hp;G.useSkill(game,u,skill.id,u.x,u.y);assert.equal(u.hp,hp+Math.round(max*.25));
 assert.equal(Object.keys(u.brokenParts).length,1);assert.equal(u.skillUses.plugin_ms_spares,1);
 assert(!G.canUseSkill(game,u,skill.id));assert.throws(()=>G.useSkill(game,u,skill.id,u.x,u.y));
});
test('vulcan ammo redistributes damage into AP without duplicating total damage',()=>{
 const Classes=require('../shared/weapon-classes'),w=base.weapons.find(Classes.headVulcan);assert(w);
 const changed=P.apply(base,['caseless_ammo']).weapons.find(x=>x.id===w.id);
 assert.equal(changed.damagePerShot,w.damagePerShot);assert(changed.damageComponents.shellAP>0);
 assert.equal(changed.armorPiercingIgnore,.5);
});
test('weapon rack adds one primary volley after coefficient scaling',()=>{
 const game=G.create(false,177,[[{unitId:'RGM_79',kitId:'beam_spray'}],[{unitId:'MS_06F',kitId:'machine_gun'}]],false,{costLimit:50000,formationStyle:'free'});
 const u=game.units[0],w=G.modelOf(u).weapons.find(w=>w.slot==='primary');assert(w);
 const count=G.attackRounds(game,u,w);u.plugins=['weapon_rack'];assert.equal(G.attackRounds(game,u,G.modelOf(u).weapons.find(x=>x.id===w.id)),count+1);
});
test('Kyrios complete pincer sequence is halved before 25-point rounding',()=>{
 const store=require('../tools/catalog-editor-store.cjs').createEditorStore(),result=store.getUnit('GN_003');
 const w=result.unit.weapons.CB_GN_003_Combo;
 assert.equal(w.damageComponents.melee,1125);assert.equal(w.damageComponents.meleeShell,1125);
 const strikes=w.attack.steps.filter(s=>s.damageComponents);assert.equal(strikes.length,12);
 assert.equal(strikes[0].damageComponents.meleeAP,618.75);assert.equal(strikes.at(-1).damageComponents.meleeAP,3375);
});

test('maintenance restores two distinct ship modules on the own turn',()=>{
 const ship=G.models.SalamisClass__standard;
 const g=G.create(false,177,[[{unitId:'RGM_79',kitId:'beam_spray'}],[{unitId:'MS_06F',kitId:'machine_gun'}]],false,{costLimit:50000,formationStyle:'free'});
 g.units[0]={...g.units[0],...G.makeUnit({unitId:ship.prefabId,kitId:ship.kitId,plugins:["ship_maintenance"]},0,100,{x:1,y:1})};
 const u=g.units[0],model=G.modelOf(u);u.moduleHp=Object.fromEntries(model.modules.map(m=>[m.id,Math.round(m.hp*.5)]));
 const before={...u.moduleHp};G.end(g);G.end(g);
 const changed=model.modules.filter(m=>u.moduleHp[m.id]!==before[m.id]);assert.equal(changed.length,2);
 for(const m of changed)assert.equal(u.moduleHp[m.id],before[m.id]+Math.round(m.hp*.1));
});
test('brainwave sensor affects pilot awakening and reserve magazine uses shell bonus',()=>{
 const u=G.makeUnit({unitId:'RGM_79',kitId:'beam_spray'},0,100,{x:1,y:1});
 const before=G.modelOf(u);u.plugins=['brainwave_sensor','reserve_magazine'];const after=G.modelOf(u);
 assert.equal(after.incomingDamageMultiplier,1.05);assert.equal(after.attackBonuses.shell,before.attackBonuses.shell+5);
 const pilots=require('../shared/pilots');assert.equal(pilots.of(u,P.apply(base,u.plugins)).stats.awakening,pilots.of({...u,plugins:[]},base).stats.awakening+15);
});
