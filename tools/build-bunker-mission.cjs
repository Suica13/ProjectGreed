/* Original coastal fortress mission with synchronized ceasefire branches. */
const fs=require("node:fs"),path=require("node:path");
const M=require("../shared/map-document"),B=require("./rebuild-biome-maps.cjs");
const root=path.resolve(__dirname,"..");
const doc=M.create({id:"mission_bunker_coastal",name:"[0079][原创]人口过剩-EFSF",
  description:"将地图中的敌军全数歼灭，没有人可以侵略联邦",
  width:57,height:31,playersPerTeam:5,environment:"ground",supportedModes:["mission"]});
for(const s of doc.spawns){s.x=s.team?54:4+((s.position-1)%3)*4;s.y=s.team?5+s.position*4:(s.position<=3?9:21);}
doc.deploymentAreas=doc.spawns.map(s=>s.team?{x:46,y:2,width:16,height:27}:{x:1,y:3,width:15,height:25});
const actors=[];
function add(id,unitId,kitId,team,x,y,group,initial=false,extra={}){
  const a={id,unitId,kitId,team,x,y,group,initial,angle:team?270:90,...extra};actors.push(a);return a;
}
function squad(prefix,unitId,kitId,count,team,x,y,group,initial=false){
  for(let i=0;i<count;i++)add(prefix+"-"+i,unitId,kitId,team,x,y,group,initial,{squad:prefix,...(team===0?{autonomous:true}:{})});
}
for(const [i,y] of [7,15,24].entries())add("dabude-"+i,"DabudeClass","standard",1,45,y,"main-force",true);
for(let i=0;i<9;i++)squad("garrison-"+i,i<3?"MS_06J":i<6?"MS_06F":"MS_09",i<6?"machine_gun":"bazooka",3,1,
  [24,24,34,34,43,43,52,52,52][i],[7,23,5,26,9,22,5,16,26][i],"main-force",true);
const towerKinds=["MG","Cannon","Beam","Missile","MG","Beam","Cannon","Missile","MG","Beam","Cannon","Missile"];
for(let i=0;i<12;i++)add("turret-"+i,"Facility_"+towerKinds[i],"standard",1,
  [24,24,34,34,44,44,56,56,28,38,48,54][i],[10,20,8,22,11,19,8,23,15,15,4,27][i],"defenses",true,{facilityLevel:2});
for(let i=0;i<3;i++)squad("jim-support-"+i,"RGM_79","machine_gun",3,0,11,6+i*9,"jim-support");
for(let i=0;i<2;i++)squad("guntank-support-"+i,"RX_75R","standard",3,0,13,8+i*15,"guntank-support");
function transported(prefix,unitId,kitId,count,x,y){
  const ids=[];
  for(let c=0;c<count/3;c++){
    const carrier=add(prefix+"-carrier-"+c,"FatUncle","standard",1,x,y+c*6,"transports");ids.push(carrier.id);
    for(let i=0;i<3;i++)ids.push(add(prefix+"-"+c+"-"+i,unitId,kitId,1,x,y+c*6,"main-force",false,{carrier:carrier.id}).id);
  }
  return ids;
}
const wave1=[...transported("wave-one-f","MS_06F","machine_gun",6,38,3),
  ...transported("wave-one-j","MS_06J","machine_gun",6,39,20)];
for(let i=0;i<2;i++)squad("wave-two-dom-"+i,"MS_09","bazooka",3,1,42,11+i*8,"main-force");
const wave2=[...actors.filter(a=>a.id.startsWith("wave-two-dom")).map(a=>a.id),
  ...transported("wave-two-f2","MS_06F2","machine_gun",6,50,5)];
for(let i=0;i<2;i++)squad("wave-three-gelgoog-"+i,"MS_14G","kit_0",3,1,58,10+i*12,"main-force");
const wave3=actors.filter(a=>a.id.startsWith("wave-three-gelgoog")).map(a=>a.id);
for(let i=0;i<3;i++)squad("last-old-zaku-"+i,"MS_05","kit_0",3,1,58,5+i*9,"last-stand");
for(let i=0;i<2;i++)squad("last-zaku-j-"+i,"MS_06J","machine_gun",3,1,54,8+i*15,"last-stand");
squad("last-dom","MS_09","bazooka",3,1,56,15,"last-stand");
add("last-tropical-dom","MS_09D","kit_1",1,57,18,"last-stand");
add("last-efreet","MS_08TX","kit_0",1,56,20,"last-stand");
squad("last-flying-gouf","MS_07H8","kit_0",2,1,57,12,"last-stand");
const wave=(id,name,round,ids)=>({id,name,when:{type:"round",round},actions:[{type:"spawn",actors:ids}]});
const speakers={
  zeon:{actor:"dabude-0",name:"吉翁军前线指挥官",portrait:"assets/pilots/Pilot_ZEON_0079_Officer_1.png"},
  federation:{actor:"jim-support-0-0",name:"联邦前线指挥官",portrait:"assets/pilots/Pilot_EFSF_0079_Officer_1.png"},
  communications:{actor:"jim-support-1-0",name:"联邦通信员",portrait:"assets/pilots/Pilot_EFSF_0079_Common_1.png"}
};
const line=(speaker,text)=>({...speakers[speaker],text});
const ceasefireDialogue={type:"dialogue",lines:[
  line("zeon","这里是吉翁军前线指挥部，全频段呼叫联邦前线指挥官。"),
  line("communications","长官，他们找你。"),
  line("federation","接通。"),
  line("federation","这里是联邦前线指挥部，你想干什么。"),
  line("zeon","战场局势千变万化，这次幸运女神站在了联邦那边。"),
  line("zeon","我请求停火，我会带着我的士兵回到宇宙，事到如今已经没有人需要去死了。"),
  line("federation","......"),
  line("federation","上报总指挥部。"),
  line("communications","已上报，等待回复。")
]};
const acceptDialogue={type:"dialogue",lines:[
  line("communications","待机..."),
  line("communications","待机......"),
  line("communications","待机........."),
  line("communications","总指挥部同意了请求。"),
  line("federation","......"),
  line("federation","至前线所有作战单位，停火。"),
  line("zeon","谢天谢地，这场战争中还有理智的人。"),
  line("federation","这场战争的结局是不会改变的。")
]};
const refuseDialogue={type:"dialogue",lines:[
  line("communications","待机..."),
  line("communications","待机......"),
  line("communications","待机........."),
  line("communications","总指挥部拒绝了请求。"),
  line("federation","至前线所有作战单位，开火。"),
  line("federation","没有人可以入侵联邦。"),
  line("zeon","该死的，你们这些人都该下地狱。"),
  line("zeon","让HLV的人下来，这样下去我们没有人能走得掉。"),
  line("zeon","死也要咬下来一块肉！")
]};
doc.mission={version:1,era:"UC_0079_T2",scenarioFaction:"EFSF",technologyLimitEnabled:false,technologyLimit:0,
  costLimit:4500,unitLimit:18,fleetLimit:2,enemyResourcePerPlayer:0,protect:[],actors,
  victory:{type:"scripted",group:"main-force",choiceEvent:"ceasefire",continueOption:"refuse"},
  landmarks:[{type:"mass_driver",x:53,y:13,width:18,height:5}],
  rewards:{technology:1000,money:5000,supplies:7500,inventory:{RGM_79SC:6,RGM_79HC:6},
    outcomes:[{event:"refuse-ceasefire",technology:1500,money:7500,supplies:10000,inventory:{RX_81:3,RGM_79C:9}}]},
  events:[
    {id:"opening",name:"人口过剩攻略作战",when:{type:"start"},actions:[{type:"message",text:"歼灭地图中的敌军。没有人可以侵略联邦。"}]},
    wave("jim-arrival","三队吉姆支援",2,actors.filter(a=>a.group==="jim-support").map(a=>a.id)),
    wave("first-attack","第一次进攻",3,wave1),
    wave("guntank-arrival","两队量产型钢坦克支援",4,actors.filter(a=>a.group==="guntank-support").map(a=>a.id)),
    wave("second-attack","第二次进攻",6,wave2),
    wave("third-attack","目标区增援",10,wave3),
    {id:"ceasefire",name:"吉翁军指挥官请求停火",when:{type:"group_destroyed",group:"main-force"},actions:[ceasefireDialogue,
      {type:"choice",name:"吉翁军指挥官",text:"我军主力已经损失殆尽，请求停火。你们愿意接受吗？",options:[
        {id:"accept",text:"A：接受停火，任务结束。"},{id:"refuse",text:"B：不接受停火，继续歼灭敌军。"}]}]},
    {id:"accept-ceasefire",name:"接受停火",when:{type:"choice_selected",event:"ceasefire",option:"accept"},actions:[acceptDialogue,{type:"victory"}]},
    {id:"refuse-ceasefire",name:"吉翁军最后的抵抗",when:{type:"choice_selected",event:"ceasefire",option:"refuse"},actions:[refuseDialogue,
      {type:"spawn",actors:actors.filter(a=>a.group==="last-stand").map(a=>a.id)},
      {type:"message",text:"停火请求已拒绝。吉翁军最后的部队出现，必须消灭包括炮塔和运输机在内的全部敌军。"}]},
    {id:"final-victory",name:"彻底歼灭敌军",when:{type:"all",conditions:[
      {type:"choice_selected",event:"ceasefire",option:"refuse"},{type:"all_enemies_destroyed"}]},actions:[{type:"victory"}]},
  ]};
// Shorten the east-west front by one quarter, including all authored geometry.
const xScale=56/75;
for(const actor of actors)actor.x=Math.round(actor.x*xScale);
for(const spawn of doc.spawns)spawn.x=Math.round(spawn.x*xScale);
for(const area of doc.deploymentAreas){area.x=Math.round(area.x*xScale);area.width=Math.max(1,Math.round(area.width*xScale));}
for(const landmark of doc.mission.landmarks){landmark.x=Math.round(landmark.x*xScale);landmark.width=Math.round(landmark.width*xScale);}
const map=M.compile(doc);
for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){
  const shore=48+Math.floor(Math.sin(y/4)*2);
  map.tiles[y][x]=x>=shore+2?"water":x>=shore-2?"desert":
    y>=12&&y<=18?"plain":(y<4||y>26)&&x<46?"forest":"plain";
}
const result=B.rebuild(map);result.mission=doc.mission;result.tileMap.mission=doc.mission;
const ref="maps/missions/bunker.json";fs.writeFileSync(path.join(root,"assets",ref),JSON.stringify(result,null,2)+"\n");
const catalogPath=path.join(root,"assets/unit-catalog.json"),catalog=JSON.parse(fs.readFileSync(catalogPath));
if(!catalog.maps.includes(ref)){catalog.maps.push(ref);fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+"\n");}
console.log("Built",ref);
