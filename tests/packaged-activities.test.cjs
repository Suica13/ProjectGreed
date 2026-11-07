const test=require("node:test"), assert=require("node:assert/strict"), fs=require("node:fs"),
  os=require("node:os"), path=require("node:path"), {execFileSync}=require("node:child_process");
const {exportDefaults}=require("../tools/export-default-activities.cjs"),
  {createActivityService}=require("../tools/server-activities.cjs"), rules=require("../shared/rules.js");
test("package defaults export current definitions, reset progress and preserve existing servers",t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"greed-default-activities-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const source={schemaVersion:2,serverId:"private-server",players:{private:{secretHash:"secret"}},
    activities:[{id:"custom",mode:"cumulative_kill_cost",title:"Custom",enabled:true,targetCost:100,
      progressCost:88,participants:{private:true},killReceipts:{receipt:1},
      rewards:{money:42,unitStock:{Type61:5}},stockConfigurations:{Type61:{kitId:"Type61__standard",extraKits:{Type61__standard:2}}}}]};
  const input=path.join(dir,"source.json"), defaultsPath=path.join(dir,"defaults.json"), storePath=path.join(dir,"activities.json");
  fs.writeFileSync(input,JSON.stringify(source));
  const bytes=execFileSync(process.execPath,["tools/export-default-activities.cjs",input]);
  fs.writeFileSync(defaultsPath,bytes);
  const exported=JSON.parse(bytes);
  assert.deepEqual(exported,exportDefaults(source));
  assert.deepEqual(exported.activities[0].rewards,source.activities[0].rewards);
  assert.deepEqual(exported.activities[0].stockConfigurations,source.activities[0].stockConfigurations);
  assert(!bytes.includes("secret") && !bytes.includes("private") && !bytes.includes("receipt"));
  const options={rules,send:()=>{},defaultsPath,storePath};
  createActivityService(options);
  const state=JSON.parse(fs.readFileSync(storePath));
  assert.notEqual(state.serverId,source.serverId);assert.deepEqual(state.players,{});
  assert.equal(state.activities.length,1);assert.equal(state.activities[0].progressCost,0);
  assert.deepEqual(state.activities[0].participants,{});assert.deepEqual(state.activities[0].killReceipts,{});
  state.activities[0].rewards.money=99;state.activities[0].progressCost=55;
  fs.writeFileSync(storePath,JSON.stringify(state));
  createActivityService(options);
  assert.deepEqual(JSON.parse(fs.readFileSync(storePath)),state);
});
test("empty packaged activities stay empty and malformed sources stop export",t=>{
  assert.throws(()=>exportDefaults({schemaVersion:2}),/Invalid/);
  assert.throws(()=>exportDefaults({schemaVersion:2,activities:[{id:"a"},{id:"a"}]}),/duplicate/);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"greed-empty-activities-"));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const defaultsPath=path.join(dir,"defaults.json"),storePath=path.join(dir,"activities.json");
  fs.writeFileSync(defaultsPath,JSON.stringify(exportDefaults({schemaVersion:2,activities:[]})));
  createActivityService({rules,send:()=>{},storePath,defaultsPath});
  assert.deepEqual(JSON.parse(fs.readFileSync(storePath)).activities,[]);
});
