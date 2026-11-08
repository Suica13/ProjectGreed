const test=require('node:test');
const assert=require('node:assert/strict');
const G=require('../shared/rules.js');
const M=require('../shared/map-document.js');
const tree=require('../shared/development-tree.json');
const B=G.battlefieldMode;
test('six seats per team reserve the first for faction AI and admit only five PMC commanders',t=>{
  const {createRoomEngine}=require('../shared/room-engine');
  let next=0;
  const engine=createRoomEngine({rules:G,send:()=>{},randomId:()=>"v102-"+(++next),randomToken:()=>"token-"+(++next),randomSeed:()=>7319,aiDelayMs:999999});
  t.after(()=>engine.close());
  const connections=[];
  for(let i=0;i<11;i++){
    const ws={readyState:1};connections.push(ws);
    engine.join(ws,{mode:i?'join':'create',room:'BFV102',roomMode:'battlefield',characterFaction:'PMC'});
  }
  const room=engine.rooms.get('BFV102');
  assert.equal(room.seats.length,12);
  assert(room.seats[0].battlefieldAI&&room.seats[1].battlefieldAI);
  for(const team of [0,1])assert.equal(room.seats.filter(p=>p&&!p.bot&&p.seat%2===team).length,5);
  assert.equal(connections[10].seat,null);
});
test('0087 T2 entry technology uses the retained native 10800 points in all three trees',()=>{
  for(const faction of ['AEUG','TITANS','NEO_ZEON']){
    const node=tree[faction].find(n=>n.era==='0087T2');
    assert.equal(node.points,10800);assert.equal(node.points,node.sourceCosts.points);
    assert.equal(node.temporaryPointOverride,undefined);
  }
});
test('every 0087 faction has era-appropriate advancing waves and no later-era leakage',()=>{
  for(const faction of ['AEUG','TITANS','NEO_ZEON'])for(const era of ['0087T1','0087T2'])for(const round of [1,10,51]){
    const selection={faction,era};B.teams(G,[selection,selection]);
    const wave=B.wavePlan(G,selection,round,1,()=>0);
    assert(wave.length>=12);
    for(const entry of wave){
      const model=G.models[entry.unitId+'__'+entry.kitId];
      assert((model.availableFactions||[model.faction]).includes(faction),entry.unitId);
      assert(!model.formOnly&&!model.disabled&&!model.requiredPilotId,entry.unitId);
      if(era==='0087T1'||round<10)assert(!model.tags.includes('0087T2'),entry.unitId);
    }
  }
});
test('three battlefield maps provide compact shared 6v6 staging and connected two-cell routes',()=>{
  const maps=Object.values(G.catalog.maps).filter(map=>map.battlefield);
  assert.equal(maps.length,3);
  for(const map of maps){
    assert.equal(map.playersPerTeam,6);assert.equal(map.spawns.length,12);
    assert.deepEqual(M.gameIssues(M.importMap(map)),[]);
    for(const team of [0,1]){
      const spawns=map.spawns.filter(s=>s.team===team);
      assert(new Set(spawns.map(s=>s.x)).size>1);assert(new Set(spawns.map(s=>s.y)).size>1);
      const areas=map.deploymentAreas.filter((a,index)=>map.spawns[index].team===team);
      assert.equal(new Set(areas.map(JSON.stringify)).size,1);
    }
    const fits=(x,y)=>[0,1].every(dy=>[0,1].every(dx=>['plain','highland','rubble','forest'].includes(map.tiles[y+dy]?.[x+dx])));
    const bases=map.battlefield.facilities.filter(f=>f.type==='base');
    const queue=[[bases[0].x,bases[0].y]],seen=new Set([queue[0].join(',')]);
    for(let i=0;i<queue.length;i++)for(const [dx,dy] of [[0,1],[1,0],[0,-1],[-1,0]]){
      const x=queue[i][0]+dx,y=queue[i][1]+dy,key=x+','+y;
      if(!seen.has(key)&&fits(x,y)){seen.add(key);queue.push([x,y]);}
    }
    for(const site of [...bases,...map.battlefield.points])assert(seen.has(site.x+','+site.y),map.id+'/'+site.id);
    const armies=Array(12).fill(null);armies[10]=[{unitId:'Type61',kitId:'standard'}];armies[11]=[{unitId:'Type61',kitId:'standard'}];
    const game=G.create(false,7319,armies,false,{mode:'battlefield',mapId:map.id});
    assert(game.units.some(u=>G.ownerOf(u)===10));assert(game.units.some(u=>G.ownerOf(u)===11));
  }
});
test('map editor defaults use shared two-dimensional staging up to six seats without larger maps',()=>{
  const doc=M.create({playersPerTeam:6});
  assert.deepEqual(M.gameIssues(doc),[]);assert.equal(doc.width,48);assert.equal(doc.height,32);
  assert.equal(new Set(doc.spawns.filter(s=>s.team===0).map(s=>s.x)).size,3);
  assert.equal(new Set(doc.spawns.filter(s=>s.team===0).map(s=>s.y)).size,2);
  M.setPlayers(doc,2,1);assert.deepEqual(M.gameIssues(doc),[]);
  assert.throws(()=>M.setPlayers(doc,2,7));
});
