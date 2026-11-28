/* Liaison battles: independent, casualty-triggered reinforcements on both sides. */
const fs=require('node:fs'),path=require('node:path'),root=path.resolve(__dirname,'..');
const M=require('../shared/map-document'),B=require('./rebuild-biome-maps.cjs'),G=require('../shared/rules');
const scenarioCosts={19:15000,29:27000};
const tasks=require('../shared/contact-efsf.json').filter(task=>[19,29].includes(task.number));
for(const task of tasks){
 const colony=task.number===29,width=colony?64:44,height=colony?44:64;
 const point=(x,y)=>colony?{x,y}:{x:y,y:63-x};
 const region=r=>colony?r:{x:r.y,y:64-r.x-r.width,width:r.height,height:r.width};
 const doc=M.create({id:task.missionId,name:'[0079T2] '+task.name+' · '+(colony?'殖民卫星拦截宙域':'阿巴瓦空'),width,height,environment:'space',supportedModes:['mission'],playersPerTeam:5,description:task.objectiveText});
 const starts=[[3,10],[6,10],[3,15],[6,15],[3,20]];
 doc.spawns=Array.from({length:10},(_,i)=>({team:i%2,position:Math.floor(i/2)+1,x:i%2?59:starts[Math.floor(i/2)][0],y:i%2?5+Math.floor(i/2)*7:starts[Math.floor(i/2)][1]}));
 doc.deploymentAreas=doc.spawns.map(s=>s.team?{x:55,y:3,width:8,height:38}:{x:1,y:6,width:9,height:23});
 doc.spawns=doc.spawns.map(s=>({...s,...point(s.x,s.y)}));
 doc.deploymentAreas=doc.deploymentAreas.map(region);
 for(const t of doc.tiles)t.environment='space';
 const c=colony?{kind:'retrieve',label:task.objectiveText,clearTargets:true,deadlineRound:24,nodes:[{id:'engine-a',x:48,y:8,label:'北侧姿态控制'},{id:'engine-b',x:48,y:34,label:'南侧姿态控制'},{id:'bridge',x:56,y:21,label:'修改坠落轨道'}]}:{kind:'kills',label:task.objectiveText,required:1,killReward:true,surviveRound:18,extraction:{x:0,y:4,width:10,height:34}};
 if(c.extraction)c.extraction=region(c.extraction);
 const m={version:1,era:task.era,contactTask:task.id,commission:c,noRewards:true,technologyLimitEnabled:false,technologyLimit:0,scenarioFaction:'EFSF',costLimit:scenarioCosts[task.number],unitLimit:36,fleetLimit:5,enemyResourcePerPlayer:.25,rewards:{technology:0,money:0,supplies:0,inventory:{}},victory:{type:'commission'},protect:colony?['albion']:[],actors:[],events:[]};
 const group=(team,wave)=>team===1&&wave===0?'targets':(team?'enemy':'allied')+'-wave-'+wave;
 function actor(id,unitId,x,y,unitGroup,team,initial,extra={}){
  const model=Object.values(G.models).find(m=>m.prefabId===unitId&&!m.formOnly);if(!model)throw Error(unitId);
  m.actors.push({id,unitId,kitId:model.kitId,...point(x,y),group:unitGroup,team,initial,angle:colony?(team?270:90):(team?180:0),...(team===0?{autonomous:true}:{}),...extra});
 }
 for(let wave=0;wave<=5;wave++)for(const team of [0,1]){
  const total=team?33:22,ships=team?(wave<4?3:2):colony?(wave<4?2:1):3,mobile=total-ships,unitGroup=group(team,wave),initial=wave===0;
  const units=team?(colony?['MS_06F2','MS_14F','MS_09R','MS_06F2','MS_09R2']:['MS_14A','MS_06F2','MS_09R']):(colony?['MS_14F','RGM_79C_Space','RGM_79N','MS_14F','RGC_83']:['RGM_79','RB_79_LateType','RGM_79','RB_79_LateType']);
  for(let i=0;i<mobile;i++){
   const q=Math.floor(i/3),x=(team?39:14)+(q%3)*6,y=6+Math.floor(q/3)*7;
   let unitId=units[i%units.length],id=unitGroup+'-ms-'+i,extra={squad:unitGroup+'-squad-'+q,...(i%6===0?{genericPilot:'veteran'}:{})};
   if(!colony&&team===0&&i===0)unitId='FA_78_1';
   if(colony&&initial&&i===0){unitId=team?'AMX_002':'RX_78GP03D';id=team?'neue-ziel':'dendrobium';extra={genericPilot:'ace',name:team?'阿纳贝尔·卡多':'浦木宏'};}
   if(colony&&initial&&team===0&&i===1){unitId='MS_14FS';id='cima';extra={genericPilot:'ace',name:'西玛·卡拉豪'};}
   actor(id,unitId,x,y,unitGroup,team,initial,extra);
  }
  const fleet=team?(colony?['MusaiClassLateType_0083']:['MusaiClassLateType','PapuaClass','MusaiClassLateType']):(colony?['SalamisClassKai','MusaiClassLateType_0083','MagellanClassKai']:['MagellanClassLateType','SalamisClassLateType','ColumbusClass']);
  for(let i=0;i<ships;i++){
   let unitId=fleet[(colony?wave+i:i)%fleet.length],id=unitGroup+'-ship-'+i,name;
   if(initial&&team===0&&i===0){id=colony?'albion':'federation';unitId=colony?'AlbionClass':'MagellanClassLateType';name=colony?'阿鲁比昂舰桥':'联邦舰队指挥部';}
   if(colony&&initial&&team===0&&i===1){id='lili-marleen';unitId='ZanzibarClassKai_0083';name='莉莉·玛莲舰桥';}
   actor(id,unitId,colony?(team?39:14)+i*8:(team?52:17),colony?35:8+i*12,unitGroup,team,initial,{genericPilot:'veteran',...(name?{name}:{})});
  }
 }
 // Load allied mobile suits into real hangars; the rest escort the fleet.
 if(!colony)for(let wave=0;wave<=5;wave++){
  const members=m.actors.filter(a=>a.group===group(0,wave)),cargo=members.filter(a=>a.squad);
  for(const ship of members.filter(a=>!a.squad))for(const hangar of G.models[ship.unitId+'__'+ship.kitId].hangars){
   let capacity=hangar.capacity;
   while(cargo.length){
    const a=cargo[0],cost=G.models[a.unitId+'__'+a.kitId].transport.slotCost;
    if(cost>capacity)break;
    cargo.shift();capacity-=cost;a.carrier=ship.id;delete a.squad;a.x=ship.x;a.y=ship.y;
   }
  }
 }
 const lines=colony?[
  {actor:'albion',name:'阿鲁比昂舰桥',text:'殖民卫星仍在下降。各舰掩护突击队，必须在最后的拦截窗口关闭前控制推进装置。'},
  {actor:'cima',name:'西玛·卡拉豪',text:'西玛舰队已经进入战区。认清识别信号，我们来替你们打开通路。'},
  {actor:'dendrobium',name:'浦木宏',text:'石斛兰出击！大型目标交给我，突击队抓住机会靠近殖民卫星。'},
  {actor:'neue-ziel',name:'阿纳贝尔·卡多',text:'残存的舰队，保持防线！不能让他们接近殖民卫星。'}
 ]:[
  {actor:'federation',name:'联邦舰队指挥部',text:'各舰队进入阿巴瓦空宙域。吉姆小队打开航路，铁球队保持火力支援，战舰不要脱离掩护。'},
  {actor:'targets-ship-0',name:'吉翁守备舰队',text:'敌舰队正在接近要塞！勇士与力克大魔前出，扎古队保护舰艇，后备队准备接替。'},
  {actor:'federation',name:'联邦舰队指挥部',text:'各舰释放搭载部队，自南向北突破要塞防线！佣兵部队保持通讯，完成作战后从南侧航道撤离。'}
 ];
 m.events.push({id:'briefing',name:'舰队交战通讯',when:{type:'start'},actions:[{type:'dialogue',lines},{type:'message',text:task.rulesText+' 双方各最多五轮增援，每批损失过半后补入下一批。'}]});
 for(let wave=1;wave<=5;wave++)for(const team of [0,1]){
  const ids=m.actors.filter(a=>a.group===group(team,wave)).map(a=>a.id);
  m.events.push({id:(team?'enemy':'allied')+'-support-'+wave,name:(team?'敌军':'友军')+'第'+wave+'轮支援',when:{type:'defeated_group',group:group(team,wave-1),count:team?17:12,byRound:1000000},actions:[{type:'spawn',actors:ids},{type:'message',text:(team?'敌军':'友军')+'第'+wave+'/5轮支援抵达，'+(team?'33':'22')+'个单位进入战区。'}]});
 }
 if(colony)m.events.push({id:'deadline-warning',name:'坠落轨道警告',when:{type:'round',round:18},actions:[{type:'message',text:'距离不可逆再入只剩6回合！突破守军，接近三个控制点并保全阿鲁比昂。'}]});
 doc.mission=m;const map=M.compile(doc);map.appearance={biome:'space',colors:{}};
 for(let y=0;y<44;y++)for(let x=0;x<64;x++){
  let terrain=x>10&&y>2&&y<41&&(x*13+y*7)%23<3?'rock':'plain';
  if(!colony&&x>49&&x<61&&y>5&&y<38)terrain=[12,21,30].includes(y)||x===54?'plain':'rock';
  if(colony&&x>45&&x<61&&y>3&&y<40)terrain=[8,21,34].includes(y)||x===48?'plain':y%7<3?'rubble':'plain';
  if([12,21,30].some(lane=>Math.abs(y-lane)<=1))terrain='plain';
  const p=point(x,y);map.tiles[p.y][p.x]=terrain;
 }
 for(const a of m.actors)for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)if(map.tiles[a.y+dy]?.[a.x+dx])map.tiles[a.y+dy][a.x+dx]='plain';
 for(const p of c.nodes||[])map.tiles[p.y][p.x]='plain';
 for(const r of map.deploymentAreas)for(let y=r.y;y<r.y+r.height;y++)for(let x=r.x;x<r.x+r.width;x++)map.tiles[y][x]='plain';
 const result=B.rebuild(map);result.mission=m;result.tileMap.mission=m;fs.writeFileSync(path.join(root,'assets/maps/missions/efsf_'+task.number+'.json'),JSON.stringify(result,null,2)+'\n');
}
const file=path.join(root,'assets/unit-catalog.json'),catalog=JSON.parse(fs.readFileSync(file));
for(const t of tasks){const ref='maps/missions/efsf_'+t.number+'.json';if(!catalog.maps.includes(ref))catalog.maps.push(ref);}
fs.writeFileSync(file,JSON.stringify(catalog,null,2)+'\n');console.log('Built '+tasks.length+' reinforced liaison battles.');
