const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../shared/rules.js');
const entry=id=>({unitId:id,kitId:G.catalog.prefabs.find(p=>p.id===id).defaultKit});
function fixture(){
 const game=G.create(false,17,[[entry('RGM_79'),entry('RGM_79'),entry('RGM_79')],[entry('RGM_79')]],false,{costLimit:99999,unitCostLimit:99999,fogMode:'disabled'});
 game.deployment=null;game.tiles.forEach(row=>row.fill('plain'));
 game.units.forEach((u,i)=>Object.assign(u,{x:8+i*4,y:10}));
 return game;
}
function model(u,id){u.model=id+'__'+G.catalog.prefabs.find(p=>p.id===id).defaultKit;Object.assign(u,{hp:G.modelOf(u).hp,en:G.modelOf(u).en});}
test('buildings cannot evade or physically dodge missed shots',()=>{
 const g=fixture(),a=g.units[0],b=g.units[3];model(b,'Facility_Beam');b.x=a.x+2;b.y=a.y;
 assert.equal(G.canEvade(b),false);assert.equal(G.canEvade(a),true);
 const w={...G.modelOf(a).weapons.find(w=>w.type!=='melee'),hitScale:1e-10};
 assert.deepEqual(G.estimate(g,a,b,w,'evade'),G.estimate(g,a,b,w,'defend'));
 assert.notEqual(G.bestResponse(g,a,b,w).response,'evade');
 const event=G.resolveProjectile(g,a,b,w,'evade');
 assert(event[0].strikes.some(s=>s.executed&&!s.hit));
 assert(event[0].strikes.every(s=>s.dodgeTo===null));
});
test('Skygrasper and Launcher Strike share one-round localized impulse cannon',()=>{
 for(const id of ['FX_550','GAT_X105_L']){
  const p=G.catalog.prefabs.find(p=>p.id===id),w=p.weapons.OMNI_GAT_X105_Launcher;
  assert.equal(w.name,'高能脉冲炮');assert.equal(w.attackRounds,1);
  assert.equal(w.localization.en.name,'High-Energy Impulse Cannon');
  for(const kit of p.weaponKits.filter(k=>k.weapons.includes('OMNI_GAT_X105_Launcher'))){
   assert.equal(G.models[id+'__'+kit.id].weapons.find(w=>w.id==='OMNI_GAT_X105_Launcher').attackRounds,1);
  }
 }
});
test('all native ordinary transform machines have valid reversible forms and can transform in battle',()=>{
 const bases=G.catalog.prefabs.filter(p=>!p.formOnly&&p.sourceStats?.nativeSkills?.some(s=>/^Transform_Land(?:Fly|Land_Tank)(?:_SFS_OFF)?$/.test(s)));
 assert(bases.some(p=>p.id==='NRX_044'));assert(bases.some(p=>p.id==='MRX_009'));assert(bases.length>30);
 for(const p of bases) for(const kit of p.weaponKits){
  const g=fixture(),u=g.units[0];model(u,p.id);u.model=p.id+"__"+kit.id;u.hp=G.modelOf(u).hp;u.en=G.modelOf(u).en;const originalModel=u.model;u.hp=Math.floor(u.hp/2);u.en=Math.floor(u.en/2);
  const skill=G.unitSkills(u).find(s=>s.type==='transform'&&!s.deploymentMode);
  assert(skill,p.id+' transform missing');
  assert.equal(G.canUseSkill(g,u,skill.id),true,p.id+' unavailable');
  G.useSkill(g,u,skill.id,u.x,u.y);
  assert.equal(G.modelOf(u).prefabId,skill.source.unitId,p.id);
  assert(u.hp<=Math.ceil(G.modelOf(u).hp/2),p.id+' healed');
  assert(u.en<=Math.ceil(G.modelOf(u).en/2),p.id+' EN refilled');
  const back=G.unitSkills(u).find(s=>s.type==='transform'&&s.source?.unitId===p.id);
  assert(back,p.id+' return missing');
  g.round++;u.acted=false;u.moved=false;
  G.useSkill(g,u,back.id,u.x,u.y);
  assert.equal(G.modelOf(u).prefabId,p.id);assert.equal(u.model,originalModel,p.id+" kit round trip");
 }
});
test('cargo transfers between compartments and nested SFS preserve identity and resources and forbid cycles',()=>{
 const g=fixture(),[ship,ms,sfs]=g.units;model(ship,'PegasusClass');model(sfs,'DodaiYS');
 const h=G.hangars.of(ship)[0],sh=G.hangars.of(sfs)[0];assert.equal(sh.kind,'sfs');
 ms.embarked={carrierId:ship.id,hangarId:h.id,boardRound:0};
 sfs.embarked={carrierId:ship.id,hangarId:h.id,boardRound:0};G.hangars.sync(g);
 const original={id:ms.id,hp:ms.hp,en:ms.en,acted:ms.acted};
 assert(G.hangars.canTransfer(g,ms,sfs,sh.id));G.hangars.transfer(g,ms,sfs,sh.id);
 assert.equal(ms.embarked.exposed,false);assert.equal(ms.embarked.boardRound,0);
 assert.deepEqual({id:ms.id,hp:ms.hp,en:ms.en,acted:ms.acted},original);
 assert.equal(G.hangars.canTransfer(g,sfs,sfs,sh.id),false);
 assert.equal(G.hangars.canTransfer(g,ship,sfs,sh.id),false);
 G.hangars.transfer(g,ms,ship,h.id);assert.equal(ms.embarked.carrierId,ship.id);
 // A second compartment uses the same capacity/type validation as ordinary boarding.
 const other=G.hangars.of(ship).find(slot=>slot.id!==h.id&&G.hangars.canTransfer(g,ms,ship,slot.id));
 if(other){G.hangars.transfer(g,ms,ship,other.id);assert.equal(ms.embarked.hangarId,other.id);}
 const foreign=g.units[3];model(foreign,'PegasusClass');
 assert.equal(G.hangars.canTransfer(g,ms,foreign,G.hangars.of(foreign)[0].id),false);
 foreign.team=ship.team;assert.equal(G.hangars.canTransfer(g,ms,foreign,G.hangars.of(foreign)[0].id),false);
 ms.team=1;assert.equal(G.hangars.canTransfer(g,ms,ship,h.id),false);
});


test('cross-carrier transfers require adjacent hulls and cannot reset launch or action locks',()=>{
 const g=fixture(),[ship,ms,other]=g.units;
 model(ship,'PegasusClass');model(other,'PegasusClass');
 const h=G.hangars.of(ship)[0],destination=G.hangars.of(other)[0];
 ms.embarked={carrierId:ship.id,hangarId:h.id,boardRound:0};G.hangars.sync(g);
 assert.equal(G.hangars.canTransfer(g,ms,other,destination.id),false);
 const distance=()=>Math.min(...G.cells(ship).flatMap(a=>G.cells(other).map(b=>Math.abs(a.x-b.x)+Math.abs(a.y-b.y))));
 other.y=ship.y;
 let adjacent=false;
 for(let x=0;x<g.tiles[0].length;x++){other.x=x;if(distance()===1){adjacent=true;break;}}
 assert(adjacent);assert(G.hangars.canTransfer(g,ms,other,destination.id));
 G.hangars.transfer(g,ms,other,destination.id);
 assert.equal(ms.acted,true);assert.equal(ms.moved,true);assert.equal(ms.embarked.boardRound,g.round);
 assert.equal(G.hangars.canTransfer(g,ms,ship,h.id),false);
 assert.deepEqual(G.hangars.launchCells(g,ms),[]);
});

test('transfer cannot overfill an SFS or mutate cargo when refused',()=>{
 const g=fixture(),[ship,ms,sfs]=g.units;model(ship,'PegasusClass');model(sfs,'DodaiYS');
 const h=G.hangars.of(ship)[0],sh=G.hangars.of(sfs)[0];
 for(const u of [ms,sfs])u.embarked={carrierId:ship.id,hangarId:h.id,boardRound:0};
 for(let i=0;i<sh.capacity;i++)g.units.push({...ms,id:'capacity-'+i,embarked:{carrierId:sfs.id,hangarId:sh.id}});
 const before=JSON.stringify(g.units);
 assert.equal(G.hangars.canTransfer(g,ms,sfs,sh.id),false);
 assert.throws(()=>G.hangars.transfer(g,ms,sfs,sh.id),/无法转移/);
 assert.equal(JSON.stringify(g.units),before);
});

test('transformed chassis survive inventory validation and hangar form changes without new permits',()=>{
 const E=require('../shared/economy');
 const ids=G.catalog.prefabs.filter(p=>p.formOnly&&p.formOf&&p.skills?.some(s=>s.type==='transform'&&!s.deploymentMode)).map(p=>p.id);
 for(const id of ids){
  assert(G.models[E.defaultModel(id)],id+' missing inventory default');
  assert.doesNotThrow(()=>E.normalizeStock({inventory:{[id]:1}}),id);
 }
 const id='NRX_044',target='NRX_044_MA';
 assert(E.creditActivity({id:'transform-stock-test',matchId:'transform-stock-test',money:0,supplies:0,inventory:{[id]:1}}));
 assert(E.transformStock(id,target));assert.equal(E.quantity(target),1);assert.equal(E.quantity(id),0);
 assert.equal(E.hasLicense(target),false);
 assert(E.transformStock(target,id));assert.equal(E.quantity(id),1);assert.equal(E.quantity(target),0);
});
