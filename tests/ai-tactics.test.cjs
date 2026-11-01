const test = require("node:test"), assert = require("node:assert/strict");
const G = require("../shared/rules.js"), C = require("../shared/campaign.js");
const A = G.aiTactics, ctx = { G, world: G.catalog.scenarios.earth_0079_mid.world,
  production: require("../shared/production-data.cjs"), development: require("../shared/development.js") };
function battle(ownCount, enemyCount, strategic = true, defender = false) {
  const state = C.create(ctx, [{seat:0},{seat:1}]);
  const mapId = G.catalog.scenarios.earth_0079_mid.regions.canada_east.mapId;
  const formations = Array(10).fill(null);
  formations[0] = [{unitId:"Type61",kitId:"standard"}];
  formations[1] = [{unitId:"Type61",kitId:"standard"}];
  const game = G.create(false, 1, formations, false, {...G.campaignRoomSettings(), mapId});
  const source = game.units[0], ownTeam = defender ? 0 : 1;
  game.units = [];
  for (const [team,count] of [[ownTeam,ownCount],[1-ownTeam,enemyCount]])
    for (let i=0;i<count;i++) game.units.push({...source,id:team+"-"+i,team,ownerSeat:team,
      x:team===ownTeam?10:70,y:20+i});
  game.team = ownTeam;
  if (strategic) game.campaignBattlefield = G.campaignBattlefield.create(G,state,"canada_east");
  return { game, unit:game.units[0] };
}
test("tactical FSM gathers weak attackers, advances at parity and overruns with a large advantage",()=>{
  for(const [a,b,state] of [[1,4,"gather"],[4,4,"advance"],[8,2,"overrun"]]) {
    const {game,unit}=battle(a,b); assert.equal(A.decide(G,game,unit).state,state);
  }
  const {game,unit}=battle(4,4);
  const decision=A.decide(G,game,unit);
  assert.equal(A.decide(G,game,game.units[1]),decision,"one shared decision per AI per phase");
  assert.equal(decision.goal.kind,"outpost","capture along the base approach instead of rushing past posts");
});
test("defenders are conservative and encounter AI never waits for strategic reinforcements",()=>{
  let f=battle(4,4,true,true); assert.equal(A.decide(G,f.game,f.unit).state,"defend");
  f=battle(8,2,true,true); assert.equal(A.decide(G,f.game,f.unit).state,"overrun");
  f=battle(2,8,false); assert.equal(A.decide(G,f.game,f.unit).state,"advance");
});
test("flank groups choose opposite approach sides while easy difficulty keeps a direct approach",()=>{
  const {game,unit}=battle(4,4,false); game.aiOptions=A.settings({difficulty:"hard"});
  for(const actor of game.units) actor.y=20;
  const d=A.decide(G,game,unit); assert.equal(d.state,"flank");
  const top={x:60,y:16},bottom={x:60,y:24};
  assert(A.positionScore(G,game,unit,top,d)>A.positionScore(G,game,unit,bottom,d));
  assert(A.positionScore(G,game,game.units[1],bottom,d)>A.positionScore(G,game,game.units[1],top,d));
  const easy=battle(4,4,false); easy.game.aiOptions=A.settings({difficulty:"easy"});
  assert.equal(A.decide(G,easy.game,easy.unit).state,"advance");
});
test("campaign options validate allowed values, scale starting funds and technology income, and survive archives",()=>{
  const players=[{seat:0},{seat:1}];
  const options={difficulty:"hard",aggression:"low",teams:[{research:1.25,durability:1.25,resources:2},{research:0.75,durability:0.75,resources:0.25}]};
  const state=C.create(ctx,players,{campaignOptions:options});
  assert.equal(state.teams[0].money,ctx.world.settings.startingMoney*2);
  assert.equal(state.teams[1].supplies,ctx.world.settings.startingSupplies*0.25);
  state.units=[];
  const tech=state.teams.map((t)=>t.technology);
  C.advance(ctx,state,players);
  for(const team of [0,1]) {
    const bases=ctx.world.regions.filter((r)=>r.factory&&r.owner===team).length;
    assert.equal(state.teams[team].technology-tech[team],bases*100*options.teams[team].research);
  }
  const imported=C.validate(ctx,JSON.parse(JSON.stringify(state)),players);
  assert.deepEqual(imported.options,A.settings(options));
  assert.throws(()=>A.settings({difficulty:"cheat"}));
  assert.throws(()=>A.settings({teams:[{durability:2},{}]}));
  assert.throws(()=>A.settings({teams:[{resources:100},{}]}));
});
test("durability scaling changes HP only, leaving weapons, movement and AP unchanged",()=>{
  const {unit}=battle(1,1);
  const base=G.modelOf(unit), adjusted=G.modelOf({...unit,campaignDurability:1.25});
  assert.equal(adjusted.hp,Math.ceil(base.hp*1.25));
  assert.equal(adjusted.weapons,base.weapons);
  assert.equal(adjusted.ap,base.ap); assert.equal(adjusted.move,base.move);
});
test("strategic AI uses multiple factories and does not dispatch tiny groups into hostile territory",()=>{
  const players=[{seat:0,bot:true},{seat:1,bot:false}];
  const state=C.create(ctx,players); state.teams[0].money=100000;state.teams[0].supplies=100000;
  for(const unit of state.units.filter((u)=>u.team===0)) unit.ownerSeat=0;
  const units=state.units.filter((u)=>u.team===0), before=units.length;
  C.advance(ctx,state,players);
  assert(new Set(state.orders.filter((o)=>o.team===0).map((o)=>o.region)).size>1 ||
    state.units.filter((u)=>u.team===0).length>before+1);
  assert(state.teams[0].money>=0&&state.teams[0].supplies>=0);
  for(const unit of units) {
    const region=ctx.world.regions.find((r)=>r.id===unit.region);
    if(region.owner!==0) assert(units.filter((u)=>u.region===region.id).length>=4);
  }
});

test("escape and separation successors inherit the team's durability multiplier",()=>{
  const game=G.create(false,1,[[{unitId:"MTank",kitId:"standard"}],[{unitId:"RGM_79",kitId:"beam_spray"}]],false,
    {costLimit:99999,unitCostLimit:10000});
  game.tiles.forEach((row)=>row.fill("plain"));
  const unit=game.units[0];
  Object.assign(unit,{x:10,y:10,campaignDurability:1.25});
  G.useSkill(game,unit,"ExitUnit",11,10);
  for(const actor of game.units.filter((u)=>u.team===0)) {
    assert.equal(actor.campaignDurability,1.25);
    assert.equal(actor.hp,G.modelOf(actor).hp);
  }
});
