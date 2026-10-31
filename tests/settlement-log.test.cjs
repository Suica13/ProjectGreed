const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createSettlementLog}=require('../tools/settlement-log.cjs');
test('settlement JSON writes atomically, remains readable and deduplicates across writer restarts',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'greed-settlement-'));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const data={matchId:'test-match-1',room:'Room',costLimit:6000,players:[{name:'Player',total:{money:30,supplies:40}}]};
 const write=createSettlementLog({directory,version:'V52',now:()=>1000});write(data);
 const file=path.join(directory,'test-match-1.json'),saved=fs.readFileSync(file,'utf8');
 assert.deepEqual(JSON.parse(saved),{schemaVersion:1,version:'V52',settledAt:new Date(1000).toISOString(),...data});
 createSettlementLog({directory,version:'V53',now:()=>2000})({...data,costLimit:1000});assert.equal(fs.readFileSync(file,'utf8'),saved);
 assert.deepEqual(fs.readdirSync(directory),['test-match-1.json']);
 assert.throws(()=>write({...data,matchId:'../escape'}));
 fs.writeFileSync(file,'invalid');assert.throws(()=>write(data));assert.equal(fs.readFileSync(file,'utf8'),'invalid');
});
