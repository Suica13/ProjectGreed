import base64,json,re,sys
from pathlib import Path
sys.path.insert(0,str(Path.cwd()/'tools'))
from mod_source import MAIN,ROOT,MOD,load,resolve,section,number
rows=[
 ('hq','HQ',ROOT/'Units/Buildings/HQ/Mod/HQ.ini'),
 ('factory','工厂',ROOT/'Units/Buildings/Factory/Faction/EFSF_0079/Factory_EFSF_0079_Land.ini'),
 ('giantFactory','巨型工厂',ROOT/'Units/Buildings/Factory/Faction/EFSF_0079/Factory_EFSF_0079_Mega.ini'),
 ('beacon','信标',MAIN/'Units/Buildings/Beacon_ACE/Mod/Beacon_ACE.ini'),
 ('academy','士官学院',MAIN/'Units/Buildings/Academy/Common/Academy_Common_T1.ini')
]
out={}
for key,name,path in rows:
 d=load(path);c=d['core'];fp=list(map(int,c.get('footprint','0,0,0,0').split(',')));layers=[]
 for title in d:
  if not title.startswith('decal_') or any(t in title.lower() for t in ['shadow','range','icon','line','select','text']):continue
  s=section(d,title)
  if not s.get('image') or s.get('isVisible','').lower()=='false':continue
  try:
   image=resolve(s['image'],path.parent)
   if not image.is_file() or '/Units/Buildings/' not in image.as_posix():continue
   if any(l['source']==image.relative_to(MOD).as_posix() for l in layers):continue
   layers.append(dict(src='data:image/png;base64,'+base64.b64encode(image.read_bytes()).decode(),scale=number(s.get('imageScale',1),d),x=number(s.get('xOffsetAbsolute',0),d),y=number(s.get('yOffsetAbsolute',0),d),order=number(s.get('order',0),d),source=image.relative_to(MOD).as_posix()))
  except (ValueError,KeyError):continue
 if not layers:
  s=d.get('graphics',{});image=resolve(s.get('image',''),path.parent)
  if image.is_file() and 'blank' not in image.name.lower():layers=[dict(src='data:image/png;base64,'+base64.b64encode(image.read_bytes()).decode(),scale=number(s.get('imageScale',1),d),x=0,y=0,order=0,source=image.relative_to(MOD).as_posix())]
 if not layers and key=='beacon':
  image=MAIN/'Units/Buildings/Beacon_ACE/Image/Beacon_ACE_1.png'
  layers=[dict(src='data:image/png;base64,'+base64.b64encode(image.read_bytes()).decode(),scale=1,x=0,y=0,order=0,source=image.relative_to(MOD).as_posix())]
 if not layers:raise ValueError('No art '+key)
 def cost(field):
  native=re.search(r'@global\s+'+field+r'\s*=\s*(\d+)',path.read_text(encoding='utf-8-sig'))
  if native:return int(native[1])
  m=re.search(r'\b'+field+r'\s*=\s*(\d+)',c.get('price',''),re.I)
  return int(m[1]) if m else int(float(c.get('@define '+field,0)))
 out[key]=dict(name=name,width=fp[2]-fp[0]+1,height=fp[3]-fp[1]+1,anchorX=-fp[0],anchorY=-fp[1],nativeCell=20,source=path.relative_to(MOD).as_posix(),cost=dict(money=cost('Money')*2,supplies=cost('Resource')*2),layers=sorted(layers,key=lambda x:x['order']))
out={key:{field:value[field] for field in ('name','source','layers')} for key,value in out.items()}
Path('shared/base-facility-types.json').write_text(json.dumps(out,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
print([(key,len(value['layers'])) for key,value in out.items()])
