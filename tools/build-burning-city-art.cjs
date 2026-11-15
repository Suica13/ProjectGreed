/* Deterministic pixel city overlay; no runtime drawing or random regeneration. */
const fs=require('node:fs'),zlib=require('node:zlib');
function cityArt(file,cells=45){
  const unit=32,w=cells*unit,h=w,pixels=Buffer.alloc(w*h*4);
  function rect(x,y,ww,hh,color){
    const rgba=color.match(/../g).map(v=>parseInt(v,16));if(rgba.length===3)rgba.push(255);
    for(let yy=Math.max(0,Math.floor(y));yy<Math.min(h,y+hh);yy++)for(let xx=Math.max(0,Math.floor(x));xx<Math.min(w,x+ww);xx++){
      const i=(yy*w+xx)*4;for(let k=0;k<4;k++)pixels[i+k]=rgba[k];
    }
  }
  const hash=(x,y)=>(Math.imul(x+5,73856093)^Math.imul(y+17,19349663))>>>0;
  // Three-cell avenues share the same ground footprint as the mission terrain.
  for(const y of [9,22,35]){
    rect(0,(y-1)*unit,w,3*unit,'303a42');
    rect(0,(y-1)*unit,w,3,'71818a');rect(0,(y+2)*unit-3,w,3,'71818a');
    for(let x=0;x<w;x+=22)rect(x,y*unit+15,10,2,'c3b37b');
  }
  for(const x of [9,20,31,42]){
    rect(x*unit,0,2*unit,h,'303a42');
    rect(x*unit,0,2,h,'71818a');rect((x+2)*unit-2,0,2,h,'71818a');
    for(let y=0;y<h;y+=22)rect((x+1)*unit,y,2,10,'b4ad87');
  }
  for(const y of [2,5,15,18,28,31,41])for(const x of [12,15,18,23,26,29,34,37,40]){
    const seed=hash(x,y),xx=x*unit,yy=y*unit,ww=(2+((seed>>>10)%2))*unit-8,hh=(y===41?2:2+((seed>>>7)%3))*unit-10;
    const ruined=(seed>>>8)%3===0,burning=(seed>>>4)%4===0;
    // Roofs, facade windows, debris and fires scale together relative to a cell.
    const scale=.65;
    const buildingRect=(x,y,w,h,color)=>rect(xx+(x-xx)*scale,yy+(y-yy)*scale,w*scale,h*scale,color);
    buildingRect(xx+10,yy+13,ww+4,hh+5,'090f17a0');
    buildingRect(xx+3,yy+12,ww,hh,'37434c');
    buildingRect(xx,yy,ww,hh-10,ruined?'505054':'5f6b73');
    buildingRect(xx+4,yy+4,ww-8,hh-18,'4a5862');
    buildingRect(xx+7,yy+7,ww-14,3,'748089');
    buildingRect(xx+10,yy+15,ww/3,hh/3,'394650');
    buildingRect(xx+ww-22,yy+12,12,18,'839097');
    // A lit street-facing facade and shopfronts remain visible at night.
    for(let wy=yy+hh-7;wy<yy+hh+9;wy+=6)for(let wx=xx+8;wx<xx+ww-5;wx+=10){
      if(hash(wx,wy)%4===0)continue;
      buildingRect(wx,wy,5,3,hash(wx,wy)%3===0?'82b7be':'f5d98d');
    }
    buildingRect(xx+6,yy+hh+5,18,4,'a95b55');buildingRect(xx+31,yy+hh+5,20,4,'527e8c');
    if(ruined){
      buildingRect(xx+ww/2,yy+3,ww/2-3,hh/2,'222e37');
      for(let i=0;i<12;i++){
        const rx=xx+(i*17)%ww,ry=yy+(i*23)%hh;
        buildingRect(rx,ry,6+i%5,4+i%3,'788078');
      }
    }
    if(burning){
      for(let i=0;i<6;i++){
        const fx=xx+13+i*9,fy=yy+hh/2;
        buildingRect(fx-3,fy-5-i%3*4,10,20,'a9462d');
        buildingRect(fx,fy-9-i%2*8,5,19,'f79443');buildingRect(fx+1,fy+1,3,9,'ffe3a1');
      }
      for(let i=0;i<5;i++)buildingRect(xx+ww/2+i*3,yy-i*9,18-i,8,'30343bb0');
    }
  }
  const crc=b=>{let c=0xffffffff;for(const v of b){c^=v;for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(type,data)=>{const tag=Buffer.from(type),len=Buffer.alloc(4),sum=Buffer.alloc(4);len.writeUInt32BE(data.length);sum.writeUInt32BE(crc(Buffer.concat([tag,data])));return Buffer.concat([len,tag,data,sum]);};
  const head=Buffer.alloc(13);head.writeUInt32BE(w);head.writeUInt32BE(h,4);head[8]=8;head[9]=6;
  const raw=Buffer.alloc(h*(w*4+1));for(let y=0;y<h;y++)pixels.copy(raw,y*(w*4+1)+1,y*w*4,(y+1)*w*4);
  fs.writeFileSync(file,Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',head),chunk('IDAT',zlib.deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
}
module.exports={cityArt};
