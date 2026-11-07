"use strict";
// Rebuild only the dedicated battlefield map; keep SL assets and mode parameters.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const M = require("../shared/map-document.js");
const destination = path.resolve(__dirname, "../assets/maps/battlefield/frontline.json");
const previous = JSON.parse(fs.readFileSync(destination, "utf8"));
const width = 72, height = 48, cell = 32;
const mirror = ([x, y]) => [width - 1 - x, height - 1 - y];
const leftMesa = [[3,4],[16,4],[19,8],[19,25],[15,31],[3,31]];
const centralMesa = [[27,13],[40,11],[48,18],[47,30],[44,34],[31,36],[23,29],[24,17]];
const innerMesa = [[31,19],[38,18],[41,21],[40,27],[38,29],[33,30],[30,27],[30,21]];
const southwestHill = [[5,37],[10,34],[16,35],[19,39],[17,44],[7,44]];
const southwestKnoll = [[21,40],[24,40],[25,43],[21,44],[20,42]];
function inside(x, y, polygon) {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [ax, ay] = polygon[i], [bx, by] = polygon[j];
    if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) result = !result;
  }
  return result;
}
const elevation = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => {
  if (inside(x+.5,y+.5,innerMesa)) return 2;
  return [leftMesa,southwestHill,southwestKnoll].some(polygon =>
    inside(x+.5,y+.5,polygon) || inside(width-x-.5,height-y-.5,polygon)) ||
    inside(x+.5,y+.5,centralMesa) ? 1 : 0;
}));
const directions = [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8]];
function cliffMask(x,y) {
  return directions.reduce((mask,[dx,dy,bit]) => mask | ((elevation[y+dy]?.[x+dx] ?? 0) < elevation[y][x] ? bit : 0), 0);
}
function ramp(x,y) {
  // Wide traversable gates through the cliff belts: two base exits and four central approaches.
  return (x <= 20 && y >= 18 && y <= 22) || (x >= 51 && y >= 25 && y <= 29) ||
    (x >= 21 && x <= 50 && y >= 22 && y <= 25) ||
    (x >= 34 && x <= 37 && y >= 9 && y <= 38);
}
const variants = [];
for (const terrain of ["plain","highland","rock","rubble","forest"])
  for (let variant=0;variant<4;variant++) variants.push({ id:terrain+"_"+variant, terrain, variant });
for (let mask=1;mask<16;mask++) variants.push({ id:"cliff_"+mask, terrain:"rock", mask });
for (let variant=0;variant<4;variant++) variants.push({ id:"ramp_"+variant, terrain:"highland", variant, ramp:true });
for (let variant=0;variant<4;variant++) variants.push({id:"upper_"+variant,terrain:"highland",variant,upper:true});
for (let mask=1;mask<16;mask++) variants.push({id:"upper_cliff_"+mask,terrain:"rock",mask,upper:true});
for (let variant=0;variant<4;variant++) variants.push({id:"upper_ramp_"+variant,terrain:"highland",variant,ramp:true,upper:true});
for (const decoration of ["stones","scrub","ruin"]) variants.push({id:"decor_"+decoration,terrain:"plain",decoration});
const colors = { forest:[91,105,73], plain:[125,126,91],highland:[159,145,112],rock:[78,73,62],rubble:[128,117,91] };
const atlasWidth = cell*8, atlasHeight = cell*Math.ceil(variants.length/8);
const pixels = Buffer.alloc((atlasWidth*4+1)*atlasHeight);
function setPixel(x,y,rgb) {
  const at=y*(atlasWidth*4+1)+1+x*4;
  for(let c=0;c<3;c++) pixels[at+c]=Math.max(0,Math.min(255,Math.round(rgb[c])));
  pixels[at+3]=255;
}
variants.forEach((tile,index) => {
  for(let y=0;y<cell;y++) for(let x=0;x<cell;x++) {
    const noise=((x*37+y*53+(tile.variant||0)*79+x*y*13)%19)-9;
    const groundColor=tile.upper?[184,175,146]:colors[tile.terrain];
    let rgb=groundColor.map(c=>c+noise*.55);
    if(tile.terrain==="forest") {
      const patch=(x-16)**2+(y-18)**2;
      if(patch<110) rgb=rgb.map(c=>c-13);
    }
    if(tile.terrain==="highland") {
      const seam=(x+Math.floor(y/7)*5+(tile.variant||0)*9)%31;
      if(seam===0 && y>7 && y<27) rgb=rgb.map(c=>c-17);
    }
    if(tile.mask) {
      const edges=[[y,1],[31-x,2],[31-y,4],[x,8]].filter(([,bit])=>tile.mask&bit);
      const distance=Math.min(...edges.map(([d,bit])=>d +
        Math.round(Math.sin((bit===1||bit===4?x:y)*.45)*1.5)));
      // A dark outer foot, stratified rock face and a light upper lip make the
      // plateau read as elevated ground rather than a masonry perimeter wall.
      if(distance<3) rgb=[55+noise*.3,50+noise*.3,39+noise*.3];
      else if(distance<11) {
        const strata=(y+Math.floor(x/11)*2)%6<2?-12:5;
        rgb=[108+strata+noise*.6,91+strata+noise*.6,65+strata+noise*.6];
      } else if(distance<14) rgb=[179+noise*.5,163+noise*.5,125+noise*.5];
      else rgb=(tile.upper?[184,175,146]:colors.highland).map(c=>c+noise*.55);
    }
    if(tile.ramp) {
      const tone=(y%7<2?-9:7)+noise*.45;
      rgb=(tile.upper?[174,161,127]:[146,132,99]).map(c=>c+tone);
    }
    if(tile.decoration) {
      const stone=(x-12)**2/45+(y-18)**2/15<1 || (x-22)**2/16+(y-23)**2/8<1;
      const scrub=(x-16)**2+(y-15)**2<36 || (x-11)**2+(y-19)**2<22 || (x-21)**2+(y-20)**2<25;
      const ruin=((x>8&&x<12&&y>8&&y<25)||(y>20&&y<25&&x>8&&x<25)) && (x+y)%11>1;
      if(!(tile.decoration==="stones"?stone:tile.decoration==="scrub"?scrub:ruin)) continue;
      rgb=(tile.decoration==="scrub"?[83,96,56]:tile.decoration==="ruin"?[105,103,86]:[104,100,85]).map(c=>c+noise*.8+(y<18?15:-10));
    }
    setPixel(index%8*cell+x,Math.floor(index/8)*cell+y,rgb);
  }
});
const crcTable=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function chunk(name,data) {
  const body=Buffer.concat([Buffer.from(name),data]);let crc=0xffffffff;
  for(const byte of body)crc=crcTable[(crc^byte)&255]^(crc>>>8);
  const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);body.copy(out,4);out.writeUInt32BE((crc^0xffffffff)>>>0,out.length-4);return out;
}
const header=Buffer.alloc(13);header.writeUInt32BE(atlasWidth);header.writeUInt32BE(atlasHeight,4);header[8]=8;header[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",zlib.deflateSync(pixels)),chunk("IEND",Buffer.alloc(0))]);
const terrain = Array.from({length:height},()=>Array(width).fill("plain"));
const data=[];
for(let y=0;y<height;y++) for(let x=0;x<width;x++) {
  const variant=(x*3+y*7)%4;
  let id;
  if(x<2||x>=width-2||y<2||y>=height-2) {terrain[y][x]="rock";id="rock_"+variant;}
  else if(elevation[y][x]) {
    const mask=cliffMask(x,y);
    terrain[y][x]=mask&&!ramp(x,y)?"rock":"highland";
    id=(elevation[y][x]===2?"upper_":"")+(mask?(ramp(x,y)?"ramp_"+variant:"cliff_"+mask):(elevation[y][x]===2?String(variant):"highland_"+variant));
  } else id="plain_"+variant;
  // Scrub and rubble are real terrain; sparse visual props are added separately.
  const patches=[[18,34,3,2,"forest"],[22,8,2,2,"rubble"],[32,40,2,1,"forest"],[32,22,2,2,"rubble"]];
  for(const [cx,cy,rx,ry,type] of patches) {
    const near=(px,py)=>(px-cx)**2/(rx*rx)+(py-cy)**2/(ry*ry)<1;
    if((near(x,y)||near(width-1-x,height-1-y)) && ["plain","highland"].includes(terrain[y][x]) && !ramp(x,y)) {
      terrain[y][x]=type;id=type+"_"+variant;
    }
  }
  data.push(id);
}
const spawns=[],deploymentAreas=[];
for(let position=0;position<5;position++) for(const team of [0,1]) {
  const point=team?mirror([11,10+position*4]):[11,10+position*4];
  spawns.push({team,position:position+1,x:point[0],y:point[1]});
  deploymentAreas.push(team?{x:55,y:19,width:13,height:22}:{x:4,y:7,width:13,height:22});
}
const facilities=[];
for(const team of [0,1]) for(const [type,x,y] of [["base",7,16],["machineGun",15,14],["beam",15,24],["missile",6,10],["cannon",6,25],["radar",5,20]]) {
  const size=type==="base"?3:1;
  facilities.push({id:team+"-"+type,type,team,x:team?width-x-size:x,y:team?height-y-size:y});
}
const points=[[1,28,19],[2,28,38],[4,43,28],[5,43,9]].map(([id,x,y])=>({id:"point-"+id,name:"据点 "+id,x,y}));
const doc=M.create({id:previous.id,name:"战地 · 环峡高地",description:"环形平原围绕双层中央高地，西南与东北散布丘陵，双方基地位于左右高地；从坡口出击，争夺1、2、4、5号据点。",width,height,playersPerTeam:5,environment:"ground",supportedModes:["battlefield"]});
doc.spawns=spawns;doc.deploymentAreas=deploymentAreas;
doc.tilesets=[{id:"canyon_atlas",name:"峡谷地表与崖壁",image:"data:image/png;base64,"+png.toString("base64"),width:atlasWidth,height:atlasHeight,tileWidth:cell,tileHeight:cell,margin:0,spacing:0}];
doc.tiles=variants.map((tile,index)=>({id:tile.id,name:tile.id,terrain:tile.terrain,environment:"ground",color:"#"+colors[tile.terrain].map(v=>v.toString(16).padStart(2,"0")).join(""),tilesetId:"canyon_atlas",x:index%8*cell,y:Math.floor(index/8)*cell,decorative:!!tile.decoration,dynamic:false}));
doc.layers[0].id="canyon_ground";doc.layers[0].name="峡谷地形与坡口";doc.layers[0].data=data;
const props=Array(width*height).fill(null);
for(let y=3;y<height-3;y++) for(let x=3;x<width-3;x++) {
  const hash=(x*73856093^y*19349663)>>>0;
  if(hash%43 || !["plain","highland","rubble","forest"].includes(terrain[y][x]) || ramp(x,y)) continue;
  if(deploymentAreas.some(area=>x>=area.x-1&&y>=area.y-1&&x<area.x+area.width+1&&y<area.y+area.height+1)) continue;
  if([...facilities,...points].some(site=>Math.abs(site.x-x)+Math.abs(site.y-y)<4)) continue;
  props[y*width+x]=["decor_stones","decor_scrub","decor_ruin"][hash%3];
}
doc.layers.push({id:"canyon_props",name:"岩石、灌木与遗迹",type:"tile",placement:"below",decorative:true,dynamic:false,visible:true,opacity:1,data:props});
doc.surfaceCover=true;
doc.climate={weather:{allowed:["clear","overcast","sand"],weights:{clear:14,overcast:3,sand:2},durationRounds:5,fixed:false},time:{allowed:["dawn","morning","noon","afternoon","dusk","evening","late_night","pre_dawn"],durationRounds:5,fixed:false}};
doc.lighting=previous.lighting;
const compiled=M.compile(doc);
compiled.battlefield={...previous.battlefield,facilities,points};
fs.writeFileSync(destination,JSON.stringify(compiled,null,2)+"\n");
console.log("Rebuilt canyon battlefield:",width+"x"+height,"/",points.length,"capture sites");
