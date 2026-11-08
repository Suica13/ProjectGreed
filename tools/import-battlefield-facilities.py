import base64,copy,json,re,shutil,struct,sys,zlib
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from mod_source import MOD,MAIN,ROOT,ASSETS,load,resolve,section
from weapon_store import loads,dumps
ROWS=[('HQ','主基地',ROOT/'Units/Buildings/HQ/Mod/HQ.ini','base'),('MG','机枪炮塔',MAIN/'Units/Buildings/Turret/TypeA/Turret_MG_A.ini','machineGun'),('Beam','光束炮塔',MAIN/'Units/Buildings/Turret/TypeA/Turret_BM_A.ini','beam'),('Missile','导弹炮塔',MAIN/'Units/Buildings/Turret/TypeA/Turret_MS_A.ini','missile'),('Cannon','加农炮炮塔',MAIN/'Units/Buildings/Turret/TypeA/Turret_CN_A.ini','cannon'),('Radar','雷达',MAIN/'Units/Buildings/Turret/TypeA/Turret_Radar_A.ini','radar')]
def visible_bounds(path):
 """Read native 8-bit RGBA/indexed alpha without adding an image dependency."""
 png=path.read_bytes(); offset=8; payload=[]; transparency=b''
 while offset<len(png):
  size=struct.unpack_from('>I',png,offset)[0]
  kind=png[offset+4:offset+8]; data=png[offset+8:offset+8+size]; offset+=size+12
  if kind==b'IHDR': header=data
  elif kind==b'IDAT': payload.append(data)
  elif kind==b'tRNS': transparency=data
 width,height,depth,color,compression,filtering,interlace=struct.unpack('>IIBBBBB',header)
 assert depth==8 and color in (3,6) and interlace==0, 'Unsupported native PNG: '+str(path)
 channels=4 if color==6 else 1; stride=width*channels
 raw=zlib.decompress(b''.join(payload)); previous=bytearray(stride); bounds=[width,height,0,0]
 for y in range(height):
  row=bytearray(raw[y*(stride+1)+1:(y+1)*(stride+1)]); kind=raw[y*(stride+1)]
  for x in range(stride):
   a=row[x-channels] if x>=channels else 0; b=previous[x]; c=previous[x-channels] if x>=channels else 0
   prediction=a+b-c; distances=[abs(prediction-a),abs(prediction-b),abs(prediction-c)]
   paeth=(a,b,c)[distances.index(min(distances))]
   row[x]=(row[x]+(0,a,b,(a+b)//2,paeth)[kind])&255
  for x in range(width):
   alpha=row[x*4+3] if color==6 else (transparency[row[x]] if row[x]<len(transparency) else 255)
   if alpha:
    bounds=[min(bounds[0],x),min(bounds[1],y),max(bounds[2],x+1),max(bounds[3],y+1)]
  previous=row
 assert bounds[2]>bounds[0] and bounds[3]>bounds[1], 'Empty facility image: '+str(path)
 return width,height,bounds

def fit_facility(u,dest,kind):
 # Fit visible artwork, not transparent PNG padding, to the occupied map cells.
 extents=[]
 for layer in u['layers']:
  width,height,bounds=visible_bounds(dest/layer['texture']); scale=layer['scale']
  bone=u['skeleton'][layer['bone']]; offset=layer.get('worldOffset',{})
  x=bone['x']+offset.get('x',0); y=-bone['y']+offset.get('y',0)
  extents.append([(bounds[0]-width/2)*scale+x,(bounds[1]-height/2)*scale+y,
                  (bounds[2]-width/2)*scale+x,(bounds[3]-height/2)*scale+y])
 bounds=[min(e[0] for e in extents),min(e[1] for e in extents),max(e[2] for e in extents),max(e[3] for e in extents)]
 # Ground bases/turrets stay fixed; only their independent turret bones aim.
 center=[(bounds[0]+bounds[2])/2,(bounds[1]+bounds[3])/2]
 for layer in u['layers']:
  offset=layer.setdefault('worldOffset',{'x':0,'y':0})
  offset['x']-=center[0]; offset['y']-=center[1]
 presentation=json.loads((ASSETS/'presentation.json').read_text(encoding='utf-8'))
 cells=3 if kind=='base' else 1 if kind=='radar' else .5
 u['presentation']['mapScale']=cells*160*presentation['mapCellScale']/(presentation['unitMapScale']*max(bounds[2]-bounds[0],bounds[3]-bounds[1]))
 u['presentation']['idle']='ImportedIdle'
 u['presentation']['fixedFacing']=0
 u['sourceStats']['visual']={'nativeBounds':bounds,'targetCells':cells,'mapScale':u['presentation']['mapScale'],
   'layers':[{'name':layer['name'],'source':layer['source']} for layer in u['layers']]}

def import_points():
 source=ROOT/'Units/Buildings/StrategicLocation/Mod/StrategicLocation.ini'
 data=load(source); config={}
 for name,key in [('pointIcon','decal_Body'),('pointHighlight','decal_Light_Self')]:
  image=resolve(section(data,key)['image'],source.parent)
  config[name]='data:image/png;base64,'+base64.b64encode(image.read_bytes()).decode('ascii')
  config[name+'Source']=image.relative_to(MOD).as_posix()
 path=ASSETS/'maps/battlefield/frontline.json'; document=json.loads(path.read_text(encoding='utf-8'))
 document['battlefield'].update(config)
 path.write_text(json.dumps(document,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
 return {'id':'StrategicLocation','source':source.relative_to(MOD).as_posix(),
         'body':config['pointIconSource'],'highlight':config['pointHighlightSource']}

def build(suffix,name,source,kind):
 d=load(source); uid='Facility_'+suffix
 template=loads((ASSETS/'units/Type61/unit.json').read_text(encoding='utf-8'))
 u={k:copy.deepcopy(template[k]) for k in ['schemaVersion','stats','shield','defenses','attackBonuses','presentation'] if k in template}
 u.update(id=uid,code=uid,name=name,description='通用战场设施',source=source.relative_to(MOD).as_posix(),tags=['EFSF','0079T1'],availableFactions=['EFSF','ZEON','AEUG','TITANS','NEO_ZEON'],unitTags=['Building','LargeUnit' if kind=='base' else 'MediumUnit'],formOnly=True,facility={'type':kind},production={'enabled':False},skeleton={**copy.deepcopy(template['skeleton']),'Turret':{'x':0,'y':3}},materials={'textures':{},'icon':''},layers=[],weapons={},animations=copy.deepcopy(template['animations']),skills=[],transport={'slotCost':1,'loadTags':[]},weaponKits=[{'id':'standard','name':'标准套件','cost':0,'weapons':[]}],mechanics=[{'id':'facility','name':'通用战场设施','status':'implemented'}])
 hp=int(d['core']['maxHp']);u['stats'].update(hp=hp//2,en=1000,move=0,speed=100,mobility=25,deployed=True,cost={'base':2000,'machineGun':250,'beam':500,'missile':350,'cannon':400,'radar':250}[kind],facilityType=kind,partsBreakable=False,visualTurrets=[],sensors={'sight':12 if kind=='radar' else 8,'radar':24 if kind=='radar' else 8,'antiDetection':0,'revealOnDetection':kind=='radar','antiDetect':kind=='radar','stealth':False,'stealthAqua':False,'antiDetectAqua':False})
 if kind=='base':u['stats']['footprint']={'width':3,'height':3}
 u['sourceStats']={'nativeHP':hp,'facilitySource':u['source'],'conversion':'HP and projectile payload / 2, followed by global conversion; turn volleys MG8 / Beam2 / Missile4 / Cannon1'}
 dest=ASSETS/'units'/uid/'textures';dest.mkdir(parents=True,exist_ok=True)
 selected=['decal_Body','decal_Light'] if kind=='base' else [key for key in d if re.fullmatch(r'decal_[A-Z]',key)]
 for key in selected:
  if key not in d:continue
  decal=section(d,key)
  if 'image' not in decal:continue
  image=resolve(decal['image'],source.parent);shutil.copy2(image,dest/image.name)
  u['materials']['textures'][image.name]='textures/'+image.name
  u['materials']['icon']=u['materials']['icon'] or image.name
  turret=decal.get('basePositionFromTurret')
  if turret:
   mount=section(d,'turret_'+turret)
   u['skeleton']['Turret']={'x':float(mount.get('x',0)),'y':float(mount.get('y',0))}
   u['materials']['icon']=image.name
  u['layers'].append({'name':key[6:],'texture':image.name,'bone':'Turret' if turret else 'Body',
   'order':float(decal.get('order',1)),'scale':float(decal.get('imageScale',1)),
   'rotation':float(decal.get('dirOffset',0)),'offset':{'x':float(decal.get('xOffsetRelative',0)),'y':float(decal.get('yOffsetRelative',0))},
   'worldOffset':{'x':float(decal.get('xOffsetAbsolute',0)),'y':float(decal.get('yOffsetAbsolute',0))},
   'source':image.relative_to(MOD).as_posix()})
 fit_facility(u,dest,kind)
 for key,t in d.items():
  if not key.startswith('turret_') or t.get('canShoot')!='true':continue
  spawn=section(d,'projectile_'+t['projectile']).get('spawnUnit','');payload={k:float(v) for k,v in re.findall(r'(\w+)\s*[:=]\s*(-?[\d.]+)',spawn)}
  wid=key[7:];channel='beam' if payload.get('BeamDamage') else 'shell';damage=round(payload.get('BeamDamage',payload.get('ShellDamage',0))/50)*25
  shots={'machineGun':12,'beam':2,'missile':4,'cannon':1}[kind]
  w={'name':name,'type':channel,'category':{'machineGun':'machineGun','beam':'beamRifle','missile':'missile','cannon':'cannon'}[kind],'min':1,'max':round(float(t.get('limitingRange',600))/100),'hit':round(payload.get('WeaponAccuracy',100)),'sourceHit':round(payload.get('WeaponAccuracy',100)),'en':0,'slot':'primary','clip':None,'damagePerShot':damage,'damageComponents':{channel:damage},'hitsPerShot':1,'sourceName':wid,'level':1,'actionCost':2,'changeHeldWeapon':False,'attack':{'steps':[{'shots':1,'delay':0 if i==0 else .15,'muzzleIndex':0,'requiredParts':[]} for i in range(shots)],'startAnimation':None},'nativePayload':payload,'source':{'file':u['source'],'barrels':[{'id':wid,'x':float(t.get('barrelX',0)),'y':float(t.get('barrelY',12))}]},'muzzle':{'mounts':[{'bone':'Turret','offset':{'x':float(t.get('barrelX',0)),'y':float(t.get('barrelY',12))}}]},'targetModifiers':{key:payload.get(native,1) for key,native in [('air','AntiAir'),('ground','AntiLand'),('water','AntiAqua'),('space','AntiSpace')]},'requiredParts':[]}
  sample=next(iter(template['weapons'].values()))
  for field in ['projectile','hitEffect','sound']:w[field]=copy.deepcopy(sample[field])
  if kind=='beam':
   image=next(p for p in (ASSETS/'projectiles').glob('Beam*.png') if 'Trail' not in p.name);w['projectile']['texture']='../../projectiles/'+image.name
  sound=resolve(t['shoot_sound'],source.parent);shutil.copy2(sound,ASSETS/'sounds'/sound.name);w['sound']={'file':'../../sounds/'+sound.name,'volume':float(t.get('shoot_sound_vol',.4))}
  w['attackRounds']={'machineGun':2,'beam':3,'missile':2,'cannon':3}[kind]
  u['weapons'][wid]=w;u['weaponKits'][0]['weapons'].append(wid);u['stats']['visualTurrets']=[{'id':wid,'bone':'Turret','idleDir':0,'arc':180}]
 (ASSETS/'units'/uid/'unit.json').write_text(dumps(u),encoding='utf-8')
 return {'id':uid,'source':u['source'],'nativeHP':hp,'weapons':list(u['weapons']),'visual':u['sourceStats']['visual']}
if __name__=='__main__':
 report=[build(*row) for row in ROWS]
 report.append(import_points())
 Path('docs/imports/battlefield-facilities.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print(json.dumps(report,ensure_ascii=True))
