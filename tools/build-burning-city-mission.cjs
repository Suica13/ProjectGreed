/* [0087][SDGO] A co-op hunt with autonomous AEUG allies and escaping targets. */
const fs=require('node:fs'),path=require('node:path');
const M=require('../shared/map-document'),NativeCity=require('./hong-kong-terrain.cjs');
const root=path.resolve(__dirname,'..'),size=45;
const doc=M.create({id:'mission_burning_city',name:'[0087][原创]燃烧的新都市-AEUG',
  description:'在燃烧的九龙街区消灭三台精神感应高达。目标若撤离，改为歼灭剩余敌军。',
  width:size,height:size,playersPerTeam:5,environment:'ground',supportedModes:['mission']});
doc.appearance={biome:'urban'};
doc.climate={weather:{allowed:['clear'],weights:{clear:1},fixed:true},time:{allowed:['dusk'],fixed:true}};
for(const s of doc.spawns){s.x=s.team?40:3+(s.position%2)*3;s.y=s.team?9+(s.position-1)*6:12+Math.floor((s.position-1)/2)*8;}
doc.deploymentAreas=doc.spawns.map(s=>s.team?{x:34,y:4,width:10,height:37}:{x:0,y:5,width:9,height:35});
const actors=[];
function add(id,unitId,kitId,team,x,y,group,initial=false,extra={}){
  const actor={id,unitId,kitId,team,x,y,group,initial,angle:team?270:90,...(team?{}:{autonomous:true}),...extra};actors.push(actor);return actor.id;
}
function squad(prefix,unitId,kitId,team,x,y,group,initial=false){
  return Array.from({length:3},(_,i)=>add(prefix+'-'+i,unitId,kitId,team,x,y,group,initial,{squad:prefix}));
}
for(const [i,y] of [9,22,35].entries())squad('aeug-line-'+i,'MSA_003','kit_0',0,18,y,'aeug-line',true);
for(let i=0;i<6;i++)squad('titans-line-'+i,'RMS_106','main_0',1,25+(i%2)*5,[9,22,35][Math.floor(i/2)],'titans-line',true);
squad('titans-marasai','RMS_108','main_0',1,29,25,'titans-line',true);
const waves=[];
for(const [i,y] of [9,35,22].entries()){
  const ids=[add('psycho-'+i,'MRX_009','standard',1,40,y,'psycho')];
  for(let s=0;s<2;s++)ids.push(...squad('psycho-escort-'+i+'-'+s,i===2?'RMS_108':'RMS_106','main_0',1,36,y+(s?3:-3),'escorts'));
  waves.push(ids);
}
function support(prefix,x,y){
  const carrier=add(prefix,'DodaiKai','standard',0,x,y,'aeug-support');
  const cargo=[0,1].map(i=>add(prefix+'-nemo-'+i,'MSA_003','kit_0',0,x,y,'aeug-support',false,{carrier}));
  return [carrier,...cargo];
}
const supportIds=[],endingIds=[];
for(const y of [1,43])for(const x of [17,25,33])supportIds.push(...support('support-'+x+'-'+y,x,y));
for(let i=0;i<8;i++)endingIds.push(...support('relief-'+i,3+(i%2)*3,7+Math.floor(i/2)*9));
const portrait='assets/pilots/Pilot_EFSF_0079_Officer_2.png';
const dialogue=(text,actor='aeug-line-0-0',name='奥古指挥官')=>({type:'dialogue',lines:[{actor,name,text,portrait}]});
doc.mission={version:1,era:'UC_0087_T1',scenarioFaction:'AEUG',technologyLimitEnabled:false,technologyLimit:0,
  costLimit:6000,unitLimit:18,fleetLimit:2,enemyResourcePerPlayer:0,protect:[],actors,fixedTime:'dusk',
  cover:'assets/maps/covers/burning-city.png',
  victory:{type:'eliminate_group',group:'psycho',label:'消灭敌方三台精神感应高达'},
  rewards:{technology:1500,money:12000,supplies:18000,inventory:{MSN_100:1,MSA_003:6,RMS_179_AEUG:6},
    outcomes:[{event:'target-escaped',technology:1000,money:10000,supplies:15000,inventory:{RMS_108:3,MSA_003:3,RMS_179_AEUG:6}}]},
  events:[
    {id:'opening',name:'奥古前线通信',when:{type:'start'},actions:[dialogue('距离目标到达还有一段时间，请先进行部署，不用管我们。','aeug-line-0-0','奥古一般指挥官')]},
    ...waves.map((ids,i)=>({id:'psycho-arrival-'+i,name:'精神感应高达第'+(i+1)+'波',when:{type:'round',round:3+i*5},
      actions:[{type:'spawn',actors:ids},dialogue(['第一台出现了！','第二台出现了！','第三台出现了！'][i],'psycho-'+i)]})),
    {id:'aeug-reinforcements',name:'奥古上下两路援军',when:{type:'round',round:16},actions:[
      {type:'spawn',actors:supportIds},dialogue('援军来了，一定要在损伤扩大之前击毁目标！','support-17-1')]},
    {id:'withdrawal',name:'目标开始撤退',when:{type:'round',round:21},actions:[
      dialogue('接到通讯目标准备离开，请尽可能消灭所有目标！'),
      {type:'withdraw',edge:'right',actors:['psycho-0','psycho-1','psycho-2']}]},
    {id:'targets-destroyed',name:'三台目标全部击毁',when:{type:'group_destroyed',group:'psycho'},actions:[
      {type:'spawn',actors:endingIds},dialogue('确认到目标全部被击毁，辛苦你们了，接下来交给我们就好。','relief-0'),{type:'victory'}]},
    {id:'target-escaped',name:'目标撤离，变更作战命令',when:{type:'group_escaped',group:'psycho'},actions:[
      dialogue('该死,有目标撤离了,那至少也要消灭提坦斯的有生力量')]
    }
  ]};
const map=M.compile(doc);
for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const road=[9,22,35].some(v=>Math.abs(y-v)<=1)||[9,20,31,42].some(v=>x>=v&&x<v+2)||x<9;
  map.tiles[y][x]=road?'plain':'rubble';
}
map.appearance={biome:"urban",colors:{plain:"#303a42",rubble:"#555a5e"}};
const result=NativeCity.repaint(map);
result.mission=doc.mission;result.tileMap.mission=doc.mission;
M.validate(result.tileMap);
const ref='maps/missions/burning_city.json';fs.writeFileSync(path.join(root,'assets',ref),JSON.stringify(result,null,2)+'\n');
const catalogPath=path.join(root,'assets/unit-catalog.json'),catalog=JSON.parse(fs.readFileSync(catalogPath));
if(!catalog.maps.includes(ref)){catalog.maps.push(ref);fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');}
console.log('Built',ref);
