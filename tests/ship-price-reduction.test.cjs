const test=require('node:test'),assert=require('node:assert/strict');
const G=require('../shared/rules.js'),production=require('../shared/production-data.cjs');
const report=require('../docs/imports/reports/ship-price-reduction.json');
test('all ship hulls receive the 25 percent COST and production-price reduction with standard rounding',()=>{
 assert.equal(report.units.length,62);
 for(const row of report.units){
  const p=G.catalog.prefabs.find(p=>p.id===row.id);assert(p.stats.ship);
  assert.equal(p.stats.cost,Math.round(row.previousCost*.75/25)*25,row.id);
  if(!row.previousPrice)continue;
  const price=production.licenseOffers[row.id];
  for(const key of ['money','supplies'])assert.equal(price[key],Math.round(row.previousPrice[key]*.75),row.id+'/'+key);
 }
});
test('air transports and named UC/CE space transports retain their old COST and prices',()=>{
 assert(report.excluded.some(p=>p.id==='VTOLTransport'));
 for(const row of report.excluded){
  const p=G.catalog.prefabs.find(p=>p.id===row.id);assert.equal(p.stats.cost,row.cost,row.id);
  const price=production.licenseOffers[row.id]||null;
  assert.deepEqual(price&&{money:price.money,supplies:price.supplies},row.price&&{money:row.price.money,supplies:row.price.supplies},row.id);
 }
});
