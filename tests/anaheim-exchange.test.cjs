const test = require('node:test'), assert = require('node:assert/strict');
const vm = require('node:vm'), fs = require('node:fs'), path = require('node:path');
const G = require('../shared/rules');
function load(saved) {
  const data = new Map(saved ? [['projectgreed.economy.v1', require('../shared/save-codec').stringify(saved)]] : []);
  let failing = false;
  const context = vm.createContext({
    require: require('node:module').createRequire(path.resolve('shared/economy.js')),
    module: { exports: {} }, structuredClone, ART: G.catalog,
    localStorage: { getItem: k => data.get(k) ?? null, removeItem: k => data.delete(k),
      setItem: (k,v) => { if (failing) throw Error('write failed'); data.set(k,v); } },
  });
  vm.runInContext(fs.readFileSync('shared/economy.js','utf8'), context);
  context.module.exports.transact({});
  return { E: context.module.exports, data, fail: () => { failing = true; } };
}
test('Anaheim exchanges 1 supply for 2 funds in either direction without round-trip profit', () => {
  const { E } = load(), before = E.snapshot();
  assert.equal(E.exchangeResources('anaheim','supplies',100),true);
  assert.equal(E.snapshot().supplies,before.supplies-100);
  assert.equal(E.snapshot().money,before.money+200);
  assert.equal(E.exchangeResources('anaheim','money',100),true);
  assert.equal(JSON.stringify(E.snapshot()),JSON.stringify(before));
  E.exchangeResources('anaheim','money',123);
  assert.equal(JSON.stringify(load(E.snapshot()).E.snapshot()),JSON.stringify(E.snapshot()));
});
test('invalid merchants, amounts, insufficient balances and overflow never mutate the wallet', () => {
  const { E } = load(), before = JSON.stringify(E.snapshot());
  for (const n of [0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,'10'])
    assert.throws(() => E.exchangeResources('anaheim','supplies',n));
  for (const merchant of ['zeon','efsf','fake'])
    assert.throws(() => E.exchangeResources(merchant,'supplies',1));
  assert.throws(() => E.exchangeResources('anaheim','technology',1));
  assert.equal(E.exchangeResources('anaheim','money',E.snapshot().money+1),false);
  assert.equal(JSON.stringify(E.snapshot()),before);
  const full = load({...E.snapshot(), money:Number.MAX_SAFE_INTEGER}).E;
  assert.throws(() => full.exchangeResources('anaheim','supplies',1),/上限/);
});
test('failed exchange save keeps both memory and persisted resources intact', () => {
  const { E, data, fail } = load();
  E.exchangeResources('anaheim','supplies',1);
  const before = JSON.stringify(E.snapshot()), persisted = data.get(E.key);
  fail();
  assert.throws(() => E.exchangeResources('anaheim','money',10),/write failed/);
  assert.equal(JSON.stringify(E.snapshot()),before);
  assert.equal(data.get(E.key),persisted);
});
test('light armor GM and early GM striker models all belong to 0079 T1', () => {
  for (const id of ['RGM_79L','RGM_79G_EarlyDeployment']) {
    const models = Object.values(G.models).filter(model => model.prefabId === id);
    assert(models.length);
    for (const model of models) {
      assert(model.tags.includes('UC_0079_T1'));
      assert(!model.tags.includes('UC_0079_T2'));
      assert.equal(model.technologyWeight,1);
    }
  }
});
