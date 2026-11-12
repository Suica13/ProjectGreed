"use strict";
// Two compact five-seat-per-team variants of the existing canyon battlefield.
// Reuse its atlas and facility artwork; all gameplay tiles remain editable.
const fs = require("node:fs");
const path = require("node:path");
const M = require("../shared/map-document.js");
const root = path.resolve(__dirname,"..");
const template = JSON.parse(fs.readFileSync(path.join(root,"assets/maps/battlefield/frontline.json"),"utf8"));
const width=64,height=44;
const within=(x,y,a)=>x>=a.x&&y>=a.y&&x<a.x+a.width&&y<a.y+a.height;
const ellipse=(x,y,cx,cy,rx,ry)=>(x-cx)**2/(rx*rx)+(y-cy)**2/(ry*ry)<1;
function segmentDistance(x,y,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));
  return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy);
}
function generate(kind){
  const basin=kind==="basin";
  const id=basin?"battlefield_ruined_basin":"battlefield_twin_ridges";
  const doc=M.create({id,width,height,playersPerTeam:5,supportedModes:["battlefield"],
    name:basin?"雇佣兵战争 · 裂谷遗迹":"雇佣兵战争 · 双脊峡口",
    description:basin?"西北与东南基地夹住环形高地和中央遗迹盆地，四处据点由交错坡道相连。":"东西基地隔着中央谷道相望，南北双层山脊控制侧翼据点，主路与绕行路线并存。"});
  const leftArea=basin?{x:3,y:4,width:14,height:17}:{x:3,y:12,width:14,height:18};
  const rightArea={x:width-leftArea.x-leftArea.width,y:height-leftArea.y-leftArea.height,width:leftArea.width,height:leftArea.height};
  const areas=[leftArea,rightArea];
  const leftFacilities=basin?[["base",7,10],["machineGun",16,10],["beam",15,17],["missile",5,7],["cannon",5,18],["radar",4,13]]:
    [["base",7,20],["machineGun",16,17],["beam",16,27],["missile",5,14],["cannon",5,28],["radar",4,24]];
  const facilities=[];
  for(const team of [0,1])for(const [type,x,y] of leftFacilities){
    const size=type==="base"?3:1;
    facilities.push({id:team+"-"+type,type,team,x:team?width-x-size:x,y:team?height-y-size:y});
  }
  const sites=basin?[[23,12],[23,29],[38,29],[38,12]]:[[25,11],[25,30],[36,30],[36,11]];
  const points=sites.map(([x,y],i)=>({id:"point-"+(i+1),name:"据点 "+(i+1),x,y}));
  const ramp=(x,y)=>basin?
    Math.abs(y-21.5)<3||Math.abs(x-31.5)<3||segmentDistance(x,y,[12,17],[32,22])<3.2||segmentDistance(x,y,[51,26],[31,21])<3.2:
    Math.abs(y-21.5)<3.5||(x>=24&&x<=28)||(x>=35&&x<=39);
  const level=(x,y)=>{
    if(basin){
      if((x>=2&&x<=20&&y>=2&&y<=22)||(x>=43&&x<=61&&y>=21&&y<=41))return 1;
      const outer=ellipse(x,y,31.5,21.5,17,14),inner=ellipse(x,y,31.5,21.5,10,8);
      if(outer&&!inner)return ellipse(x,y,31.5,21.5,14,11)?2:1;
      return 0;
    }
    if((x>=2&&x<=19&&y>=6&&y<=37)||(x>=44&&x<=61&&y>=6&&y<=37))return 1;
    if(ellipse(x,y,31.5,11,13,7)||ellipse(x,y,31.5,32,13,7))
      return ellipse(x,y,31.5,11,6,3.5)||ellipse(x,y,31.5,32,6,3.5)?2:1;
    return 0;
  };
  const elevations=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>level(x,y)));
  // Explicit, safe staging/installation pads; no spawn expansion with seat count.
  for(let y=2;y<height-2;y++)for(let x=2;x<width-2;x++)
    if(areas.some(a=>within(x,y,a))||[...facilities,...points].some(s=>x>=s.x-1&&y>=s.y-1&&x<s.x+4&&y<s.y+4))elevations[y][x]=1;
  const data=[],terrain=[],props=Array(width*height).fill(null);
  for(let y=0;y<height;y++){
    const row=[];
    for(let x=0;x<width;x++){
      const variant=(x*3+y*7)%4,elevation=elevations[y][x];
      let type="plain",tile="plain_"+variant;
      const mask=[[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]].reduce((v,[dx,dy,bit])=>v|((elevations[y+dy]?.[x+dx]??0)<elevation?bit:0),0);
      if(x<2||y<2||x>=width-2||y>=height-2){type="rock";tile="rock_"+variant;}
      else if(elevation){
        const clear=areas.some(a=>within(x,y,a))||[...facilities,...points].some(s=>x>=s.x-1&&y>=s.y-1&&x<s.x+4&&y<s.y+4);
        type=mask&&!ramp(x,y)&&!clear?"rock":"highland";
        tile=type==="rock"?(elevation===2?"upper_cliff_":"cliff_")+mask:
          elevation===2?(mask?"upper_ramp_":"upper_")+variant:(mask&&ramp(x,y)?"ramp_":"highland_")+variant;
      }
      if(basin&&ellipse(x,y,31.5,21.5,7,5)){type="rubble";tile="rubble_"+variant;}
      const hash=(x*73856093^y*19349663)>>>0;
      if(type==="plain"&&!ramp(x,y)&&!areas.some(a=>within(x,y,a))&&
        (ellipse(x,y,20,33,4,3)||ellipse(x,y,43,10,4,3))){type="forest";tile="forest_"+variant;}
      if(hash%41===0&&type!=="rock"&&!ramp(x,y)&&!areas.some(a=>within(x,y,a))&&
        ![...facilities,...points].some(s=>Math.hypot(s.x-x,s.y-y)<5))props[y*width+x]=["decor_stones","decor_scrub","decor_ruin"][hash%3];
      row.push(type);data.push(tile);
    }
    terrain.push(row);
  }
  doc.tilesets=[];doc.tiles=[...new Map(data.map((tileId,i)=>[tileId,{id:tileId,name:tileId,terrain:terrain[Math.floor(i/width)][i%width],environment:'ground',color:M.terrains[terrain[Math.floor(i/width)][i%width]].color,decorative:false,dynamic:false}])).values()];
  for(const id of new Set(props.filter(Boolean)))doc.tiles.push({id,name:id,terrain:'plain',environment:'ground',color:M.terrains.plain.color,decorative:true,dynamic:false});
  doc.layers=[{...M.layer(doc,"地形与坡道"),id:id+"_ground",data},
    {...M.layer(doc,"岩石、灌木与遗迹"),id:id+"_props",decorative:true,data:props}];
  doc.spawns=[];doc.deploymentAreas=[];
  for(let position=0;position<5;position++)for(const team of [0,1]){
    const a=areas[team];
    const x=leftArea.x+3+(position%3)*4,y=leftArea.y+3+Math.floor(position/3)*9;
    doc.spawns.push({team,position:position+1,x:team?width-1-x:x,y:team?height-1-y:y});
    doc.deploymentAreas.push({...a});
  }
  doc.lighting=structuredClone(template.lighting);doc.surfaceCover=true;
  doc.climate=structuredClone(template.climate);
  if(basin)doc.climate.weather={allowed:["clear","overcast","rain","fog"],weights:{clear:8,overcast:5,rain:3,fog:2},durationRounds:5,fixed:false};
  const map=M.compile(doc);map.battlefield={...structuredClone(template.battlefield),facilities,points};
  const issues=M.gameIssues(doc);if(issues.length)throw Error(id+": "+issues.join("; "));
  fs.writeFileSync(path.join(root,"assets/maps/battlefield/"+(basin?"ruined_basin":"twin_ridges")+".json"),JSON.stringify(require("./rebuild-biome-maps.cjs").rebuild(map),null,2)+"\n");
  console.log("Built",id,width+"x"+height,"5v5 (independent faction allies)");
}
generate("ridges");generate("basin");
const catalogPath=path.join(root,"assets/unit-catalog.json");
const catalog=JSON.parse(fs.readFileSync(catalogPath,"utf8"));
for(const file of ["maps/battlefield/twin_ridges.json","maps/battlefield/ruined_basin.json"])
  if(!catalog.maps.includes(file))catalog.maps.push(file);
fs.writeFileSync(catalogPath,JSON.stringify(catalog,null,2)+"\n");
