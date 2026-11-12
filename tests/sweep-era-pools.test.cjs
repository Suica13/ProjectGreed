const test=require("node:test"),assert=require("node:assert/strict");
const G=require("../shared/rules"),S=require("../shared/sweep-mode"),E=require("../shared/economy");
test("0093 is a selectable separate era; every stage awards only its own era's units",()=>{
  assert(G.eras.includes("0093T1"));
  assert.deepEqual(S.factionsForEra(G,"0093T1"),["EFSF","NEO_ZEON"]);
  for(const era of G.eras)for(const stage of ["battle","elite","boss"]) {
    const room={settings:{...G.defaultRoomSettings(),mode:"sweep",sweepEra:era,sweepFaction:S.factionsForEra(G,era)[0],costLimit:20000},
      seats:[{id:"p",seat:0}],sweep:{depth:4,seed:7319,elite:stage==="elite",boss:stage==="boss",pending:{p:{money:0,supplies:0,technology:0,inventory:{}}}}};
    const pool=S.rewardPool(room,G);
    assert(pool.length,era);
    assert(pool.every(u=>G.models[E.defaultModel(u.id)].tags.includes(era)));
    if(era!=="0093T1")assert(pool.every(u=>!G.models[E.defaultModel(u.id)].tags.includes("0093T1")));
    S.reward(room,G,stage==="boss"?3:stage==="elite"?2:1,stage==="boss"?5:stage==="elite"?3:1);
    assert(Object.keys(room.sweep.pending.p.inventory).every(id=>G.models[E.defaultModel(id)].tags.includes(era)));
  }
});
test("0093 players can bring older licensed stock while enemies use only 0093 units",()=>{
  const ids=["Medea","RGM_79","RMS_179_AEUG","RX_93"];
  const settings={...G.defaultRoomSettings(),mode:"sweep",mapId:null,sweepEra:"0093T1"};
  const player={seat:0,characterFaction:"PMC",inventory:Object.fromEntries(ids.map(id=>[id,5])),licenses:Object.fromEntries(ids.map(id=>[id,true]))};
  const rules=G.armyRestrictions(settings,player);
  for(const id of ids) assert.equal(G.restrictionReason(G.models[E.defaultModel(id)],rules),null,id);
  const oldRules=G.armyRestrictions({...settings,sweepEra:"0087T2"},player);
  assert.equal(G.restrictionReason(G.models[E.defaultModel("RX_93")],oldRules),"not_allowed");
  for(const faction of S.factionsForEra(G,"0093T1"))for(const environment of ["ground","space"]) {
    const room={settings:{...settings,sweepFaction:faction,sweepEnvironment:environment},seats:[player,{seat:1,bot:true,sweepEnemy:true}],sweep:{depth:0}};
    room.settings.mapId=S.mapPool(room,G)[0].id;
    for(const seed of [1,7319,76543]) {
      const army=S.enemies(room,G,seed);
      assert(army.length);
      assert(army.every(e=>G.formationModel(e).tags.includes("0093T1")));
    }
  }
});
