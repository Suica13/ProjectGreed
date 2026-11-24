/* Fixed-seed real room census. No combat win-rate simulation. */
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const G=require('../shared/rules'),C=require('../shared/contract-mode'),F=require('../shared/contract-forces');
const {createRoomEngine}=require('../shared/room-engine');

const samples=process.argv.includes('--samples')?Number(process.argv[process.argv.indexOf('--samples')+1]):8;
const reportFile=process.argv.includes('--output')?process.argv[process.argv.indexOf('--output')+1]:'tmp/verification/reports/contract-unit-counts.json';
const scenarios=[['UC_0079_T1','EFSF'],['UC_0079_T1','ZEON'],['UC_0079_T2','EFSF'],['UC_0079_T2','ZEON'],['CE_0071_T1','OMNI'],['CE_0071_T1','ZAFT']];
function fixture(era,faction,difficulty,players,seed){
 let serial=0;const errors=[],clients=Array.from({length:players},()=>({readyState:1}));
 const engine=createRoomEngine({rules:G,randomId:()=>`audit-${++serial}`,randomToken:()=>`token-${++serial}`,randomSeed:()=>seed,aiDelayMs:999999,roomReturnMs:999999,send:(_,m)=>{if(m.type==='error')errors.push(m.message);}});
 try{
  for(let i=0;i<players;i++)engine.join(clients[i],{mode:i?'join':'create',room:'COUNT',roomMode:'sweep',characterFaction:'PMC',inventory:{Medea:5},licenses:{Medea:true},storedUnits:[{id:'stock',unitId:'Medea',kitId:'standard',hp:G.models.Medea__standard.hp,en:G.models.Medea__standard.en}]});
  const room=engine.rooms.get('COUNT'),formation=[{unitId:'Medea',kitId:'standard',stockId:'stock'}];
  const act=(i,action,fields={})=>engine.action(clients[i],{id:`act-${++serial}`,revision:room.revision,round:room.game.round,phase:room.phase,matchId:room.matchId,action,...fields});
  act(0,'configure_room',{...room.settings,sweepEra:era,sweepDifficulty:difficulty,sweepFaction:faction,sweepAlliedFaction:{EFSF:'ZEON',ZEON:'EFSF',OMNI:'ZAFT',ZAFT:'OMNI'}[faction],sweepEnvironment:'ground'});
  for(let i=1;i<players;i++)act(i,'set_ready',{ready:true,formation});
  act(0,'start_game',{formation});for(let i=0;i<players;i++)act(i,'confirm_formation');
  assert.deepEqual(errors,[]);assert.equal(room.phase,'deployment');
  return {room,close:()=>engine.close()};
 }catch(e){engine.close();throw e;}
}
function census(era,faction,n,players,seed){
 const f=fixture(era,faction,n,players,seed),{room}=f,g=room.game;
 try{
  const enemies=g.units.filter(u=>u.team>0&&u.hp>0),mobile=enemies.filter(u=>!u.facility&&!G.modelOf(u).facility);
  const result={initial:mobile.length,facilities:enemies.length-mobile.length,cost:mobile.reduce((s,u)=>s+G.modelOf(u).cost,0),veterans:mobile.filter(u=>u.pilot?.genericGrade==='veteran').length,elites:mobile.filter(u=>u.pilot?.genericGrade==='elite').length,events:g.contract.objectives.map(o=>o.type)};
  const target=Math.round([9,12,18,24,30,36][n-1]*(1+.25*(players-1))/3)*3;
  assert.equal(result.initial,target,`${era} ${faction} N${n} initial count`);
  const before=new Set(g.units.map(u=>u.id));for(const o of g.contract.objectives)o.status='completed';
  for(const u of g.units.filter(u=>u.team===0)){u.deployed=true;u.deploymentStaged=false;}
  g.deployment=g.deployment.map(()=>true);g.team=0;room.phase='idle';g.contract.turn=3;g.contract.lastRound=g.round-1;C.poll(room,G);
  result.patrolWave=g.units.filter(u=>u.team>0&&u.hp>0&&!before.has(u.id)&&!u.facility).length;
  const roaming=()=>g.units.filter(u=>u.team>0&&u.hp>0&&!u.facility&&!u.contractObjectiveId&&!u.contractExtracted);
  const limit=Math.floor(target*1.5);
  // Keep all event troops alive while repeatedly requesting ordinary patrols.
  for(let wave=0;wave<25;wave++){
   g.contract.turn=3;g.contract.lastRound=g.round-1;C.poll(room,G);
   assert(roaming().length<=limit,`${era} ${faction} N${n} roaming cap`);
  }
  result.roamingLimit=limit;result.roamingAtSaturation=roaming().length;
  const deaths=roaming().slice(0,3);for(const u of deaths)u.hp=0;
  const survivors=roaming().length;
  for(let wave=0;wave<8;wave++){g.contract.turn=3;g.contract.lastRound=g.round-1;C.poll(room,G);}
  assert(roaming().length>survivors,'patrol resumes after casualties');
  assert(roaming().length<=limit);return result;
 }finally{f.close();}
}
const mean=a=>Number((a.reduce((s,n)=>s+n,0)/a.length).toFixed(2));
const rows=[];let maps=0;
try{
 for(const [era,faction]of scenarios)for(const players of [1,4])for(let n=era.startsWith('CE')?2:1;n<=6;n++){
  const entries=[];for(let i=0;i<samples;i++){
   const seed=1936384585+i*1979,after=census(era,faction,n,players,seed,false);maps++;
   entries.push({seed,after});
  }
  const a=entries.map(e=>e.after.initial);
  const row={era,faction,players,difficulty:n,samples,initialMean:mean(a),initialMin:Math.min(...a),initialMax:Math.max(...a),patrolWaveMean:mean(entries.map(e=>e.after.patrolWave)),facilityMean:mean(entries.map(e=>e.after.facilities)),initialCostMean:mean(entries.map(e=>e.after.cost)),entries};
  rows.push(row);console.log(`${era} ${faction} ${players}p N${n}: initial ${row.initialMean}, patrol ${row.patrolWaveMean}; cap and replenishment passed`);
 }
 fs.mkdirSync(path.dirname(reportFile),{recursive:true});fs.writeFileSync(reportFile,JSON.stringify({schemaVersion:1,samplesPerScenario:samples,generatedMaps:maps,seeds:Array.from({length:samples},(_,i)=>1936384585+i*1979),scope:'ordinary ground contracts; no armed intervention or contact commissions; initial mobile enemies; event troops excluded from roaming cap; 25 patrol requests and casualty replenishment; no combat simulation',rows},null,2)+'\n');
 console.log(`Saved ${reportFile}; ${maps} generated battlefields.`);
}finally{}
