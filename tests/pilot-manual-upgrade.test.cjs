const test=require('node:test'),assert=require('node:assert/strict'),P=require('../shared/pilots.js');
const fresh=()=>P.createCustom('custom-manual','Manual');
for(const type of ['custom','ace'])test(type+' keeps lifetime XP through promotion, demotion and max level',()=>{
 let p=type==='ace'?P.createAce(require('../shared/pilots.json').aces.find(a=>a.price).id):fresh();
 const before=p,need=P.experienceRequired(p.level,p);
 p=P.gainExperience(p,need+123);
 assert.equal(p.level,before.level);assert.equal(p.experience,need+123);
 assert.deepEqual(p.stats,before.stats);assert.equal(p.points,before.points);assert(P.canUpgrade(p));
 assert.equal(P.upgradeCost(p),type==='ace'?P.aceProfile(p).price.money:1000);
 p=P.upgrade(p);assert.equal(p.level,1);assert.equal(p.experience,need+123);
 assert.equal(p.points,type==='ace'?0:120);assert(!P.canUpgrade(p));
 assert.deepEqual(P.custom(p),p);if(type==='ace')assert.notDeepEqual(p.stats,before.stats);
 const down=P.demote(p);assert.equal(down.level,0);assert.equal(down.experience,p.experience);
 assert.deepEqual(down.stats,before.stats);assert(P.canUpgrade(down));
 while(p.level<P.maxLevel(p)){
  const xp=Math.max(0,P.experienceRequired(p.level,p)-p.experience);
  p=P.upgrade(P.gainExperience(p,xp));
 }
 assert(!P.canUpgrade(p));assert.equal(P.upgradeCost(p),0);
 assert.equal(P.gainExperience(p,9999).experience,p.experience+9999);
});
test('custom cumulative gates, stage prices and refund of training and skill on demotion',()=>{
 let p=fresh();assert.equal(P.customRecruitmentCost,1000);
 assert.deepEqual(Array.from({length:10},(_,i)=>P.experienceRequired(i)),[1000,3000,6000,10000,15000,21000,28000,36000,45000,55000]);
 for(let level=0;level<10;level++)assert.equal(P.demotionCost({...p,level:level+1}),P.upgradeCost({...p,level})/2);
 assert.equal(P.upgradeCost({...p,level:9}),50000);
 p=P.custom({...p,level:7,experience:40000,stats:{...p.stats,shooting:170},selectedSkillId:P.skillChoices[0].id});
 const down=P.demote(p);assert.equal(down.level,6);assert.equal(down.points,320);
 assert.deepEqual(down.stats,P.baseStats());assert(!down.selectedSkillId);assert.equal(down.experience,40000);
 assert.throws(()=>P.demote(fresh()));assert(!P.canUpgrade({...p,needsRecruitment:true}));
 assert.throws(()=>P.gainExperience(p,Number.MAX_SAFE_INTEGER+1));
});
test('ACE promotion and demotion always charge full recruitment funds at every level',()=>{
 for(const a of require('../shared/pilots.json').aces.filter(a=>a.price)){
  const p=P.createAce(a.id);
  for(let level=0;level<a.maxLevel;level++)assert.equal(P.upgradeCost({...p,level}),a.price.money);
  for(let level=1;level<=a.maxLevel;level++)assert.equal(P.demotionCost({...p,level}),a.price.money);
 }
});
test('legacy XP migrates once, including capped pilots, without losing history',()=>{
 const old={...fresh(),level:2,experience:400};delete old.experienceVersion;
 const migrated=P.custom(old);assert.equal(migrated.experience,3400);assert.deepEqual(P.custom(migrated),migrated);
 old.level=10;old.experience=0;assert.equal(P.custom(old).experience,1023000);
 const src=require('../shared/pilots.json').aces.find(a=>a.price);
 const ace={...P.createAce(src.id),level:2,stats:undefined,experience:123};delete ace.experienceVersion;
 assert.equal(P.custom(ace).experience,6123);
});
