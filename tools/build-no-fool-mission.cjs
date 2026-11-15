/* Ground escort mission; declarative reinforcements share the normal cargo rules. */
const fs = require("node:fs"), path = require("node:path");
const M = require("../shared/map-document"), B = require("./rebuild-biome-maps.cjs");
const root = path.resolve(__dirname, "..");
const doc = M.create({
  id: "mission_no_fool", name: "[0079][EFSF][原创]绝不上当",
  width: 47, height: 23, environment: "ground", playersPerTeam: 5,
  supportedModes: ["mission"],
  description: "护送大托盘沿公路前进15段，抵达东侧目标区后存活2回合。大托盘被击毁或PMC全灭则失败。",
});
for (const s of doc.spawns) {
  s.x = s.team ? 41 : 4 + ((s.position-1)%3)*3;
  s.y = s.team ? 5 + s.position*2 : (s.position <= 3 ? 5 : 17);
}
doc.deploymentAreas = doc.spawns.map(s=>s.team
  ? {x:37,y:3,width:9,height:17} : {x:1,y:2,width:12,height:19});
const actor = (id, unitId, kitId, team, x, y, group, extra={}) => ({
  id,unitId,kitId,team,x,y,group,initial:false,angle:team?270:90,...extra,
});
const actors = [actor("bigtray","BigTrayClass","standard",0,4,11,"escort",{initial:true})];
for (let squad=0;squad<2;squad++)
  for (let i=0;i<3;i++) actors.push(actor(`swordfish-${squad}-${i}`,"FF_S3","main_0",0,
    9, squad ? 17 : 5,"air-support",{squad:`swordfish-${squad}`}));
for (let side=0;side<2;side++)
  actors.push(actor(`gouf-${side}`,"MS_07H","kit_1",1,15,side?19:3,"wave-one"));
for (let carrier=0;carrier<2;carrier++) {
  const id = `uncle-one-${carrier}`, y=carrier?15:7;
  actors.push(actor(id,"FatUncle","standard",1,24,y,"wave-one"));
  for(let i=0;i<3;i++) actors.push(actor(`zaku-one-${carrier}-${i}`,"MS_06F2","machine_gun",1,
    24,y,"wave-one",{carrier:id}));
}
for(let i=0;i<3;i++) {
  const id=`dodai-${i}`,y=6+i*5;
  actors.push(actor(id,"Dodai2","standard",1,30,y,"wave-two"));
  actors.push(actor(`efreet-${i}`,"MS_08TX","kit_0",1,30,y,"wave-two",{carrier:id}));
}
actors.push(actor("uncle-two","FatUncle","standard",1,34,8,"wave-two"));
for(let i=0;i<3;i++) actors.push(actor(`zaku-two-${i}`,"MS_06F2","machine_gun",1,34,8,
  "wave-two",{carrier:"uncle-two"}));
for(let squad=0;squad<2;squad++)
  for(let i=0;i<3;i++) actors.push(actor(`dom-${squad}-${i}`,"MS_09","bazooka",1,
    38,squad?13:10,"wave-three",{squad:`dom-${squad}`}));
const reinforcement = (id,name,round,group) => ({id,name,when:{type:"round",round},
  actions:[{type:"spawn",actors:actors.filter(a=>a.group===group).map(a=>a.id)}]});
doc.mission = {
  version:1,era:"UC_0079_T1",scenarioFaction:"EFSF",technologyLimitEnabled:false,
  technologyLimit:0,costLimit:2000,unitLimit:18,enemyResourcePerPlayer:0,
  protect:["bigtray"],actors,
  rewards:{money:4000,supplies:6000,inventory:{RGM_79_G:3},
    bonuses:[{event:"all-enemies-cleared",money:1500,supplies:2250,inventory:{RX_79_G:1,MS_07H:2}}]},
  victory:{type:"escort",actor:"bigtray",x:34,y:9,width:7,height:5,holdRounds:2,
    eliminateAll:true,route:Array.from({length:15},(_,i)=>({x:6+i*2,y:11}))},
  events:[
    {id:"opening",name:"护送开始",when:{type:"start"},actions:[{type:"message",
      text:"保护大托盘沿公路前往东侧集结区。请保持公路畅通；抵达后还需坚守2回合。"}]},
    reinforcement("air-support","剑鱼支援抵达",2,"air-support"),
    reinforcement("first-attack","第一波伏击",3,"wave-one"),
    reinforcement("second-attack","第二波伏击",6,"wave-two"),
    reinforcement("destination-attack","目标区伏兵",10,"wave-three"),
    {id:"all-enemies-cleared",name:"伏击部队全歼",when:{type:"all",conditions:
      ["wave-one","wave-two","wave-three"].map(group=>({type:"group_destroyed",group}))},
      actions:[{type:"message",text:"全部伏击部队已消灭，护送任务提前完成，追加全歼奖励。"}]},
  ],
};
const map = M.compile(doc);
for(let y=0;y<map.height;y++) for(let x=0;x<map.width;x++) {
  const forest = (y<7 || y>15) && ((Math.floor(x/5)+Math.floor(y/3))%4!==0);
  map.tiles[y][x] = forest ? "forest" : "plain";
}
const result=B.rebuild(map);
result.mission=doc.mission;
result.tileMap.mission=doc.mission;
const relative="maps/missions/no_fool.json";
fs.writeFileSync(path.join(root,"assets",relative),JSON.stringify(result,null,2)+"\n");
const catalogPath=path.join(root,"assets/unit-catalog.json");
const catalog=JSON.parse(fs.readFileSync(catalogPath,"utf8"));
if(!catalog.maps.includes(relative)) {
  catalog.maps.push(relative);
  fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+"\n");
}
console.log("Built",relative);
