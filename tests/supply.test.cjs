const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), path = require("node:path");
const { createRequire } = require("node:module");
const catalog = require("../tools/load-catalog.cjs").loadCatalog({ embedAssets: false });
const source = fs.readFileSync("shared/economy.js", "utf8");
function load(saved, options = {}) {
  const data = new Map(saved ? [["projectgreed.economy.v1", JSON.stringify(saved)]] : []);
  const rolls = [];
  const math = Object.create(Math); math.random = () => {
    assert(rolls.length, "draw requested an unexpected random value");
    return rolls.shift();
  };
  const ctx = vm.createContext({ require: createRequire(path.resolve("shared/economy.js")), module: { exports: {} },
    structuredClone, ART: catalog, Math: math, ...(options.location ? { location: options.location } : {}),
    localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) } });
  vm.runInContext(source, ctx);
  return { E: ctx.module.exports, data, rolls, ctx };
}
function profile() {
  const saved = load().E.initial("EFSF");
  saved.itemInventory = { "0079t1-token": 100 };
  return saved;
}
const pool = "gundam-04-05";
test("activity tokens credit once, survive reload and can be spent on supply", () => {
  const {E,rolls}=load(profile());
  const award={id:"token-mail",matchId:"token-server",money:0,supplies:0,itemInventory:{"0079t1-token":123}};
  assert(E.creditActivity(award));assert.equal(E.snapshot().itemInventory["0079t1-token"],223);
  assert.equal(E.creditActivity(award),false);
  const reloaded=load(E.snapshot());assert.equal(reloaded.E.creditActivity(award),false);
  assert.equal(reloaded.E.snapshot().itemInventory["0079t1-token"],223);
  rolls.push(.5,0,0);E.drawSupply(pool,1);
  assert.equal(E.snapshot().itemInventory["0079t1-token"],222);
});

test("invalid or overflowing activity tokens and failed persistence roll back all gifts and claims", () => {
  const {E,ctx}=load(profile()),before=JSON.stringify(E.snapshot());
  const award={id:"token-mail",matchId:"token-server",money:12,supplies:34,itemInventory:{"0079t1-token":123}};
  for(const items of [null,[],{"missing":1},{"0079t1-token":-1},{"0079t1-token":1.5},{"0079t1-token":1000000}]){
    assert.throws(()=>E.creditActivity({...award,itemInventory:items}));
    assert.equal(JSON.stringify(E.snapshot()),before);
  }
  const save=ctx.localStorage.setItem;
  ctx.localStorage.setItem=()=>{throw Error("save failed");};
  assert.throws(()=>E.creditActivity(award),/save failed/);
  assert.equal(JSON.stringify(E.snapshot()),before);
  ctx.localStorage.setItem=save;assert(E.creditActivity(award));
  assert.equal(E.snapshot().itemInventory["0079t1-token"],223);
});
test("grade boundaries award all new reward types with atomic persistence", () => {
  for (const [roll, subtype, grade, kind] of [
    [0,0,"S","unit"], [.029999,.99,"S","rental"], [.03,0,"A","unit"],
    [.079999,.75,"A","rental"], [.05,.95,"A","item"], [.08,0,"B","unit"],
    [.179999,.99,"B","rental"], [.18,0,"C","supplies"], [.9,.1,"C","supplies"],
    [.9,.4,"C","money"], [.9,.63,"C","item"], [.99999,.99,"C","plugin"]]) {
    const {E,rolls}=load(profile()),before=E.snapshot();
    rolls.push(roll,subtype);if(kind!=="item")rolls.push(0);
    const result=E.drawSupply(pool,1)[0],after=E.snapshot();
    assert.equal(result.grade,grade);assert.equal(result.kind,kind);assert.equal(rolls.length,0);
    assert.equal(after.itemInventory["0079t1-token"],99+(kind==="item"?result.quantity:0));
    if(result.unitId){
      const item=after.storage.deliveries.find(item=>item.unitId===result.unitId);
      assert(item);assert.equal(item.rentalUses,kind==="rental"?10:undefined);
      assert.equal(JSON.stringify(after.storage.units),JSON.stringify(before.storage.units));
      assert.equal(JSON.stringify(after.inventory),JSON.stringify(before.inventory));
      assert(!after.licenses[result.unitId]||before.licenses[result.unitId]);
    }else if(result.pluginId)assert.equal(after.pluginInventory[result.pluginId],1);
    else if(kind!=="item")assert.equal(after[kind]-before[kind],2000);
    else assert.equal(result.quantity,grade==="A"?10:1);
    assert.equal(JSON.stringify(load(after).E.snapshot()),JSON.stringify(after));
  }
});

test("all drawn chassis wait in deliveries even with free hangar slots and can later be received", () => {
  const {E,rolls}=load(profile()),before=E.snapshot();
  rolls.push(0,0,0,.05,.75,.55);
  E.drawSupply(pool,1);E.drawSupply(pool,1);
  const pending=E.snapshot();
  assert.equal(pending.storage.deliveries.length-before.storage.deliveries.length,2);
  assert.equal(JSON.stringify(pending.storage.units),JSON.stringify(before.storage.units));
  assert(pending.storage.deliveries.some(item=>item.unitId==="RX_78_5"&&item.rentalUses===10));
  E.receiveDeliveries();
  assert.equal(E.snapshot().storage.deliveries.length,0);
  assert(E.snapshot().storage.units.some(item=>item.unitId==="RX_78_5"&&item.rentalUses===10));
});
test("draws stop above 99 pending units before random selection or payment; ten draws remain atomic", () => {
  const saved=profile(),kitId=load().E.defaultKit("RGM_79");
  saved.storage.deliveries=Array.from({length:99},()=>({unitId:"RGM_79",kitId}));
  const {E,rolls}=load(saved);
  assert.equal(E.supplyStorageStatus().blocked,false);
  for(let i=0;i<10;i++)rolls.push(0,0,0);
  E.drawSupply(pool,10);
  const after=JSON.stringify(E.snapshot());
  assert.equal(E.supplyStorageStatus().count,109);assert.equal(E.supplyStorageStatus().blocked,true);
  assert.throws(()=>E.drawSupply(pool,1),/超过99/);
  assert.throws(()=>E.drawSupply(pool,10),/超过99/);
  assert.equal(JSON.stringify(E.snapshot()),after);
  saved.storage.deliveries.length=98;
  const single=load(saved);single.rolls.push(0,0,0,0,0,0);
  single.E.drawSupply(pool,1);assert.equal(single.E.supplyStorageStatus().count,99);
  single.E.drawSupply(pool,1);assert.equal(single.E.supplyStorageStatus().count,100);
  assert.throws(()=>single.E.drawSupply(pool,1),/超过99/);
});
test("old generic tokens migrate to 0079T1 tokens without duplicating balances or test grants", () => {
  const saved=profile();saved.supplyTestGrant=true;saved.itemInventory={"supply-token":12345};
  const {E,data}=load(saved),next=E.snapshot();
  assert.equal(next.itemInventory["0079t1-token"],12345);
  assert.equal(next.itemInventory["supply-token"],undefined);
  assert.equal(load(next).E.snapshot().itemInventory["0079t1-token"],12345);
  const merged=E.validate({...next,itemInventory:{"supply-token":10,"0079t1-token":20}});
  assert.equal(merged.itemInventory["0079t1-token"],30);
  assert(!data.get(E.key).includes('"supply-token"'));
});
test("explicit S/A/B lists include ships, forms and removed-tree units; C contains no chassis", () => {
  const {E}=load(profile()),grades=E.supplyProducts(pool);
  const expected=[
    ["RX_78_2_ACE","Thoroughbred","BlancRival"],
    ["G_Fighter","RX_78_2_BPart","RX_78_4","RX_78_5","RX_78_6_WIP","MSN_01"],
    ["MS_06F_EFSF","AMS_Squad","MS_05S","EMS_05M","RGM_79G_EarlyDeployment","RGM_79U","RGM_79F","MS_06Z"]];
  for(let i=0;i<3;i++)for(let j=0;j<2;j++){
    const reward=grades[i].rewards[j];
    assert.deepEqual(Array.from(reward.choices),expected[i]);
    if(j===1)assert.equal(reward.uses,10);
    for(let k=0;k<reward.choices.length;k++){
      const draw=load(profile());draw.rolls.push([0,.05,.1][i],j===0?0:.85,(k+.5)/reward.choices.length);
      const result=draw.E.drawSupply(pool,1)[0];
      assert.equal(result.unitId,expected[i][k]);
      assert.equal(draw.E.snapshot().storage.deliveries.at(-1).rentalUses,j===1?10:undefined);
      draw.E.receiveDeliveries();
      const received=draw.E.snapshot().storage;
      assert([...received.units,...received.ships,...received.deliveries].some(item=>item.unitId===result.unitId));
    }
  }
  assert(!grades[3].rewards.some(reward=>["unit","rental","featured"].includes(reward.kind)));
  // Every C bucket must award currency, supplies, tokens or parts, never chassis.
  for(const [subtype,kind] of [[0,"supplies"],[.304879,"money"],[.609757,"item"],[.658537,"plugin"],[.853659,"plugin"],[.95122,"plugin"],[.999999,"plugin"]]){
    const draw=load(profile()),before=draw.E.snapshot();draw.rolls.push(.5,subtype);
    if(kind!=="item")draw.rolls.push(0);
    const result=draw.E.drawSupply(pool,1)[0];
    assert.equal(result.kind,kind);
    assert(!result.unitId);assert.equal(draw.E.snapshot().storage.deliveries.length,before.storage.deliveries.length);
  }
  for(const reward of grades[3].rewards.filter(reward=>reward.kind==="plugin")){
    const parts=require("../shared/unit-plugins.json").filter(part=>part.rarity===reward.rarity&&["UC_0079_T1","UC_0079_T2"].includes(part.era));
    assert(parts.length>0);assert.deepEqual(Array.from(reward.choices),parts.map(part=>part.id));
    const draw=load(profile());draw.rolls.push(.9,{1:.75,2:.9,3:.99}[reward.rarity],.99999);
    assert.equal(draw.E.drawSupply(pool,1)[0].pluginId,parts.at(-1).id);
  }
});

test("all reward probabilities total 100 percent and rental thresholds match the revised table", () => {
  const {E}=load(profile()),grades=E.supplyProducts(pool);
  assert.deepEqual(Array.from(grades,grade=>grade.weight),[3,5,10,82]);
  const expected=[[1.8,1.2],[2.5,2,.5],[6,4],[25,25,4,16,8,4]];
  for(let i=0;i<grades.length;i++)assert.deepEqual(Array.from(grades[i].rewards,r=>r.chance),expected[i]);
  assert.equal(grades.flatMap(g=>g.rewards).reduce((sum,r)=>sum+r.chance,0),100);
  for(const [gradeRoll,threshold]of [[0,.6],[.05,.5],[.1,.6]])for(const delta of [-.000001,.000001]){
    const {E,rolls}=load(profile());rolls.push(gradeRoll,threshold+delta,0);
    assert.equal(E.drawSupply(pool,1)[0].kind,delta<0?"unit":"rental");
  }
});

test("ten draws deduct ten tokens once, preserve full-warehouse rewards, and allow maximum resource amount", () => {
  const {E,rolls} = load(profile());
  const usage = E.storageUsage("units");
  if (usage.slots > usage.count) E.creditActivity({ id: "fill", matchId: "fill", money: 0, supplies: 0, inventory: { RGM_79: usage.slots - usage.count } });
  for(let i=0;i<10;i++) rolls.push(i===0?.999:.01,i===0?.4:0,.999999);
  const before=E.snapshot(),results=E.drawSupply(pool,10),after=E.snapshot();
  assert.equal(results.length,10);assert.equal(after.itemInventory["0079t1-token"],90);
  assert.equal(results[0].quantity,10000);assert.equal(after.money-before.money,10000);
  assert.equal([...after.storage.units,...after.storage.deliveries].length - [...before.storage.units,...before.storage.deliveries].length,9);
  assert.equal(after.storage.deliveries.length - before.storage.deliveries.length,9);
});
test("invalid requests, insufficient tokens and persistence failure leave all rewards and tokens intact", () => {
  const saved=profile();saved.itemInventory["0079t1-token"]=1;
  const {E,rolls,ctx}=load(saved),before=JSON.stringify(E.snapshot());
  assert.throws(()=>E.drawSupply(pool,10),/代币不足/);
  assert.throws(()=>E.drawSupply(pool,2),/次数无效/);
  assert.throws(()=>E.drawSupply("missing",1),/不存在/);
  ctx.Net={started:true};assert.throws(()=>E.drawSupply(pool,1),/战斗中/);ctx.Net.started=false;
  rolls.push(0,0,0);ctx.localStorage.setItem=()=>{throw Error("save failed");};
  assert.throws(()=>E.drawSupply(pool,1),/save failed/);
  assert.equal(JSON.stringify(E.snapshot()),before);
});
test("mixed ten-draw save failure rolls back the entire batch and wallet", () => {
  const {E,rolls,ctx,data}=load(profile()),before=JSON.stringify(E.snapshot()),persisted=data.get(E.key);
  for(let i=0;i<10;i++) { if(i%3===0)rolls.push(.05,.95); else rolls.push(i%2?.01:.9,i%2?0:.85,.5); }
  ctx.localStorage.setItem=()=>{throw Error("save failed");};
  assert.throws(()=>E.drawSupply(pool,10),/save failed/);
  assert.equal(JSON.stringify(E.snapshot()),before);assert.equal(data.get(E.key),persisted);
});
test("existing local saves receive 99999 test tokens exactly once; remote and new saves receive none", () => {
  const location={protocol:"file:",hostname:""},saved=profile();saved.itemInventory={};
  const local=load(saved,{location}).E.snapshot();assert.equal(local.itemInventory["0079t1-token"],99999);
  local.itemInventory["0079t1-token"]--;
  assert.equal(load(local,{location}).E.snapshot().itemInventory["0079t1-token"],99998);
  assert.equal(load(undefined,{location}).E.snapshot().itemInventory["0079t1-token"],undefined);
  assert.equal(load(saved,{location:{protocol:"https:",hostname:"example.com"}}).E.snapshot().supplyTestGrant,undefined);
  for(const value of [-1,1.5,1000001]) assert.throws(()=>load({...saved,itemInventory:{"0079t1-token":value}}).E.validate({...saved,itemInventory:{"0079t1-token":value}}),/道具库存无效/);
});
