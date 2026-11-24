"""Source-backed SEED attachment/loadout corrections, shared by targeted and full imports."""
import importlib.util,re
from pathlib import Path
from mod_source import ROOT,MOD,ASSETS,load,section,resolve

def underbarrel(p,native):
 from native_combat import native_weapon
 for key,w in p['weapons'].items():
  own=w.get('sourceName',key)
  if not own.endswith('_GL'):continue
  parent=own[:-3]
  for name in (parent,own):
   if name not in p['weapons']:continue
   target=p['weapons'][name]
   native_weapon(p,target,native)
   target['type']='shell' if name==own else 'beam'
   target['category']='grenade_launcher' if name==own else 'beam_rifle'
   target['weaponClass']=target['category']
   labels=('下挂榴弹发射器','Underbarrel Grenade Launcher','アンダーバレル・グレネードランチャー') if name==own else ('光束步枪','Beam Rifle','ビーム・ライフル')
   target['name']=labels[0]
   for lang,label in zip(('zh','en','ja'),labels):target.setdefault('localization',{}).setdefault(lang,{})['name']=label
 return p

def apply(p,native,effects=None,bulk=None):
 underbarrel(p,native)
 if p['id']=='TS_MA2_H':
  # Native EquipmentIndex 1/2 are exclusive payloads; main_0 keeps saves compatible.
  fixed=['Common_DoubleVulcan_FF_6','Common_DoubleMS_TS_MA2']
  p['weaponKits']=[
   {'id':'main_0','name':'普通导弹套件','nativeEquipmentIndex':1,'cost':0,
    'localization':{'en':{'name':'Missile Loadout'},'ja':{'name':'通常ミサイル装備'}},
    'weapons':['OMNI_TS_MA2_H_AntiShipMS',*fixed]},
   {'id':'nuclear','name':'核弹套件','nativeEquipmentIndex':2,'cost':0,
    'localization':{'en':{'name':'Nuclear Missile Loadout'},'ja':{'name':'核ミサイル装備'}},
    'weapons':['OMNI_TS_MA2_H_NukeMS',*fixed]}]
  p['layers']=[layer for layer in p['layers'] if layer['name']!='E_BeamCannon']
  for layer in p['layers']:
   if layer['name']=='AntiShipMS':layer['visibleWhen']={'kit':'main_0'}
   elif layer['name'] in ('Nuke','MSLink_2'):layer['visibleWhen']={'kit':'nuclear'}
   elif layer['name']=='MSLink':layer['visibleWhen']={}
 if p['id']=='TMF_A_802':
  if bulk is None:
   spec=importlib.util.spec_from_file_location('bucue_importer',Path(__file__).with_name('import-0079-page-one.py'));bulk=importlib.util.module_from_spec(spec);spec.loader.exec_module(bulk)
  from native_combat import native_weapon
  from weapon_policy import category,action_cost
  fixed=[key for key,w in p['weapons'].items() if w['type']=='melee']
  saber=next((key for key in fixed if 'Saber' in key),None)
  if saber:
   for layer in p['layers']:
    if layer['name']=='Head_1':layer['visibleWhen']={'heldWeapon':saber}
    elif layer['name']=='Head':layer.setdefault('visibleWhen',{})['heldWeapon']={'not':saber}
  p['weaponKits']=[]
  for index,child,label in [(0,'TMF_A_802_Turret_Railgun','磁轨炮'),(1,'TMF_A_802_Turret_MS','导弹发射器')]:
   source=ROOT/f'Units/BattleUnits/TMF_A_802/{child}.ini';data=load(source)
   attachment=section(native,'attachment_TMF_A_802_Turret_M'+str(index+1));bone='BackTurret'+str(index)
   p['skeleton'][bone]={'x':float(attachment.get('x',0)),'y':float(attachment.get('y',0)),'endDirOffset':0}
   p['layers']=[l for l in p['layers'] if l['name']!=child]
   keys=[]
   for key,w in bulk.weapon(p,source,effects):
    native_weapon(p,w,native)
    w['muzzle']={'mounts':[{'bone':bone,'offset':{'x':float(section(data,'turret_'+barrel['id']).get('barrelX',0)),'y':float(section(data,'turret_'+barrel['id']).get('barrelY',0))},'alternatingOffsetX':float(section(data,'turret_'+barrel['id']).get('barrelOffsetX_onOddShots',0))} for barrel in w['source']['barrels']]}
    w['name']=label;w['category']=category(key,w);w['attackRounds']=1;w['actionCost']=action_cost(p,key,w)
    w['level']=1;w['levelSource']=source.relative_to(ROOT).as_posix();w['min']=1;w['max']=4;w['localization']={'zh':{'name':label},'en':{'name':'Railgun' if index==0 else 'Missile Launcher'},'ja':{'name':'レールガン' if index==0 else 'ミサイルランチャー'}}
    p['weapons'][key]=w;keys.append(key)
   kit='standard' if index==0 else 'missile'
   p['weaponKits'].append({'id':kit,'nativeEquipmentIndex':index,'name':label+'套件','cost':0,'weapons':keys+fixed})
   for name in data:
    if not name.startswith('decal_'):continue
    d=section(data,name)
    if not d.get('image','').startswith('ROOT:Units/'):continue
    image=resolve(d['image']);dest=ASSETS/f"units/{p['id']}/textures"/image.name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(image.read_bytes());p['materials']['textures'][image.name]='textures/'+image.name
    p['layers']=[l for l in p['layers'] if l['name']!=name[6:]]
    # Native turret cannot be targeted separately: a visual joint, not a breakable ship module.
    p['layers'].append({'name':name[6:],'bone':bone,'texture':image.name,'order':max((l.get('order',0) for l in p['layers'] if l['name'] in ('Body','Hull','Torso')),default=4)+1,'scale':float(d.get('imageScale',1)),'offset':{'x':0,'y':0},'visibleWhen':{'kit':kit}})
   p['stats'].setdefault('visualTurrets',[])
   p['stats']['visualTurrets']=[t for t in p['stats']['visualTurrets'] if t['bone']!=bone]+[{'id':child,'bone':bone,'idleDir':0,'arc':90}]
 if p['id'] in ('GAT_X102','GAT_X102_AS'):
  p['weapons'].pop('OMNI_GAT_X102_BR_GL',None)
  for kit in p['weaponKits']:kit['weapons']=[k for k in kit['weapons'] if k in p['weapons']]
 if p['id']=='GAT_X207':
  for layer in p['layers']:
   if layer.get('alpha')==0:layer['alpha']=1
  p['skills']=[s for s in p.get('skills',[]) if s['type']!='optical_camouflage']+[{'effect':'Light_75_NotAttached','sound':{'file':'../../sounds/Transform_4.ogg','volume':.4},'id':'OpticalCamouflage','name':'光学迷彩开关','type':'optical_camouflage','range':0,'enCost':0,'upkeep':200,'evasionMultiplier':1.25,'consumeAction':False,'maxUses':99,'localization':{'en':{'name':'Optical Camouflage'},'ja':{'name':'光学迷彩'}}}]
  p['stats'].setdefault('sensors',{})['stealth']=False
  for m in p.get('mechanics',[]):
   if 'Stealth' in m['id'] or m['id']=='OpticalCamouflage':m.update(status='adapted',name='光学迷彩：开关、每己方回合200 EN、攻击解除、回避×1.25及索敌隐身')
 return p

def railgun(p):
 """Use actual ammunition, never the weapon stem (desert GM also has a missile tube)."""
 for w in p['weapons'].values():
  if Path(w.get('projectile',{}).get('texture','')).name!='RailShell_1.png':continue
  # Native transparent damage carrier and visible shot must share the real launch speed.
  speed=w.get('nativePayload',{}).get('ProjectileSpeed')
  if speed:w['projectile']['speed']=speed
  name=w.get('sourceName','')
  if re.search(r'Railgun|RailBazooka',name,re.I):
   labels=('磁轨炮火箭筒','Rail Bazooka','レールバズーカ') if 'Bazooka' in name else ('磁轨炮','Railgun','レールガン')
   w['name']=labels[0]
   for lang,label in zip(('zh','en','ja'),labels):w.setdefault('localization',{}).setdefault(lang,{})['name']=label
   for kit in p['weaponKits']:
    if kit.get('weapons',[None])[0] in [key for key,value in p['weapons'].items() if value is w] and ('套件' in kit['name']):kit['name']=labels[0]+'套件'
 return p
