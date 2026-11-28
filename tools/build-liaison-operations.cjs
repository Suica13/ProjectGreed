/* Reproducible liaison operations: reward delivery remains on the contact task. */
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),M=require('../shared/map-document'),B=require('./rebuild-biome-maps.cjs'),G=require('../shared/rules'),C=require('../shared/contact-tasks');
const ids=['efsf-13','efsf-15','efsf-16','zeon-12','zeon-14','zeon-18','zeon-22','zeon-25'];
const scenarioSettings={'efsf-13':{costLimit:6000},'efsf-15':{costLimit:6000},'efsf-16':{costLimit:12000},'zeon-12':{costLimit:12000},'zeon-14':{costLimit:15000},'zeon-18':{costLimit:21000,genericPilot:'veteran'},'zeon-22':{costLimit:15000},'zeon-25':{costLimit:27000,genericPilot:'veteran'}};
for(const id of ids){
 const task=C.byId.get(id),zeon=task.contactId==='zeon',space=id==='zeon-25',city=['efsf-13','efsf-15'].includes(id),recon=id==='efsf-16',salvage=id==='zeon-12',coastal=['zeon-12','zeon-14'].includes(id);
 const width=city?56:48,height=city?48:40,location=city?(id==='efsf-13'?'马卡丹':'马卡丹中心区'):recon?'战区59':task.name;
 const doc=M.create({id:task.missionId,name:location+' · '+task.name,width,height,environment:space?'space':'ground',supportedModes:['mission'],playersPerTeam:5,description:task.objectiveText});
 const weather=coastal?'overcast':recon?'blizzard':'snow';
 doc.climate={hemisphere:'north',weather:{allowed:[weather],weights:{[weather]:1},fixed:true},time:{allowed:['noon'],fixed:true}};
 doc.spawns=Array.from({length:10},(_,i)=>({team:i%2,position:Math.floor(i/2)+1,x:(i%2?width-11:3)+(Math.floor(i/2)%3)*3,y:height-9+Math.floor(Math.floor(i/2)/3)*3}));
 doc.deploymentAreas=doc.spawns.map(s=>s.team?{x:width-13,y:height-12,width:12,height:11}:{x:1,y:height-12,width:12,height:11});
 const extraction={x:0,y:height-12,width:14,height:12};
 const commission={kind:recon?'recon':salvage?'retrieve':'command',label:task.objectiveText,...(recon||salvage||task.requiresExtraction?{extraction}:{}),...(recon||salvage?{nodes:[]}:{} )};
 const m={version:1,era:'UC_0079_T1',contactTask:id,commission,noRewards:true,technologyLimitEnabled:false,technologyLimit:0,scenarioFaction:zeon?'ZEON':'EFSF',costLimit:scenarioSettings[id].costLimit,unitLimit:36,fleetLimit:5,enemyResourcePerPlayer:.25,rewards:{technology:0,money:0,supplies:0,inventory:{}},victory:{type:'commission'},protect:[],actors:[],events:[]};
 const positions=[];
 for(let y=5;y<height-15;y+=5)for(let x=16;x<width-3;x+=5)positions.push({x,y});
 function actor(actorId,unitId,pos,team=1,initial=true,group='targets',extra={}){
  const model=Object.values(G.models).find(v=>v.prefabId===unitId);if(!model)throw Error(unitId);
  m.actors.push({id:actorId,unitId,kitId:model.kitId,...pos,team,initial,group,angle:team?180:0,...(team===0?{autonomous:true}:{}),...extra});return actorId;
 }
 const total=city?(id==='efsf-13'?50:10):recon?12:salvage?12:task.targetCount||12;
 const batch=city&&total===50?10:Math.ceil(total/2);
 for(let i=0;i<total;i++){
  const wave=Math.floor(i/batch),pos=positions[i%batch];
  const unitId=city?(i%5===0?'MS_07B':'MS_06F'):recon?['MS_06F2','MS_09','MS_14A'][i%3]:salvage?'RGM_79':task.targetUnit||'RGM_79D';
  actor('enemy-'+i,unitId,pos,1,wave===0,recon||salvage?'guards':'targets',{...(scenarioSettings[id].genericPilot?{genericPilot:scenarioSettings[id].genericPilot}:{})});
 }
 if(recon){
  for(let i=0;i<16;i++){
   const pos={x:17+(i%4)*8,y:4+Math.floor(i/4)*6};
   const actorId=actor('turret-'+i,['Facility_Cannon','Facility_MG','Facility_Beam','Facility_Missile'][i%4],pos,1,true,'defenses',{stationary:true,facilityLevel:2});
   if(i<5)commission.nodes.push({id:'scan-'+i,actor:actorId,...pos,label:'固定炮台 '+(i+1)});
  }
 }
 if(salvage)commission.nodes.push({id:'records',x:width-7,y:5,label:'试验记录'});
 if(space){
  for(let i=0;i<3;i++)actor('enemy-ship-'+i,i?'SalamisClassLateType':'MagellanClassLateType',{x:25+i*7,y:3},1,true,'targets');
  for(let i=0;i<2;i++)actor('allied-ship-'+i,i?'PapuaClass':'MusaiClassLateType',{x:6+i*8,y:height-16},0,true,'allies');
 }
 for(let i=0;i<3;i++)actor('ally-'+i,zeon?(space?'MS_06F2':'MS_06J'):'RGM_79',{x:10+i*2,y:height-14},0,i===0,'allies');
 const briefing=city?'城区道路仍然完整，居民区保持秩序。沿主干道推进，吉翁巡逻队正在向这里集结。':recon?'暴雪正在覆盖平原。保持无线电联络，确认标记炮台的位置再撤回，不要提前摧毁侦察目标。':salvage?'试验记录就在沿岸打捞站。掩护回收队接近目标，拿到资料后沿海岸通道撤回。':space?'联邦截击队接近集结宙域。各舰保持掩护，打开南侧撤离通道！':coastal?'沿岸巡逻队封锁了运输通道。清除目标部队，接应后方运输队。':'敌军封锁了前方道路。沿雪线推进，清除指定阻击部队，后续小队将从侧翼支援。';
 m.events.push({id:'briefing',name:'作战简报',when:{type:'start'},actions:[{type:'dialogue',lines:[{actor:'ally-0',name:zeon?'吉翁前线指挥部':'联邦前线指挥部',text:briefing}]},{type:'message',text:task.rulesText||task.objectiveText}]});
 for(let wave=1;wave<Math.ceil(total/batch);wave++){
  const actors=m.actors.filter(a=>a.id.startsWith('enemy-')&&Number(a.id.slice(6))>=wave*batch&&Number(a.id.slice(6))<(wave+1)*batch).map(a=>a.id);
  m.events.push({id:'enemy-support-'+wave,name:'敌军增援 '+wave,when:{type:'round',round:2+wave*2},actions:[{type:'spawn',actors},{type:'dialogue',lines:[{actor:'ally-0',name:'前线通讯',text:city?'街区北侧出现新的敌军识别信号！巡逻队正在增援，注意交叉路口。':'敌军后备队进入战区，保持队形，别让他们切断退路。'}]}]});
 }
 m.events.push({id:'allied-support',name:'友军接应',when:{type:'round',round:4},actions:[{type:'spawn',actors:['ally-1','ally-2']},{type:'message',text:'接应小队已抵达，由前线指挥部独立指挥。'}]});
 doc.mission=m;let map=M.compile(doc);map.appearance={biome:space?'space':coastal?'wetland':'arctic',colors:{}};
 for(let y=0;y<height;y++)for(let x=0;x<width;x++)map.tiles[y][x]=space?'plain':city?(x%6<2||y%6<2?'road':(x*31+y*17)%191===0?'rubble':'residential'):(x*31+y*17)%257===0?'rubble':y===height-14&&x<24?'road':'plain';
 if(coastal)for(let y=0;y<height-12;y++)for(let x=width-9;x<width;x++)map.tiles[y][x]='water';
 for(const node of commission.nodes||[])if(!node.actor)for(let x=width-11;x<=node.x;x++)map.tiles[node.y][x]='plain';
 for(const a of m.actors)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++)if(map.tiles[a.y+dy]?.[a.x+dx])map.tiles[a.y+dy][a.x+dx]='plain';
 for(const r of map.deploymentAreas)for(let y=r.y;y<r.y+r.height;y++)for(let x=r.x;x<r.x+r.width;x++)map.tiles[y][x]='plain';
 map=B.rebuild(map);map.climate=doc.climate;map.tileMap.climate=doc.climate;
 if(city){
  const zlib=require('node:zlib');
  const rgba=Buffer.alloc(64*64*4);
  function rect(x,y,w,h,color){for(let yy=y;yy<y+h;yy++)for(let xx=x;xx<x+w;xx++){const i=(yy*64+xx)*4;rgba.set([...color,255],i);}}
  rect(8,14,48,44,[56,69,80]);rect(5,6,48,44,[136,154,166]);rect(5,6,48,8,[220,232,237]);rect(5,6,8,44,[220,232,237]);rect(17,18,30,26,[98,117,129]);
  for(const x of [20,33])for(const y of [24,33])rect(x,y,7,3,[207,223,235]);
  function chunk(type,data){const content=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;for(const v of content){crc^=v;for(let b=0;b<8;b++)crc=crc>>>1^((crc&1)?0xedb88320:0);}const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);content.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;}
  const header=Buffer.alloc(13);header.writeUInt32BE(64,0);header.writeUInt32BE(64,4);header[8]=8;header[9]=6;
  const scan=Buffer.alloc(64*257);for(let y=0;y<64;y++)rgba.copy(scan,y*257+1,y*256,(y+1)*256);
  const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(scan)),chunk('IEND',Buffer.alloc(0))]);
  const d=map.tileMap;d.tilesets.push({id:'makadan_houses',name:'马卡丹完整雪顶建筑',image:'data:image/png;base64,'+png.toString('base64'),width:64,height:64,tileWidth:64,tileHeight:64,margin:0,spacing:0});
  d.tiles.push({id:'makadan_house',name:'完整住宅',terrain:'residential',environment:'ground',color:'#889aa6',tilesetId:'makadan_houses',x:0,y:0,frameWidth:64,frameHeight:64,decorative:true,dynamic:false});
  d.layers.push({id:'makadan_buildings',name:'密集完整城区',type:'tile',placement:'below',decorative:true,dynamic:false,visible:true,opacity:1,data:map.tiles.flat().map(t=>t==='residential'?'makadan_house':null)});
 }
 // Preserve authored regular streets and sparse abandoned roads, not the generic cross-map road.
 const roadLayer=map.tileMap.layers[3],roadTile=map.tileMap.tiles.find(t=>t.biomeRole==='road');
 if(roadTile){
  roadLayer.data=map.tiles.flat().map((t,i)=>{
   if(t!=='road')return null;
   const x=i%width,y=Math.floor(i/width);let mask=0;
   [[0,-1],[1,0],[0,1],[-1,0]].forEach(([dx,dy],j)=>{if(map.tiles[y+dy]?.[x+dx]==='road')mask|=1<<j;});
   const id='authored_road_'+mask;
   if(!map.tileMap.tiles.some(t=>t.id===id))map.tileMap.tiles.push({...roadTile,id,mask});
   return id;
  });
 }
 map.mission=m;map.tileMap.mission=m;M.validate(map.tileMap);require('../shared/mission-mode').validate(m,map,G);
 fs.writeFileSync(path.join(root,'assets/maps/missions',id.replace('-','_')+'.json'),JSON.stringify(map,null,2)+'\n');
}
const catalogFile=path.join(root,'assets/unit-catalog.json'),catalog=JSON.parse(fs.readFileSync(catalogFile));
for(const id of ids){const ref='maps/missions/'+id.replace('-','_')+'.json';if(!catalog.maps.includes(ref))catalog.maps.push(ref);}
fs.writeFileSync(catalogFile,JSON.stringify(catalog,null,2)+'\n');
console.log('Built '+ids.length+' liaison operations.');
