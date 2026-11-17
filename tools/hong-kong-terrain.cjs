/* Native HK street tiles and building decals become cached decorative tile layers. */
const fs=require('node:fs'),path=require('node:path'),M=require('../shared/map-document');
const directory=path.resolve(__dirname,'../assets/maps/missions/hong-kong-native');
function repaint(map) {
 const source=JSON.parse(fs.readFileSync(path.join(directory,'source.json'),'utf8'));
 const doc=structuredClone(map.tileMap),w=map.width,h=map.height;
 doc.tilesets=[];doc.tiles=[];doc.layers=[];doc.rules=[];delete doc.biomeStyle;
 const png=name=>'data:image/png;base64,'+fs.readFileSync(path.join(directory,name)).toString('base64');
 const layer=(id,name,decorative,opacity=1)=>({id,name,type:'tile',placement:'below',decorative,dynamic:false,visible:true,opacity,data:Array(w*h).fill(null)});
 doc.tilesets.push({id:'hk-street',name:'原MOD香港城市图集',image:png(source.atlas.image),width:200,height:200,tileWidth:10,tileHeight:10,margin:0,spacing:0});
 function ground(id,index,terrain) {
  doc.tiles.push({id,name:id,tilesetId:'hk-street',x:index%20*10,y:Math.floor(index/20)*10,
    terrain,environment:'ground',color:terrain==='plain'?'#4b4549':'#51474a',decorative:false,dynamic:false});
  return id;
 }
 const street=ground('hk-asphalt',60,'plain'),vertical=ground('hk-lane-vertical',2,'plain'),horizontal=ground('hk-lane-horizontal',22,'plain');
 const sidewalk=ground('hk-sidewalk',141,'rubble'),paving=ground('hk-paving',161,'rubble');
 const base=layer('hong-kong-ground','香港街道与街区地面',false);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
  const avenue=[9,22,35].includes(y),crossing=[10,21,32,43].includes(x);
  base.data[y*w+x]=map.tiles[y][x]==='plain'?(avenue&&!crossing?horizontal:crossing&&!avenue?vertical:street):((x+y)%3?sidewalk:paving);
 }
 const shadow=layer('hong-kong-shadows','楼宇静态阴影',true,0.28);
 doc.tiles.push({id:'hk-shadow',name:'楼宇阴影',tilesetId:'hk-street',x:50,y:130,terrain:'rubble',environment:'ground',color:'#17151a',decorative:true,dynamic:false});
 const buildings=layer('kowloon-buildings','原MOD香港楼宇、商铺与残损街区',true);
 const fire=layer('hong-kong-fire','原MOD火焰静态帧',true,0.85);
 const placements=[];
 const definitions=new Map();
 for(const b of source.buildings) {
  M.addTileset(doc,{id:b.id,name:'原MOD '+b.id,image:png(b.image),width:b.width,height:b.height,tileWidth:10,tileHeight:10});
  for(const t of doc.tiles.filter(t=>t.tilesetId===b.id)){t.decorative=true;t.terrain='rubble';definitions.set(`${b.id}:${t.x/10}:${t.y/10}`,t.id)}
 }
 const fx=source.fire;
 doc.tilesets.push({id:'hk-fire',name:'原MOD受损燃烧',image:png(fx.image),width:fx.width,height:fx.height,tileWidth:fx.width/fx.frames,tileHeight:fx.height,margin:0,spacing:0});
 doc.tiles.push({id:'hk-fire-frame',name:'燃烧静态帧',tilesetId:'hk-fire',x:fx.width/fx.frames,y:0,terrain:'rubble',environment:'ground',color:'#ef852f',decorative:true,dynamic:false});
 let serial=0;
 for(const y of [1,12,17,25,30,38])for(const block of [11,22,33])for(const offset of [0,5]) {
  const x=block+offset;
  // The native 4x decal scale is reduced with the map (160 world units -> 4 cells).
  const candidates=source.buildings.filter(b=>y+b.height/10<=h && x+b.width/10<=w &&
    Array.from({length:b.height/10},(_,dy)=>Array.from({length:b.width/10},(_,dx)=>map.tiles[y+dy][x+dx]!=='plain')).flat().every(Boolean));
  if(!candidates.length)continue;
  const b=candidates[serial%candidates.length],bw=b.width/10,bh=b.height/10,damaged=serial%5===3,burning=serial%6===2;
  placements.push({id:b.id,x,y,width:bw,height:bh,damaged,burning});
  for(let dy=0;dy<bh;dy++)for(let dx=0;dx<bw;dx++) {
   const target=(y+dy)*w+x+dx;
   if(!damaged || dx<Math.ceil(bw/2) || dy>=Math.ceil(bh/2))buildings.data[target]=definitions.get(`${b.id}:${dx}:${dy}`);
   if(y+dy+1<h && x+dx+1<w && map.tiles[y+dy+1][x+dx+1]!=='plain')shadow.data[(y+dy+1)*w+x+dx+1]='hk-shadow';
  }
  if(burning)fire.data[(y+Math.floor(bh/2))*w+x+Math.floor(bw/2)]='hk-fire-frame';
  serial++;
 }
 doc.layers=[base,shadow,buildings,fire];
 doc.nativeSource={map:source.source,sha256:source.sha256,buildingWorldScale:0.5,buildings:placements};
 const result=M.compile(doc);
 result.mission=map.mission;result.tileMap.mission=map.mission;
 result.appearance={biome:'urban',colors:{plain:'#4b4549',rubble:'#51474a'}};
 return result;
}
module.exports={repaint};
