/* Repaint the compact playable map from the original BO2 atlas and ground layout. */
const fs=require('node:fs'),path=require('node:path'),M=require('../shared/map-document');
const directory=path.resolve(__dirname,'../assets/maps/missions/shuttle-native');
function repaint(map,pads) {
  const source=JSON.parse(fs.readFileSync(path.join(directory,'source.json'),'utf8'));
  const native=source.groundRuns.flatMap(([gid,count])=>Array(count).fill(gid));
  const doc=structuredClone(map.tileMap),w=map.width,h=map.height;
  doc.tilesets=[];doc.tiles=[];doc.layers=[];doc.rules=[];
  delete doc.biomeStyle;
  const set='bo2_shuttle';
  M.addTileset(doc,{id:set,name:'BO2 原版发射场',image:'data:image/png;base64,'+fs.readFileSync(path.join(directory,'tile_1.png')).toString('base64'),
    width:source.imageWidth,height:source.imageHeight,tileWidth:source.tileWidth,tileHeight:source.tileHeight});
  const tileId=gid=>`${set}_${((gid-1)%10)*10}_${Math.floor((gid-1)/10)*10}`;
  const water=new Set([51,53,55,67,68,69,70,71,73,75,77,78,79,80,81,85,91,93,95]);
  const road=new Set([21,22,23,24,25,26,27,28,29,31,32,34,35,36,37,38,39]);
  const classify=gid=>water.has(gid)?'water':road.has(gid)?'road':'plain';
  for(const tile of doc.tiles) {
    const gid=tile.y/10*10+tile.x/10+1;
    tile.nativeTerrain=classify(gid);
    tile.terrain=classify(gid)==='water'?'water':'plain';
    tile.color=classify(gid)==='road'?'#657078':classify(gid)==='water'?'#365866':'#42573d';
  }
  const kinds=[],samples=[];
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const counts={water:0,road:0,plain:0};
    const x0=Math.floor(x*source.width/w),x1=Math.floor((x+1)*source.width/w);
    const y0=Math.floor(y*source.height/h),y1=Math.floor((y+1)*source.height/h);
    for(let yy=y0;yy<y1;yy++)for(let xx=x0;xx<x1;xx++)counts[classify(native[yy*source.width+xx])]++;
    const total=(x1-x0)*(y1-y0);
    kinds.push(counts.water/total>=0.5?'water':counts.road/total>=0.3?'road':'plain');
    samples.push(native[Math.floor((y0+y1)/2)*source.width+Math.floor((x0+x1)/2)]);
  }
  // Keep the three scripted 5x5 shuttle pads and the shared player area usable.
  for(const [px,py] of pads)for(let y=py;y<py+5;y++)for(let x=px;x<px+5;x++)kinds[y*w+x]='road';
  for(const area of doc.deploymentAreas.filter((_,i)=>doc.spawns[i].team===0))
    for(let y=area.y;y<area.y+area.height;y++)for(let x=area.x;x<area.x+area.width;x++)
      if(kinds[y*w+x]==='water')kinds[y*w+x]='plain';
  // Thin native diagonal taxiways must remain continuous after grid reduction.
  for(const [x0,y0,x1,y1] of [[23,17,31,23],[23,32,31,26]]) {
    const steps=Math.max(Math.abs(x1-x0),Math.abs(y1-y0));
    for(let i=0;i<=steps;i++) {
      const x=Math.round(x0+(x1-x0)*i/steps),y=Math.round(y0+(y1-y0)*i/steps);
      for(const dx of [0,1])for(const dy of [0,1])kinds[(y+dy)*w+x+dx]='road';
    }
  }
  const at=(x,y)=>x<0||y<0||x>=w||y>=h?null:kinds[y*w+x];
  const data=kinds.map((kind,i)=>{
    const x=i%w,y=Math.floor(i/w),sample=samples[i];let gid=sample;
    if(kind==='road') {
      gid=at(x,y-1)!=='road'?31:at(x,y+1)!=='road'?35:at(x-1,y)!=='road'?21:at(x+1,y)!=='road'?25:23;
    }else if(kind==='water')gid=water.has(sample)?sample:73;
    else if(classify(sample)!=='plain')gid=1;
    return tileId(gid);
  });
  doc.layers=[{id:'native_ground',name:'原版海岸与发射场',type:'tile',placement:'below',decorative:false,dynamic:false,visible:true,opacity:1,data}];
  doc.nativeSource={map:source.source,sha256:source.sha256,width:source.width,height:source.height};
  // Recompile collision/terrain from these same native tiles; art and gameplay agree.
  const result=M.compile(doc);
  result.mission=map.mission;result.tileMap.mission=map.mission;
  result.appearance={biome:'wetland',colors:{plain:'#42573d',water:'#365866'}};
  return result;
}
module.exports={repaint};
