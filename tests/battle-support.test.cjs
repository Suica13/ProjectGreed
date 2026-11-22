const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm"),path=require("node:path"),{createRequire}=require("node:module");
const G=require("../shared/rules"),catalog=require("../tools/load-catalog.cjs").loadCatalog({embedAssets:false});
function load(){
  const data=new Map();let fail=false;
  const context=vm.createContext({require:createRequire(path.resolve("shared/economy.js")),module:{exports:{}},ART:catalog,structuredClone,
    localStorage:{getItem:k=>data.get(k)??null,setItem:(k,v)=>{if(fail&&k==="pilots")throw Error("write failed");data.set(k,v);},removeItem:k=>data.delete(k)}});
  vm.runInContext(fs.readFileSync("shared/economy.js","utf8"),context);
  return {E:context.module.exports,data,setFailure:value=>fail=value};
}
test("formation repair and pilot revival commit together, reject insufficient funds and roll back failed roster saves",()=>{
  const {E,data,setFailure}=load(),[unit,untouched]=E.snapshot().storage.units;
  E.creditAward({id:"support-damage",matchId:"support",money:0,supplies:0,stockStates:[unit,untouched].map(u=>({stockId:u.id,unitId:u.unitId,kitId:u.kitId,hp:100,en:0,brokenParts:{head:true}}))});
  const quote=E.repairQuote([unit.id]),before=JSON.stringify(E.snapshot());
  assert.throws(()=>E.repairAllStoredUnits(quote,999999999,[["pilots","revived"]]),/物资不足/);
  assert.equal(JSON.stringify(E.snapshot()),before);
  data.set("pilots","dead");setFailure(true);
  assert.throws(()=>E.repairAllStoredUnits(quote,500,[["pilots","revived"]]),/write failed/);
  assert.equal(JSON.stringify(E.snapshot()),before);assert.equal(data.get("pilots"),"dead");
  setFailure(false);const wallet=E.snapshot().supplies;
  assert(E.repairAllStoredUnits(quote,500,[["pilots","revived"]]));
  assert.equal(E.snapshot().supplies,wallet-quote.supplies-500);assert.equal(data.get("pilots"),"revived");
  assert.equal(E.repairQuote([unit.id]).items.length,0);assert.equal(E.repairQuote([untouched.id]).items.length,1);
  assert.throws(()=>E.repairAllStoredUnits(quote,0),/库存状态已变化/);
});
test("pilot-only and free level-zero revival can be committed without damaged chassis",()=>{
  const {E,data}=load(),before=E.snapshot().supplies;
  assert(E.repairAllStoredUnits(E.repairQuote([]),0,[["pilots","revived"]]));
  assert.equal(data.get("pilots"),"revived");assert.equal(E.snapshot().supplies,before);
  assert.throws(()=>E.repairAllStoredUnits(E.repairQuote([]),-1),/无效/);
});
const entry=id=>({unitId:id,kitId:G.catalog.prefabs.find(p=>p.id===id).weaponKits[0].id});
test("PS absorption is reported per strike and as the exact volley total without changing damage resolution",()=>{
  const game=G.create(false,1,[[entry("ZGMF_1017")],[entry("GAT_X105")]],false,{costLimit:99999,unitCostLimit:99999}),[a,b]=game.units;
  Object.assign(a,{x:2,y:4});Object.assign(b,{x:4,y:4,shield:0,hp:1000000});
  const base=G.modelOf(a).weapons.find(w=>w.type!=="melee"),weapon={...base,min:0,max:30,en:0,hitScale:100,damageComponents:{shell:2000},shotCount:1,
    attack:{...base.attack,strikes:[{...base.attack.strikes[0],at:0,shotIndex:0,damageComponents:{shell:2000}}]}};
  const before=G.modelOf(b).phaseShift.capacity,event=G.fight(game,a,b,weapon,"counter",null,false)[0];
  assert(event.phaseShiftDamage>0);assert.equal(event.phaseShiftDamage,before-b.phaseShiftHp);
  assert.equal(event.phaseShiftDamage,event.strikes.reduce((n,s)=>n+(s.phaseShiftDamage||0),0));
  assert.equal(event.damage,event.before-event.after);
});
