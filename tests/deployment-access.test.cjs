const test = require("node:test"),
  assert = require("node:assert/strict"),
  { randomUUID } = require("node:crypto"),
  WebSocket = require("ws"),
  G = require("../shared/rules.js"),
  { createServer } = require("../server.js");
const tank = { unitId: "Type61", kitId: "standard" };
const army = (n) => Array.from({ length: n }, () => ({ ...tank }));
test("one deployment license permits duplicate units and the creation boundary omits unlicensed units", () => {
  const entries = army(3),
    rules = { licenses: { Type61: true }, inventory: {Type61:3}, kits: {Type61__standard:3} };
  assert.equal(G.validateFormation(entries, 99999).length, 3);
  const plan = G.planFormation(entries, 99999, rules);
  assert.deepEqual(plan.indices, [0,1,2]);
  assert.equal(plan.reasons[1], undefined);
  const game = G.create(false, 1, [entries, army(1)], true, {
    costLimit: 99999,
    unitCostLimit: 99999,
    seatFormationRules: [rules, { licenses: { Type61: true }, inventory:{Type61:1}, kits:{Type61__standard:1} }],
  });
  assert.equal(game.units.filter((u) => u.ownerSeat === 0).length, 3);
  assert.deepEqual(
    game.units.filter((u) => u.ownerSeat === 0).map((u) => u.id),
    ["0-0","0-1","0-2"],
  );
  assert.equal(
    G.armyRestrictions(G.defaultRoomSettings(), { seat: 0, bot: true }).licenses,
    undefined,
  );
  assert.deepEqual(G.armyRestrictions(G.defaultRoomSettings(), { seat: 0 }).licenses, {});
  assert.throws(() => G.normalizeLicenses({ fake: 1 }));
});
class Peer {
  static peers = new Set();
  constructor(url) {
    Peer.peers.add(this);
    this.ws = new WebSocket(url);
    this.frames = [];
    this.ws.on("message", (raw) => {
      const m = JSON.parse(raw);
      this.frames.push(m);
      if (m.type === "state") this.state = m;
      if (m.type === "joined") this.joined = m;
    });
  }
  async wait(predicate) {
    const start = Date.now();
    while (Date.now() - start < 5000) {
      const m = this.frames.find(predicate);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw Error("Timeout: " + JSON.stringify(this.frames.at(-1)));
  }
  async join(mode, room, licenses, options = {}) {
    if (this.ws.readyState !== 1) await new Promise((r) => this.ws.once("open", r));
    this.ws.send(
      JSON.stringify({
        type: "hello",
        version: require("../project.json").version,
        mode,
        room,
        characterFaction: "PMC",
        licenses,
        inventory: Object.fromEntries(Object.keys(licenses).map(id => [id, 20])),
        kits: Object.fromEntries(Object.keys(licenses).flatMap(id => G.catalog.prefabs.find(p => p.id === id).weaponKits.map(kit => [id + "__" + kit.id, 20]))),
        name: mode,
        ...options,
      }),
    );
    await this.wait((m) => m.type === "joined");
    await this.wait((m) => m.type === "state");
  }
  async action(action, fields = {}, override = {}) {
    // A different client may receive the broadcast before this peer; wait for the
    // same revision before issuing the next test action instead of racing snapshots.
    const revision = Math.max(0, ...[...Peer.peers]
      .filter(p => p.ws.url === this.ws.url && p.ws.readyState === 1)
      .map(p => p.state?.revision ?? 0));
    if ((this.state?.revision ?? 0) < revision)
      await this.wait(m => m.type === "state" && m.revision >= revision);
    const id = randomUUID();
    this.ws.send(
      JSON.stringify({
        type: "action",
        action,
        id,
        revision: this.state.revision,
        ...fields,
        ...override,
      }),
    );
    return this.wait(
      (m) => m.ack === (override.id || id) || (m.type === "error" && m.id === (override.id || id)),
    );
  }
}
test("real WebSocket ready/assembly/start paths enforce stock and keep licenses private", async (t) => {
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  const a = new Peer(`ws://127.0.0.1:${address.port}/ws`),
    b = new Peer(`ws://127.0.0.1:${address.port}/ws`);
  t.after(async () => {
    a.ws.terminate();
    b.ws.terminate();
    await app.close();
  });
  await a.join("create", "STOCK", { Type61: true }, {inventory:{Type61:2},kits:{Type61__standard:1},technologyPoints:{EFSF:23900,ZEON:123}});
  await b.join("join", "STOCK", { Type61: true });
  let r = await b.action("set_ready", {
    ready: true,
    formation: army(3),
    licenses: { Type61: true },
  });
  assert.equal(r.type, "state");
  r = await a.action("start_game", { formation: army(3), licenses: { Type61: true } });
  assert.equal(r.phase, "assembly");
  const own = r.assembly.players.find((p) => p.memberId === a.joined.memberId);
  assert.equal(own.deployable.length, 1);
  assert.equal(own.reasons[1], "kit_stock");
  assert.equal(own.reasons[2], "kit_stock");
  assert.deepEqual(r.members.find((m) => m.id === a.joined.memberId).licenses, { Type61: true });
  assert.equal(r.members.find((m) => m.id === b.joined.memberId).licenses, undefined);
  const room = app.rooms.get("STOCK"),
    oldLicenses = room.seats[0].licenses;
  const oldStock = G.normalizeStock(room.seats[0]);
  const oldTechnologyPoints = structuredClone(room.seats[0].technologyPoints);
  assert.equal(r.members.find(m => m.id === b.joined.memberId).technologyPoints, undefined);
  r = await a.action("update_formation", {
    formation: [{ unitId: "fake", kitId: "fake" }],
    inventory: {Type61:999}, kits: {Type61__standard:999}, technologyPoints:{EFSF:0},
    licenses: { Type61: true },
  });
  assert.equal(r.type, "error");
  assert.deepEqual(room.seats[0].licenses, oldLicenses);
  assert.deepEqual(G.normalizeStock(room.seats[0]), oldStock);
  r = await a.action("update_formation", {formation: army(3), inventory: {Type61:-1}, kits:{}});
  assert.equal(r.type,"error");
  assert.deepEqual(G.normalizeStock(room.seats[0]), oldStock);
  assert.deepEqual(room.seats[0].technologyPoints, oldTechnologyPoints);
  r = await a.action("update_formation", {formation:army(3),technologyPoints:{EFSF:-1}});
  assert.equal(r.type,"error");
  assert.deepEqual(room.seats[0].technologyPoints, oldTechnologyPoints);
  const requestId = randomUUID();
  r = await a.action("confirm_formation", { licenses: { Type61: true } }, { id: requestId });
  assert.equal(r.type, "state");
  await a.action("confirm_formation", { licenses: { Type61: true } }, { id: requestId });
  assert.equal(room.seats[0].licenses.Type61, true);
  r = await b.action("confirm_formation", { licenses: { Type61: true } });
  assert.equal(r.phase, "deployment");
  assert.equal(room.game.units.filter((u) => u.ownerSeat === 0).length, 1);
  assert.equal(room.seats[0].inventory.Type61, 2);
  assert.equal(room.seats[0].kits.Type61__standard, 1);
  const reserve = r.economyAwards.find(a => a.kind === "deployment");
  assert.deepEqual(reserve.stockUsed, {inventory:{},kits:{}}); // launch does not deduct stock
  const ownDeployment = await a.wait(frame => frame.type === "state" && frame.phase === "deployment" &&
    frame.economyAwards.some(award => award.kind === "deployment"));
  const ownReceipt = ownDeployment.economyAwards.find(a => a.kind === "deployment");
  assert.deepEqual(ownReceipt.stockUsed, {inventory:{},kits:{}});
  assert.equal(a.state.members.find(m => m.id === b.joined.memberId).inventory, undefined);
  assert.equal(room.game.units.filter((u) => u.ownerSeat === 1).length, 3);
  assert.equal(room.technologyStartPoints[a.joined.memberId].EFSF,23900);
  await a.action("sync",{technologyPoints:{EFSF:0}});
  assert.equal(room.technologyStartPoints[a.joined.memberId].EFSF,23900);
});

test("a human may force readiness with zero stock but receives no spawned units", async (t) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const a = new Peer(`ws://127.0.0.1:${address.port}/ws`),
    b = new Peer(`ws://127.0.0.1:${address.port}/ws`);
  t.after(async () => {
    a.ws.terminate();
    b.ws.terminate();
    await app.close();
  });
  await a.join("create", "ZERO", {});
  await b.join("join", "ZERO", { Type61: true });
  let result = await a.action("set_ready", { ready: true, formation: army(1), licenses: {} });
  assert.equal(result.type, "state");
  assert.equal(result.members.find((m) => m.id === a.joined.memberId).ready, true);
  await b.action("set_ready", { ready: true, formation: army(1), licenses: { Type61: true } });
  await a.wait(m => m.type === "state" && m.revision === app.rooms.get("ZERO").revision);
  result = await a.action("start_game", { formation: army(1), licenses: {} });
  assert.equal(result.phase, "assembly");
  await a.action("confirm_formation", { licenses: {} });
  await b.wait(m => m.type === "state" && m.revision === app.rooms.get("ZERO").revision);
  result = await b.action("confirm_formation", { licenses: { Type61: true } });
  assert.equal(result.phase, "deployment");
  const game = app.rooms.get("ZERO").game;
  assert.equal(game.units.filter((u) => u.ownerSeat === 0).length, 0);
  assert.equal(game.units.filter((u) => u.ownerSeat === 1).length, 1);
  assert.equal(game.deployment[0], true);
});

const Development = require('../shared/development.js');
const lockedModel = Object.values(G.models).find(m => !m.wip && m.faction === 'EFSF' &&
  m.movementType !== 'naval' && (m.adaptability?.ground ?? 100) > 0 &&
  !Development.allows('PMC', m.prefabId, {}));
const lockedEntry = {unitId: lockedModel.prefabId, kitId: Object.keys(G.models).find(id => G.models[id] === lockedModel).split('__')[1]};
test('licensed undeveloped units bypass research only, retain faction, cost and tag restrictions', () => {
  const settings = {...G.defaultRoomSettings(), costLimit:99999, unitCostLimit:99999};
  const rules = G.armyRestrictions(settings, {seat:0, characterFaction:'PMC', researched:{}, licenses:{[lockedEntry.unitId]:true}, inventory:{[lockedEntry.unitId]:2}, kits:{[lockedEntry.unitId+"__"+lockedEntry.kitId]:2}});
  assert.equal(G.restrictionReason(lockedModel, rules), null);
  assert.equal(G.planFormation([lockedEntry,lockedEntry],Infinity,rules).reasons[1], undefined);
  assert.equal(G.planFormation([lockedEntry],Infinity,{...rules,licenses:undefined}).deployable.length,1);
  assert.equal(G.restrictionReason(lockedModel,{...rules,licenses:{}}),null);
  assert.equal(G.restrictionReason(lockedModel,{...rules,licenses:{},ownedLicenses:{},ownedStock:{inventory:{},kits:{}},inventory:{},kits:{}}),'not_developed');
  assert.equal(G.restrictionReason(lockedModel,{...rules,characterFaction:'ZEON'}),'faction_mismatch');
  assert.equal(G.restrictionReason(lockedModel,{...rules,unitCostLimit:0}),'cost');
  assert.equal(G.restrictionReason(lockedModel,{...rules,bannedFactions:['EFSF']}),'not_allowed');
});
test('real WebSocket undeveloped licenses survives ready, assembly confirmation and spawning',async t=>{
 const app=createServer({host:'127.0.0.1',port:0}), address=await app.listen();
 const a=new Peer(`ws://127.0.0.1:${address.port}/ws`),b=new Peer(`ws://127.0.0.1:${address.port}/ws`);
 t.after(async()=>{a.ws.terminate();b.ws.terminate();await app.close()});
 const stock={[lockedEntry.unitId]:true},formation=[lockedEntry];
 await a.join('create','LOCKED',stock);await b.join('join','LOCKED',stock);
 let r=await a.action('configure_room',{...G.defaultRoomSettings(),costLimit:99999,unitCostLimit:99999});
 assert.equal(r.type,'state');
 r=await b.action('set_ready',{ready:true,formation,licenses:stock});assert.equal(r.type,'state');
 r=await a.action('start_game',{formation,licenses:stock});assert.equal(r.phase,'assembly');
 assert(r.assembly.players.every(p=>p.deployable.length===1));
 r=await a.action('confirm_formation',{formation,licenses:stock});assert.equal(r.type,'state');
 r=await b.action('confirm_formation',{formation,licenses:stock});assert.equal(r.phase,'deployment');
 assert.equal(app.rooms.get('LOCKED').game.units.filter(u=>G.modelOf(u).prefabId===lockedEntry.unitId).length,2);
});
test("empty formations cannot ready and assembly formations lock only after confirmation", async (t) => {
  const app = createServer({host:"127.0.0.1",port:0});
  const address=await app.listen();
  const a=new Peer("ws://127.0.0.1:"+address.port+"/ws");
  const b=new Peer("ws://127.0.0.1:"+address.port+"/ws");
  t.after(async()=>{ a.ws.terminate();b.ws.terminate();await app.close(); });
  await a.join("create","EMPTYLOCK",{Type61:true});
  await b.join("join","EMPTYLOCK",{Type61:true});
  assert.equal(G.defaultRoomSettings().unitCostLimit,250);
  assert.equal((await b.action("update_formation",{formation:[]})).type,"state");
  assert.equal((await b.action("set_ready",{ready:true,formation:[]})).type,"error");
  assert.equal((await a.action("start_game",{formation:[]})).type,"error");
  assert.equal((await b.action("set_ready",{ready:true,formation:army(1)})).type,"state");
  assert.equal((await b.action("update_formation",{formation:[]})).type,"state");
  assert.equal(app.rooms.get("EMPTYLOCK").seats[1].ready,false);
  await b.action("set_ready",{ready:true,formation:army(1)});
  assert.equal((await a.action("start_game",{formation:army(1)})).phase,"assembly");
  assert.equal((await a.action("update_formation",{formation:army(2)})).type,"state");
  assert.equal(app.rooms.get("EMPTYLOCK").seats[0].formation.length,2);
  assert.equal((await a.action("update_formation",{formation:[]})).type,"state");
  assert.equal((await a.action("confirm_formation",{formation:[]})).type,"error");
  assert.equal((await a.action("update_formation",{formation:army(1)})).type,"state");
  assert.equal((await a.action("confirm_formation")).type,"state");
  assert.equal((await a.action("update_formation",{formation:army(2)})).type,"error");
  assert.equal((await a.action("confirm_formation",{formation:army(2)})).type,"error");
  assert.equal((await b.action("update_formation",{formation:army(2)})).type,"state");
  assert.equal(app.rooms.get("EMPTYLOCK").seats[0].finalReady,true);
  assert.equal((await b.action("confirm_formation")).phase,"deployment");
});
test("AI room technology merges every human and freezes the mirrored stage at start",async(t)=>{
 const D=require("../shared/development.js");
 const app=createServer({host:"127.0.0.1",port:0}), address=await app.listen();
 const a=new Peer("ws://127.0.0.1:"+address.port+"/ws"),b=new Peer("ws://127.0.0.1:"+address.port+"/ws");
 t.after(async()=>{a.ws.terminate();b.ws.terminate();await app.close()});
 await a.join("create","AITECH",{Type61:true});
 await b.join("join","AITECH",{Type61:true});
 assert.equal((await a.action("configure_room",{mapId:"crossroads_2v2",costLimit:1000})).type,"state");
 assert.equal((await a.action("add_ai",{seat:2})).type,"state");
 const ef=D.nodes("EFSF").filter(n=>n.page===0&&n.row==="mid"&&n.column<=3).map(n=>n.id);
 const ze=D.nodes("ZEON").filter(n=>n.page===0&&n.row==="mid"&&n.column<=2).map(n=>n.id);
 const first={EFSF:ef},second={ZEON:ze};
 await b.action("set_ready",{ready:true,formation:army(1),researched:second});
 const result=await a.action("start_game",{formation:army(1),researched:first});
 assert.equal(result.phase,"assembly");
 const room=app.rooms.get("AITECH"), expected=D.aiResearch([first,second]);
 assert.deepEqual(room.aiResearch,expected);
 const bot=room.seats[2];
 assert(bot.formation.length>0);
 assert(bot.formation.every(e=>D.allows(bot.characterFaction,e.unitId,expected)));
 const before=JSON.stringify(room.aiResearch);
 await a.action("confirm_formation",{researched:{EFSF:D.nodes("EFSF").map(n=>n.id)}});
 assert.equal(JSON.stringify(room.aiResearch),before);
 assert(!room.members.get(a.joined.memberId).researched.EFSF.includes("Tech_EFSF_0079_PaleRiderProject"));
});


test("reliable clients receive a receipt first and rejected IDs cannot execute on retry",async(t)=>{
 const app=createServer({host:"127.0.0.1",port:0}),address=await app.listen();
 const a=new Peer("ws://127.0.0.1:"+address.port+"/ws");
 t.after(async()=>{a.ws.terminate();await app.close()});
 await a.join("create","RECEIPTS",{Type61:true},{reliableActions:1});
 const accepted=randomUUID();
 assert.equal((await a.action("update_formation",{formation:army(1)},{id:accepted})).type,"state");
 const receipt=a.frames.findIndex(m=>m.type==="action_receipt"&&m.id===accepted);
 const state=a.frames.findIndex(m=>m.type==="state"&&m.ack===accepted);
 assert(receipt>=0&&receipt<state);
 const rejected=randomUUID();
 assert.equal((await a.action("set_ready",{ready:true,formation:[]},{id:rejected})).type,"error");
 a.frames=a.frames.filter(m=>m.id!==rejected);
 assert.equal((await a.action("set_ready",{ready:true,formation:army(1)},{id:rejected})).type,"error");
 assert.equal(app.rooms.get("RECEIPTS").seats[0].ready,false);
});


test("different players prepare from one revision without rejecting each other",async(t)=>{
 const app=createServer({host:"127.0.0.1",port:0}),address=await app.listen();
 const a=new Peer("ws://127.0.0.1:"+address.port+"/ws"),b=new Peer("ws://127.0.0.1:"+address.port+"/ws");
 t.after(async()=>{a.ws.terminate();b.ws.terminate();await app.close()});
 await a.join("create","PARALLEL",{Type61:true});
 await b.join("join","PARALLEL",{Type61:true});
 const room=app.rooms.get("PARALLEL"),revision=room.revision;
 const fields={ready:true,formation:army(1),phase:room.phase,round:room.game.round,matchId:room.matchId};
 assert.equal((await a.action("set_ready",fields,{revision})).type,"state");
 assert.equal((await b.action("set_ready",fields,{revision})).type,"state");
 const stale=await a.action("configure_room",{mapId:room.settings.mapId,costLimit:1000},{revision});
 assert.equal(stale.code,"STALE");
 const expired=await a.action("set_ready",{...fields,round:fields.round+1},{revision});
 assert.equal(expired.code,"STALE");
});
test("network rotation stays pending until confirm and duplicate preview never rotates twice",async(t)=>{
 const app=createServer({host:'127.0.0.1',port:0}),address=await app.listen();
 const a=new Peer('ws://127.0.0.1:'+address.port+'/ws'),b=new Peer('ws://127.0.0.1:'+address.port+'/ws');
 t.after(async()=>{a.ws.terminate();b.ws.terminate();await app.close()});
 await a.join('create','ROTATE',{Type61:true});await b.join('join','ROTATE',{Type61:true});
 await b.action('set_ready',{ready:true,formation:army(1)});
 await a.action('start_game',{formation:army(1)});
 await a.action('confirm_formation');await b.action('confirm_formation');
 const room=app.rooms.get('ROTATE'),u=room.game.units[0];
 u.model='SalamisClass__standard';room.game.tiles.forEach(r=>r.fill('plain'));
 const anchor=G.deploymentCells(room.game,0).find(c=>G.fits(room.game,u,c.x,c.y,0,false,0));Object.assign(u,anchor,{angle:0});
 assert.equal((await a.action('rotate',{unitId:u.id,direction:1})).type,'state');
 assert.equal(u.angle,0);assert.ok(u.pendingMove);
 assert.equal((await a.action('confirm_deployment')).type,'error');
 assert.equal((await a.action('cancel_move',{unitId:u.id})).type,'state');
 assert.equal(u.angle,0);assert.equal(u.pendingMove,undefined);
 await a.action('rotate',{unitId:u.id,direction:1});
 const confirmed=await a.action('confirm_move',{unitId:u.id});assert.equal(confirmed.type,'state',JSON.stringify(confirmed));assert.equal(u.angle,90);assert.equal(u.moved,false);
 await a.action('confirm_deployment');await b.action('confirm_deployment');
 Object.assign(u,{x:10,y:10});
 const id=randomUUID();
 assert.equal((await a.action('rotate',{unitId:u.id,direction:-1},{id})).type,'state');assert.equal(u.angle,90);
 await a.action('rotate',{unitId:u.id,direction:-1},{id});assert.equal(u.angle,90);
 assert.equal((await a.action('confirm_move',{unitId:u.id})).type,'state');assert.equal(u.angle,0);assert.equal(u.moved,true);
});


test("quick games deploy licensed duplicates and selected kits with zero physical stock, and enforce PMC", async t => {
  const app = createServer({host:"127.0.0.1",port:0}), address = await app.listen();
  const a = new Peer(`ws://127.0.0.1:${address.port}/ws`), b = new Peer(`ws://127.0.0.1:${address.port}/ws`);
  t.after(async()=>{a.ws.terminate(); b.ws.terminate(); await app.close();});
  const permits = {Type61:true,RGM_79:true};
  await a.join("create","PMCZERO",permits,{characterFaction:"EFSF",inventory:{},kits:{}});
  await b.join("join","PMCZERO",permits,{characterFaction:"ZEON",inventory:{},kits:{}});
  assert(app.rooms.get("PMCZERO").seats.every(p=>!p || p.characterFaction === "PMC"));
  let result=await a.action("set_faction",{faction:"ZEON"});
  assert.equal(result.type,"error");
  result=await a.action("configure_room",{...G.defaultRoomSettings(),battleMode:"quick",costLimit:99999,unitCostLimit:99999,unitLimit:72,teamFactions:["EFSF","ZEON"]});
  assert.equal(result.type,"state");
  assert.deepEqual(app.rooms.get("PMCZERO").settings.teamFactions,[null,null]);
  const formation=[...army(3),{unitId:"RGM_79",kitId:"bazooka"}];
  await b.action("set_ready",{ready:true,formation,licenses:permits,inventory:{},kits:{}});
  result=await a.action("start_game",{formation,licenses:permits,inventory:{},kits:{}});
  assert.equal(result.phase,"assembly");
  await a.action("confirm_formation",{formation,licenses:permits,inventory:{},kits:{}});
  result=await b.action("confirm_formation",{formation,licenses:permits,inventory:{},kits:{}});
  assert.equal(result.phase,"deployment");
  const room=app.rooms.get("PMCZERO");
  assert.equal(room.game.units.filter(u=>u.ownerSeat===0).length,4);
  assert(room.game.units.some(u=>u.ownerSeat===0 && u.model==="RGM_79__bazooka"));
  assert.deepEqual(room.seats[0].inventory,{});
  assert.deepEqual(room.seats[0].kits,{});
});

for(const mode of ["regular","quick"]) test("WebSocket pilot policy is host-owned and survives assembly/deployment: "+mode,async t=>{
 const app=createServer({host:"127.0.0.1",port:0}),address=await app.listen();
 const a=new Peer(`ws://127.0.0.1:${address.port}/ws`),b=new Peer(`ws://127.0.0.1:${address.port}/ws`);
 t.after(async()=>{a.ws.terminate();b.ws.terminate();await app.close();});
 await a.join("create","PILOTS",{Type61:true});await b.join("join","PILOTS",{Type61:true});
 let response=await b.action("configure_room",{...G.defaultRoomSettings(),pilotPolicy:"none"});assert.equal(response.type,"error");
 response=await a.action("configure_room",{...G.defaultRoomSettings(),pilotPolicy:"forged"});assert.equal(response.type,"error");
 response=await a.action("configure_room",{...G.defaultRoomSettings(),battleMode:mode,pilotPolicy:"none",costLimit:99999,unitCostLimit:99999});assert.equal(response.type,"state");assert.equal(response.settings.pilotPolicy,"none");
 const custom=G.pilots.createCustom("custom-policy-net","Policy"),ace=G.pilots.createAce(G.pilots.catalog.aces.find(p=>p.price).id);
 const entries=[...army(1),{...tank,customPilot:custom},{...tank,customPilot:ace}];
 await b.action("set_ready",{ready:true,formation:army(1)});
 response=await a.action("start_game",{formation:entries});assert.equal(response.phase,"assembly");
 const plan=response.assembly.players.find(p=>p.memberId===a.joined.memberId);
 assert.equal(plan.reasons[1],"pilot_banned");assert.equal(plan.reasons[2],"pilot_banned");
 await a.action("confirm_formation");response=await b.action("confirm_formation");assert.equal(response.phase,"deployment");
 const own=app.rooms.get("PILOTS").game.units.filter(u=>u.ownerSeat===0);assert.equal(own.length,1);assert(!own[0].pilot.custom);
});

for (const mode of ["regular", "quick"]) test(`unlicensed stock deploys in ${mode} without research and never overdraws the fallback`, () => {
  const stock = {inventory:{[lockedEntry.unitId]:1},kits:{[lockedEntry.unitId+"__"+lockedEntry.kitId]:1}};
  const rules = G.armyRestrictions({...G.defaultRoomSettings(),mode,unitCostLimit:99999},
    {seat:0,characterFaction:"PMC",researched:{},licenses:{},...stock});
  const plan = G.planFormation([lockedEntry,lockedEntry],99999,rules);
  assert.equal(plan.deployable.length,1);
  assert.equal(plan.reasons[1],"stock");
  const banned = G.planFormation([lockedEntry],99999,{...rules,bannedFactions:[lockedModel.faction]});
  assert.equal(banned.deployable.length,0);
});
for (const mode of ["regular", "quick"]) test(`WebSocket ${mode} spawns unresearched inventory without a deployment license`, async t => {
  const app=createServer({host:"127.0.0.1",port:0}),address=await app.listen();
  const a=new Peer(`ws://127.0.0.1:${address.port}/ws`),b=new Peer(`ws://127.0.0.1:${address.port}/ws`);
  t.after(async()=>{a.ws.terminate();b.ws.terminate();await app.close();});
  const stock={inventory:{[lockedEntry.unitId]:1},kits:{[lockedEntry.unitId+"__"+lockedEntry.kitId]:1},researched:{}};
  await a.join("create","STOCKONLY",{},stock);await b.join("join","STOCKONLY",{},stock);
  const formation=[lockedEntry];
  await a.action("configure_room",{...G.defaultRoomSettings(),battleMode:mode,costLimit:99999,unitCostLimit:99999});
  await b.action("set_ready",{ready:true,formation});await a.action("start_game",{formation});
  await a.action("confirm_formation",{formation});const state=await b.action("confirm_formation",{formation});
  assert.equal(state.phase,"deployment");
  assert.equal(app.rooms.get("STOCKONLY").game.units.filter(u=>G.modelOf(u).prefabId===lockedEntry.unitId).length,2);
});


test("MEGA irradiation WebSocket result is authoritative and duplicate requests cannot charge or damage twice", async t => {
  const app=createServer({host:"127.0.0.1",port:0});const address=await app.listen();
  const a=new Peer(`ws://127.0.0.1:${address.port}/ws`), b=new Peer(`ws://127.0.0.1:${address.port}/ws`);
  t.after(async()=>{a.ws.terminate();b.ws.terminate();await app.close();});
  await a.join("create","MEGA",{Type61:true});await b.join("join","MEGA",{Type61:true});
  await b.action("set_ready",{ready:true,formation:army(3)});
  await a.action("start_game",{formation:army(1)});
  await a.action("confirm_formation");await b.action("confirm_formation");
  await a.action("confirm_deployment");await b.action("confirm_deployment");
  const room=app.rooms.get("MEGA"),g=room.game,u=g.units.find(u=>u.ownerSeat===0);
  u.model=Object.keys(G.models).find(id=>G.models[id].prefabId==="MSZ_010");
  Object.assign(u,{x:3,y:8,en:G.modelOf(u).en,acted:false});
  const enemies=g.units.filter(u=>u.ownerSeat===1);
  enemies.forEach((unit,i)=>Object.assign(unit,{x:8,y:8+i,hp:1000000,shield:0}));
  g.tiles.forEach(row=>row.fill("plain"));g.fogMode="disabled";g.team=0;
  const skill=G.unitSkills(u).find(s=>s.type==="irradiation"),en=u.en,id=randomUUID();
  const result=await a.action("skill",{unitId:u.id,skillId:skill.id,x:4,y:8},{id});
  assert.equal(result.type,"state",JSON.stringify(result));assert.equal(result.phase,"playback");
  const effect=result.playback.skillEffect;
  assert.equal(effect.areaWidth,3);assert.equal(effect.to.x-effect.from.x,10);
  assert.deepEqual(new Set(effect.hits.map(hit=>hit.unitId)),new Set(enemies.slice(0,2).map(u=>u.id)));
  assert.equal(u.en,en*.5);
  const state=JSON.stringify(g.units.map(u=>[u.hp,u.en,u.shield]));
  const duplicate=await a.action("skill",{unitId:u.id,skillId:skill.id,x:4,y:8},{id,revision:0});
  assert.equal(duplicate.playback.id,result.playback.id);
  assert.equal(JSON.stringify(g.units.map(u=>[u.hp,u.en,u.shield])),state);
  const other=await b.wait(frame=>frame.type==="state"&&frame.playback?.id===result.playback.id);
  assert.equal(other.playback.skillEffect.areaWidth,3);
});
