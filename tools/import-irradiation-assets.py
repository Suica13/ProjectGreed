"""Resize native indexed beam sheets frame by frame, preserving exact colors and alpha.
Uses the standard library only; neither image packages nor runtime helper units are needed.
"""
import struct,zlib
from pathlib import Path
from mod_source import MAIN,ASSETS

def chunk(kind,data):
    body=kind+data
    return struct.pack('>I',len(data))+body+struct.pack('>I',zlib.crc32(body))

def paeth(a,b,c):
    p=a+b-c; da,db,dc=abs(p-a),abs(p-b),abs(p-c)
    return a if da<=db and da<=dc else b if db<=dc else c

def decode(png):
    offset=8; pieces=[]; payload=[]
    while offset<len(png):
        size=struct.unpack_from('>I',png,offset)[0];kind=png[offset+4:offset+8];data=png[offset+8:offset+8+size];offset+=size+12
        if kind==b'IHDR':header=data
        elif kind==b'IDAT':payload.append(data)
        elif kind in (b'PLTE',b'tRNS',b'sRGB',b'gAMA',b'cHRM'):pieces.append((kind,data))
    width,height=struct.unpack_from('>II',header)
    assert header[8:]==bytes([8,3,0,0,0]),'Expected noninterlaced indexed 8-bit native PNG'
    raw=zlib.decompress(b''.join(payload)); pixels=bytearray(width*height)
    for y in range(height):
        kind=raw[y*(width+1)];row=raw[y*(width+1)+1:(y+1)*(width+1)]
        if kind==0:pixels[y*width:(y+1)*width]=row;continue
        for x,value in enumerate(row):
            at=y*width+x;a=pixels[at-1] if x else 0;b=pixels[at-width] if y else 0;c=pixels[at-width-1] if x and y else 0
            predictor={1:a,2:b,3:(a+b)//2,4:paeth(a,b,c)}[kind]
            pixels[at]=(value+predictor)&255
    return width,height,pixels,pieces

def resize(source,target,frames):
    sw,sh,original,palette=decode(source.read_bytes());fw=sw//frames;assert fw*frames==sw
    dw,dh=(fw+1)//2,(sh+1)//2;tw=dw*frames;pixels=bytearray(tw*dh)
    for y in range(dh):
        sy=min(sh-1,int((y+.5)*sh/dh))
        for frame in range(frames):
            for x in range(dw):
                sx=frame*fw+min(fw-1,int((x+.5)*fw/dw))
                pixels[y*tw+frame*dw+x]=original[sy*sw+sx]
    # Try common PNG row predictors and retain the smallest lossless representation.
    candidates=[]
    for kind in (0,1,2):
        raw=bytearray((tw+1)*dh)
        for y in range(dh):
            raw[y*(tw+1)]=kind
            for x in range(tw):
                at=y*tw+x;predictor=(pixels[at-1] if x else 0) if kind==1 else (pixels[at-tw] if y else 0) if kind==2 else 0
                raw[y*(tw+1)+x+1]=(pixels[at]-predictor)&255
        candidates.append(zlib.compress(raw,9))
    header=struct.pack('>IIBBBBB',tw,dh,8,3,0,0,0)
    png=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',header)+b''.join(chunk(k,v)for k,v in palette)+chunk(b'IDAT',min(candidates,key=len))+chunk(b'IEND',b'')
    ow,oh,verified,restored_palette=decode(png)
    assert (ow,oh)==(tw,dh) and verified==pixels and restored_palette==palette,'PNG pixel/alpha verification failed'
    target.write_bytes(png)
    return source.stat().st_size,len(png),sw*sh,tw*dh

if __name__=='__main__':
    totals=[0]*4;root=MAIN/'Resource/Image/Fx/Weapon/Beam'
    for color in ('Pink','Blue','Yellow'):
        for part in ('Start','Mid','End','Charge'):
            source=root/(f'Charge/Image/Beam_Charge_1_{color}.png' if part=='Charge' else f'HighMegaCannon/Image/HighMegaCannon_1_{part}_{color}.png')
            result=resize(source,ASSETS/f'effects/textures/Irradiation_{part}_{color}.png',12 if part=='Charge' else 28)
            totals=[a+b for a,b in zip(totals,result)]
    print(f'12 alpha-preserving indexed sheets: {totals[0]} -> {totals[1]} bytes; decoded pixels {totals[2]} -> {totals[3]}')
