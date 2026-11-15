/* Reproducible Zeon night raid with seeded targets and full-force extraction. */
const fs=require('node:fs'),path=require('node:path');
const M=require('../shared/map-document'),B=require('./rebuild-biome-maps.cjs');
const root=path.resolve(__dirname,'..');
const doc=M.create({id:'mission_sleepless_raid',name:'[0079][原创]彻夜难眠-ZEON',width:36,height:36,playersPerTeam:5,
  environment:'ground',supportedModes:['mission'],description:'在天亮前摧毁基地内三台米迪亚，并让全部存活部队返回撤离区。击破守备指挥官可延长作战时间，但会招来增援。'});
doc.climate={weather:{allowed:['clear'],weights:{clear:1},fixed:true},time:{allowed:['late_night'],fixed:true}};
for(const s of doc.spawns){s.x=s.team?25:3+(s.position%2)*3;s.y=s.team?10+s.position*3:5+Math.floor((s.position-1)/2)*6;}
doc.deploymentAreas=doc.spawns.map(s=>s.team?{x:11,y:8,width:18,height:18}:{x:1,y:2,width:8,height:19});
const actors=[];
function add(id,unitId,kitId,team,x,y,group,initial=true,extra={}){
  actors.push({id,unitId,kitId,team,x,y,group,initial,angle:team?270:90,...extra});return id;
}
function squad(prefix,id,kit,count,x,y,group,initial=true){return Array.from({length:count},(_,i)=>add(prefix+'-'+i,id,kit,1,x,y,group,initial,{squad:prefix}));}
for(const [i,[x,y]] of [[12,9],[27,9],[12,24],[27,24],[20,17]].entries())
  add('medea-'+i,'Medea','standard',1,x,y,'targets',false,{stationary:true});
for(const [i,[x,y]] of [[11,12],[28,12],[11,21],[28,21],[20,8]].entries())
  add('mg-turret-'+i,'Facility_MG','standard',1,x,y,'guards',true,{facilityLevel:1});
add('commander','RGM_79_Commander','kit_0',1,20,13,'guards');
squad('jim-squad','RGM_79','machine_gun',3,16,15,'guards');
for(const [i,[x,y]] of [[14,11],[25,17],[16,24]].entries())add('ground-jim-'+i,'RGM_79_G','machine_gun',1,x,y,'guards');
squad('guntank','RX_75R','standard',3,25,22,'guards');
add('ground-gundam','RX_79_G','beam_rifle',1,23,11,'guards');
for(const [i,[x,y]] of [[14,18],[25,15],[18,24],[25,25]].entries())squad('tank-'+i,'Type61A5','standard',3,x,y,'guards');
const air=[];
for(const [i,[x,y]] of [[17,4],[32,23]].entries())air.push(...squad('swordfish-'+i,'FF_S3','main_0',3,x,y,'air',false));
for(const [i,[x,y]] of [[20,4],[32,20]].entries())air.push(add('corebooster-'+i,'FF_X7Bst','main_0',1,x,y,'air',false));
const reinforcements=[];
for(const [prefix,id,kit,count,x,y] of [
  ['guard-custom','RGM_79HC','kit_0',3,32,12],['sniper-custom','RGM_79SC','kit_0',3,32,23],
  ['guncannon','RX_77_2','kit_2',3,21,29],['light-jim-a','RGM_79L','beam_gun',3,17,4],
  ['light-jim-b','RGM_79L','beam_gun',3,28,29],['heli-a','EF_Heli','standard',3,12,4],
  ['heli-b','EF_Heli','standard',3,32,18]])
  reinforcements.push(...squad(prefix,id,kit,count,x,y,'reinforcements',false));
add('extraction-uncle','FatUncle','standard',0,4,29,'extraction',false);
doc.mission={version:1,era:'UC_0079_T1',scenarioFaction:'ZEON',technologyLimitEnabled:false,technologyLimit:0,
  costLimit:5000,unitLimit:18,fleetLimit:2,enemyResourcePerPlayer:0,protect:[],actors,
  initialChoices:[{group:'targets',count:3}],clock:{dawnRound:30},
  landmarks:[{type:'base_compound',x:10,y:7,width:20,height:20}],
  victory:{type:'extract',group:'targets',region:{x:1,y:26,width:8,height:8},deadlineRound:30},
  rewards:{money:6000,supplies:8000,technology:1000,inventory:{MS_08TX:3,MS_09:6},
    bonuses:[{event:'all-enemies-cleared',money:3000,supplies:4500,technology:500,inventory:{MS_14G:3,MS_06F2:6}}]},
  events:[
    {id:'opening',name:'夜袭开始',when:{type:'start'},actions:[{type:'message',text:'30回合内摧毁三台目标米迪亚，并让全部存活部队撤离。击破守备指挥官可延长20回合，但敌军会投入增援。'}]},
    {id:'air-reinforcements',name:'联邦航空部队抵达',when:{type:'round',round:10},actions:[{type:'spawn',actors:air}]},
    {id:'commander-defeated',name:'守备指挥官被击破',when:{type:'actor_destroyed',actor:'commander'},actions:[
      {type:'extend_time',rounds:20},{type:'spawn',actors:reinforcements},
      {type:'message',text:'守备指挥官已被击破，任务时限延长20回合。敌方增援正在抵达。'}]},
    {id:'targets-destroyed',name:'目标全部摧毁，撤离点开放',when:{type:'group_destroyed',group:'targets'},actions:[
      {type:'spawn',actors:['extraction-uncle']},{type:'open_extraction'},
      {type:'message',text:'三台米迪亚已被摧毁，胖叔叔抵达西南撤离区。所有存活单位必须返回撤离区，包括格纳库内的乘客。'}]},
    {id:'all-enemies-cleared',name:'额外目标：敌军全歼',when:{type:'all',conditions:
      ['targets','guards','air','reinforcements'].map(group=>({type:'group_destroyed',group}))},actions:[
      {type:'message',text:'全部敌军已消灭。完成全员撤离后将获得额外奖励。'}]},
  ]};
const map=M.compile(doc);map.appearance={biome:'urban',colors:{plain:'#444e53',forest:'#364b45',rock:'#626c72'}};
for(let y=0;y<36;y++)for(let x=0;x<36;x++){
  const inside=x>=10&&x<30&&y>=7&&y<27;
  const wall=inside&&(x===10||x===29||y===7||y===26);
  const gate=(x>=18&&x<=21)||(y>=15&&y<=18);
  map.tiles[y][x]=wall&&!gate?'rock':inside?'plain':(x>=10&&y<5)||(x>=31&&y>26)?'forest':'plain';
}
const result=B.rebuild(map);result.mission=doc.mission;result.tileMap.mission=doc.mission;
const ref='maps/missions/sleepless_raid.json';fs.writeFileSync(path.join(root,'assets',ref),JSON.stringify(result,null,2)+'\n');
const catalogPath=path.join(root,'assets/unit-catalog.json'),catalog=JSON.parse(fs.readFileSync(catalogPath));
if(!catalog.maps.includes(ref)){catalog.maps.push(ref);fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+'\n');}
console.log('Built',ref);
