const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const G=require('../shared/rules.js'),P=require('../shared/unit-plugins.js'),W=require('../shared/warehouse.js');
const base=G.models.RGM_79__beam_spray;
function economy(saved){const data=new Map(saved?[["projectgreed.economy.v1",JSON.stringify(saved)]]:[]),context=vm.createContext({require:require('node:module').createRequire(path.resolve('shared/economy.js')),module:{exports:{}},structuredClone,ART:G.catalog,localStorage:{getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)}});vm.runInContext(fs.readFileSync('shared/economy.js','utf8'),context);return context.module.exports;}
test('four empty slots, whitelist, MS restrictions and duplicate rejection',()=>{
  assert.equal(P.catalog.length,18);assert.deepEqual(P.normalize(undefined,base),[null,null,null,null]);
  for(const slots of [['frame','frame'],['unknown'],['frame','armor','generator','antenna','magnetic'],[{}]])assert.throws(()=>P.apply(base,slots));
  assert.throws(()=>P.apply(G.models.Medea__standard,['water']));
  for(const part of P.catalog)assert(P.apply(base,[part.id]));
});
test('HP, EN, coefficients, command range, armor and COST derive without changing base',()=>{
  const original=JSON.stringify(base),m=P.apply(base,['frame','armor','generator','chobham']);
  assert.equal(m.hp,Math.round(base.hp*1.15+16000));assert.equal(m.en,Math.round(base.en*1.25));
  assert.equal(m.partStructuralStrength,Math.round(base.partStructuralStrength*1.2));
  assert.equal(m.speed,base.speed-10);assert.equal(m.mobility,base.mobility-10);
  assert.equal(m.cost,base.cost+150);assert.equal(m.shellFinalResistance,25);
  assert.equal(P.apply({...base,shellFinalResistance:25},['chobham']).shellFinalResistance,25);
  assert.equal(P.apply(base,['panoramic','tem_ray']).accuracy,Math.round(base.accuracy*1.1+10));
  const actor=G.makeUnit({unitId:'RGM_79',kitId:'beam_spray',plugins:['antenna']},0,100,{x:1,y:1});
  const plain=G.makeUnit({unitId:'RGM_79',kitId:'beam_spray'},0,100,{x:1,y:1});
  assert.equal(G.commandAura(actor).radius,G.commandAura(plain).radius+2);
  assert.equal(JSON.stringify(base),original);assert.strictEqual(P.apply(base,['frame']),P.apply(base,['frame']));
});
test('adaptability and shields respect hard caps; hover bonus is ground only',()=>{
  const m=P.apply({...base,adaptability:{ground:95,space:80,water:0},shield:{...base.shield,blockChance:.7}},['water','ambac','shield','hover']);
  assert.deepEqual(m.adaptability,{ground:100,space:5,water:100});assert.equal(m.shield.blockChance,.75);
  assert.equal(m.shield.hp,Math.round(base.shield.hp*1.25));
  const actor={model:'RGM_79__beam_spray',plugins:['hover','limiter'],environment:'ground',hp:100,en:100};
  assert.equal(G.modelOf(actor).move,base.move+3);
  const space=G.modelOf({...actor,environment:'space'});assert.equal(space.move,0);
  const plain=G.modelOf({...actor,plugins:['limiter'],environment:'space'});assert(plain.move<=base.move+1);
});
test('beam modifications update actual firing steps and maximum range, leaving shell and melee untouched',()=>{
  const m=P.apply(base,['short_beam']),weapon=base.weapons.find(w=>w.type==='beam'),changed=m.weapons.find(w=>w.id===weapon.id);
  assert.equal(changed.max,Math.max(weapon.min,weapon.max-1));assert.equal(changed.hit,Math.min(100,weapon.hit+20));
  for(let i=0;i<weapon.attack.steps.length;i++)if(Number.isFinite(weapon.attack.steps[i].accuracy))assert.equal(changed.attack.steps[i].accuracy,Math.min(100,weapon.attack.steps[i].accuracy+20));
  for(let i=0;i<weapon.attack.strikes.length;i++)if(Number.isFinite(weapon.attack.strikes[i].accuracy))assert.equal(changed.attack.strikes[i].accuracy,Math.min(100,weapon.attack.strikes[i].accuracy+20));
  for(const w of base.weapons.filter(w=>w.type==='melee'||w.type==='shell'))assert.strictEqual(m.weapons.find(next=>next.id===w.id),w);
});
test('purchased equipment fits without additional fees, persists and preserves damage',()=>{
  const E=economy();E.creditActivity({id:'plugin-stock',matchId:'plugin-stock',money:100000,supplies:0,inventory:{RGM_79:1}});
  E.purchasePlugin('anaheim','frame');E.purchasePlugin('anaheim','generator');
  const before=E.snapshot(),item=before.storage.units[0],id=item.id;
  E.creditAward({id:'plugin-damage',matchId:'plugin-damage',money:0,supplies:0,stockStates:[{stockId:id,unitId:item.unitId,kitId:item.kitId,hp:Math.round(item.hp/2),en:0,brokenParts:{}}]});
  assert(E.setStoredPlugin(id,0,'frame'));assert(E.setStoredPlugin(id,1,'generator'));
  const fitted=E.snapshot(),stored=fitted.storage.units[0],model=P.apply(G.models[stored.unitId+'__'+stored.kitId],stored.plugins);
  assert.equal(fitted.money,before.money);assert.equal(fitted.supplies,before.supplies);
  assert(Math.abs(stored.hp/model.hp-.5)<.0001);assert.equal(stored.en,0);
  assert.equal(JSON.stringify(economy(fitted).snapshot()),JSON.stringify(fitted));
  assert.throws(()=>E.setStoredPlugin(id,2,'frame'));assert.equal(JSON.stringify(E.snapshot()),JSON.stringify(fitted));
  assert(E.repairAllStoredUnits());const repaired=E.snapshot().storage.units[0];assert.equal(repaired.hp,model.hp);assert.equal(repaired.en,model.en);
  const profile=E.storedUnits()[0];assert.deepEqual(JSON.parse(JSON.stringify(profile.plugins)),['frame','generator',null,null]);
  assert(E.setStoredPlugin(id,0,null));assert.equal(E.snapshot().storage.units[0].hp,item.hp);
});
test('formation and actors retain plugin IDs, use added COST and reject untrusted modifier objects',()=>{
  const entry={unitId:'RGM_79',kitId:'beam_spray',plugins:['frame','ground']};
  const clean=G.validateFormation([entry],Infinity,72);
  assert.deepEqual(clean[0].plugins,['frame','ground',null,null]);
  const model=G.formationModel(clean[0]),actor=G.makeUnit(clean[0],0,55,{x:2,y:2});
  assert.equal(actor.hp,G.modelOf(actor).hp);assert.equal(G.modelOf(actor).cost,model.cost);
  assert.equal(model.cost,base.cost+Math.round((25+base.chassisCost*.1)/25)*25);
  assert.throws(()=>G.validateFormation([{...entry,plugins:[{id:'frame',hp:999999}]}],Infinity,72));
  const profile=W.profile([{id:'plugin-unit',unitId:'RGM_79',kitId:'beam_spray',plugins:['frame'],hp:Math.round(base.hp*1.05),en:base.en}],G.models)[0];
  assert.equal(profile.hp,Math.round(base.hp*1.05));
});

test('percentage plugin COST excludes weapon kits, pilots and other plugins',()=>{
  const first={...base,cost:750,chassisCost:500},second={...first,cost:850};
  assert.equal(P.apply(first,['water']).cost-first.cost,50);
  assert.equal(P.apply(second,['water']).cost-second.cost,50);
  assert.equal(P.apply(second,['water','frame']).cost-second.cost,75);
});

test('room authority uses stored plugin IDs when creating quick-match actors',t=>{
  const {createRoomEngine}=require('../shared/room-engine');let serial=0;
  const errors=[],engine=createRoomEngine({rules:G,randomId:()=>String(++serial),randomToken:()=>String(++serial),randomSeed:()=>7319,send:(_,message)=>{if(message.type==='error')errors.push(message);},aiDelayMs:999999});
  t.after(()=>engine.close());const clients=[{readyState:1},{readyState:1}];
  const storedUnits=[['Medea','standard','armor'],['Type61','standard','generator']].map(([unitId,kitId,part],index)=>{
    const model=P.apply(G.models[unitId+'__'+kitId],[part]);return{id:'stock-'+index,unitId,kitId,plugins:[part],hp:model.hp,en:model.en};
  });
  clients.forEach((ws,index)=>engine.join(ws,{mode:index?'join':'create',room:'PLUGINS',roomMode:'quick',characterFaction:'PMC',licenses:{Medea:true,Type61:true},inventory:{Medea:5,Type61:5},storedUnits}));
  const room=engine.rooms.get('PLUGINS');
  const act=(index,action,fields={})=>engine.action(clients[index],{id:'action-'+ ++serial,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...fields});
  const formation=storedUnits.map((item,index)=>({unitId:item.unitId,kitId:item.kitId,stockId:item.id,plugins:['limiter'],...(index?{preload:{carrierIndex:0,hangarId:'Hangar_1'}}:{})}));
  act(1,'set_ready',{ready:true,formation});act(0,'start_game',{formation});act(0,'confirm_formation');act(1,'confirm_formation');
  const actors=room.game.units.filter(unit=>G.ownerOf(unit)===0);assert.equal(actors.length,2,JSON.stringify(errors));
  assert.deepEqual(actors.map(actor=>actor.plugins[0]).sort(),['armor','generator']);
  for(const actor of actors){assert.equal(actor.hp,G.modelOf(actor).hp);assert.equal(actor.en,G.modelOf(actor).en);}
  assert.equal(errors.length,0);
});
