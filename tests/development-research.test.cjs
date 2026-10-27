const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const tree=require('../shared/development-tree.json');
function load(saved={}) {
 const storage=new Map(Object.entries(saved));
 const context={DEVELOPMENT_TREE:tree,module:{exports:{}},localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)}};
 vm.runInNewContext(fs.readFileSync(require.resolve('../shared/development.js'),'utf8'),context);
 return {D:context.module.exports,storage,context};
}
test('research checks prerequisites, spends once, invalidates cached units and survives reload',()=>{
 const {D,storage}=load();const first=tree.EFSF.find(n=>n.points>0 && n.requires.every(id=>D.unlockedTech('EFSF').includes(id)));
 const later=tree.EFSF.find(n=>n.requires.includes(first.id));
 const unit=first.unlocks.find(id=>!D.allows('EFSF',id));
 assert.equal(D.research('EFSF',first.id),false);
 D.creditAward({id:'award',matchId:'match',faction:'EFSF',points:100000});
 if(later) assert.equal(D.research('EFSF',later.id),false);
 assert.equal(D.research('ZEON',first.id),false);
 assert.equal(D.research('EFSF',first.id),true);
 assert.equal(D.pointBalance('EFSF'),100000-first.points);
 assert.equal(D.research('EFSF',first.id),false);
 assert(D.allows('EFSF',unit));assert(D.allows('PMC',unit));
 const restored=load(Object.fromEntries(storage)).D;
 assert(restored.allows('EFSF',unit));assert.equal(restored.pointBalance('EFSF'),D.pointBalance('EFSF'));
 const G=require('../shared/rules.js');
 const prefab=G.catalog.prefabs.find(p=>first.unlocks.includes(p.id));
 const rules=G.armyRestrictions(G.defaultRoomSettings(),{seat:0,characterFaction:'EFSF',researched:restored.researchSnapshot()});
 assert.notEqual(G.planFormation([{unitId:prefab.id,kitId:prefab.weaponKits[0].id}],Infinity,rules).reasons[0],'not_developed');
});
test('failed persistence never spends points or unlocks technology',()=>{
 const {D,context}=load();D.creditAward({id:'a',matchId:'m',faction:'EFSF',points:100000});
 const node=tree.EFSF.find(n=>n.points>0 && n.requires.every(id=>D.unlockedTech('EFSF').includes(id)));
 context.localStorage.setItem=()=>{throw Error('quota');};
 assert.throws(()=>D.research('EFSF',node.id),/quota/);
 assert.equal(D.pointBalance('EFSF'),100000);assert(!D.unlockedTech('EFSF').includes(node.id));
});
test('specific unit grants are an OR alternative without unlocking technology or sibling units',()=>{
 const {D,storage}=load();const node=tree.EFSF.find(n=>n.points>0 && n.unlocks.filter(id=>!D.allows('EFSF',id)).length>1);
 const [unit,sibling]=node.unlocks.filter(id=>!D.allows('EFSF',id));
 assert(D.grantUnit('EFSF',unit));assert(D.allows('PMC',unit));assert(!D.allows('EFSF',sibling));
 assert(!D.unlockedTech('EFSF').includes(node.id));assert.equal(D.pointBalance('EFSF'),0);
 assert(!D.grantUnit('EFSF','invalid'));assert(!D.grantUnit('ZEON',unit));
 const restored=load(Object.fromEntries(storage)).D;
 assert(restored.allows('EFSF',unit));assert(D.allows('PMC',unit,restored.researchSnapshot()));
 assert(!D.allows('PMC',sibling,restored.researchSnapshot()));
});
