const {test}=require('node:test'),assert=require('node:assert/strict');
const B=require('../shared/base-facilities.js');
test('level one provides twenty unit slots, four ship slots and ten pilots per category',()=>{
 const s=B.initial();assert.deepEqual(B.capacity(s),{units:20,ships:4});assert.equal(B.pilotLimit(s),10);
 assert(B.canRecruit(s,'general'));for(const grade of ['veteran','elite','ace','enhanced'])assert(!B.canRecruit(s,grade));
});
test('each factory level increases actual slots rather than display pages',()=>{
 for(let n=1;n<=5;n++) {const s=B.initial();Object.assign(s.levels,{hq:n,factory:n,giantFactory:n,academy:n,beacon:Math.min(n,3)});
 const normalized=B.normalize(s);assert.deepEqual(B.capacity(normalized),{units:10*(n+1),ships:4*n});assert.equal(B.pilotLimit(normalized),10*n);}
});
test('legacy warehouse capacity survives replacing the facilities map',()=>{
 const s=B.normalize({version:1,buildings:[],deployments:[]},{pages:{units:3,ships:3}});
 assert.deepEqual(B.capacity(s),{units:30,ships:12});assert.equal(s.levels.hq,3);assert(!('buildings' in s));assert(!('deployments' in s));
});
test('HQ caps facility levels and beacon gates recruitment',()=>{
 const s=B.initial();s.levels.factory=2;assert.throws(()=>B.normalize(s));s.levels.hq=3;s.levels.beacon=2;
 assert(B.canRecruit(B.normalize(s),'ace'));assert(!B.canRecruit(s,'enhanced'));s.levels.beacon=3;assert(!B.canRecruit(s,'enhanced'));
 s.levels.factory=6;assert.throws(()=>B.normalize(s));
});
test('upgrades are development placeholders with no payable price or mutation',()=>{
 const s=B.initial(),before=JSON.stringify(s),offer=B.upgradeOffer(s,'factory');
 assert.equal(offer.condition,'开发中');assert.equal(offer.money,null);assert.equal(offer.supplies,null);assert.equal(offer.available,false);assert(offer.hqRequired);assert.equal(JSON.stringify(s),before);
});
