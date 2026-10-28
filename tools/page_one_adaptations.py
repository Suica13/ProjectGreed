"""Apply explicit adaptations shared by the Page_00 importer and audited JSON refresh."""
import json,re,importlib.util
from pathlib import Path
from mod_source import ROOT,ASSETS,load,section,resolve
from unit_visuals import BONE_NAMES
from unit_parts import apply_parts
from unit_skills import apply_body_tackle, import_tackle_assets
import copy

LEGACY=["RGM_79","RGC_80","RGM_79L","MS_06F","MS_09","RGM_79_G","MS_06J","MS_06K","MS_14A","RX_79_G","MS_06F2","MS_09R","SalamisClass","RX_78_1","FF_X7"]
BALANCED={}
for ident in LEGACY:
 prefab=json.loads((ASSETS/f"units/{ident}/unit.json").read_text(encoding="utf-8"))
 for key,w in prefab["weapons"].items():BALANCED.setdefault(key,w)
LABELS={'AutoRepair':'自动修复','AntiDetect':'反侦测','AntiDetect_Aqua':'水下反侦测','CmdAtk':'攻击指挥','CmdCom':'通信指挥','CmdDef':'防御指挥','CustomUnit':'换装／改修','CustomUnit_NewUnit':'改修生成新机体','CustomUnit_PilotCustomUnit':'驾驶员专属改修','ChangeStyle':'姿态切换','Deploy':'展开／收起','DogFight_A':'空中缠斗','Exam_Off':'EXAM系统','ExitUnit':'脱出','ExitUnit_NewUnit':'脱出并生成新机体','Fighter':'战斗机特性','FlyHover':'悬浮飞行','FlyStyle':'飞行形态','FlyUnit':'飞行模式','FuseUnit_B':'合体','HADES_Off':'HADES系统','HADES_PR2_Off':'HADES系统(PR2)','Hover':'气垫移动','HoverEffect':'气垫特效','LPC':'学习型电脑','LaunchAllUnits':'搭载与放出','SFS':'辅助飞行平台','Sonar':'声呐','Stealth':'隐蔽','Stealth_Aqua':'水下隐蔽','SupplyPoint':'整备补给','SupplyPoint_UseEN':'整备消耗EN','Transform_LandLand_Tank':'MS／坦克变形','Unit_BreakableTurret':'独立炮塔损毁','UnloadEquipment':'装备分离'}

def populate_infantry(p,data):
 # Nine attached infantry members become one tactical squad, preserving native sprites and guns.
 spec=importlib.util.spec_from_file_location('page_importer',Path(__file__).with_name('import-0079-page-one.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 effects=module.read(ASSETS/'effects/effects.json');members=[]
 for key in data:
  if not key.startswith('attachment_Member_'):continue
  attach=section(data,key);action=data.get('hiddenAction_'+key,{});ident=action.get('attachments_addNewUnits','').split('*')[0].strip()
  source=module.INDEX.get(ident)
  if not source:continue
  native=load(source);bone='Member'+str(len(members)+1);p['skeleton'][bone]={'x':module.numeric(attach.get('x',0)),'y':module.numeric(attach.get('y',0))}
  for name in native:
   if not name.startswith('decal_'):continue
   decal=section(native,name)
   if not decal.get('image','').startswith('ROOT:'):continue
   image=resolve(decal['image']);module.asset(image,ASSETS/f"units/{p['id']}/textures"/image.name);p['materials']['textures'][image.name]='textures/'+image.name
   p['layers'].append({'name':bone,'bone':bone,'texture':image.name,'order':3,'scale':module.numeric(decal.get('imageScale',1))})
  for key,w in module.weapon(p,source,effects):
   # Individual members have no separately targetable module HP in this tactical adaptation.
   for mount in w.get('muzzle',{}).get('mounts',[]):mount['bone']=bone
   w['name']='步兵班武器';p['weapons'][key+'_'+bone]=w
  members.append(bone)
 p['weaponKits']=[{'id':'standard','name':'步兵班武装','cost':0,'weapons':list(p['weapons'])}]
 p['presentation'].update(idle='ImportedIdle',move='ImportedIdle',walk='ImportedIdle',stagger='ImportedIdle',dodge='ImportedIdle',movement='walk',mapScale=1,battleScale=1)
 module.write(ASSETS/'effects/effects.json',effects)

def weapon_label(key,w):
 if key.startswith(('Medea_Turret_MG', 'FatUncle_Turret_MG')):return '\u9632\u7a7a\u673a\u67aa'
 if key == 'ZN_MS_07B3_Minigun':return '加特林盾牌'
 if key in BALANCED:return BALANCED[key]['name']
 caliber=re.search(r'(\d+mm)',key);prefix=caliber[1] if caliber else ''
 if w.get('moduleIds'):prefix='舰载'
 if 'Vulcan' in key:return prefix+'火神炮'
 if any(t in key for t in ['HeatHawk','HeatSaber','BeamSaber']):return '热能斧' if 'Hawk' in key else '热能军刀' if 'Heat' in key else '光束军刀'
 if w['type']=='melee':return '近身格斗'
 if 'Bazooka' in key:return prefix+'火箭筒'
 if 'Flamethrower' in key:return '喷火器'
 if 'Mortar' in key:return '迫击炮轰炸'
 if 'Sniper' in key:return '光束狙击枪' if w['type']=='beam' else '狙击步枪'
 if 'Cannon' in key:return prefix+('光束炮' if w['type']=='beam' else '加农炮')
 if 'Vulcan' in key or 'MG' in key or any(t in key.lower() for t in ['minigun','gatling','gattling']):return prefix+'机枪'
 if 'Rifle' in key or key.endswith('_BR'):return prefix+'光束步枪'
 if 'Bomb' in key:return prefix+'航空炸弹'
 if any(t in key for t in ['_MS','Missile','Rocket']):return prefix+'导弹发射器'
 if w['type']=='beam':return prefix+'光束炮'
 return w['name']

def finalize(p,row,data):
 if "Army_Squad" in data["core"].get("tags", "") and not p["weapons"]:populate_infantry(p,data)
 skills=p['sourceStats'].get('nativeSkills',[]);tags=p['sourceStats'].get('nativeTags',[])
 if p['id'] in ['RX_78_2','RX_77_2','RX_75'] and not any(s['id']=='ExitUnit' for s in p.get('skills',[])):
  escape=json.loads((ASSETS/'units/RX_78_1/unit.json').read_text(encoding='utf-8'))['skills'][0]
  p.setdefault('skills',[]).append(copy.deepcopy(escape))
 if 'AutoRepair' in skills:p['stats']['autoRepair']={'hpPercent':10,'enCost':10}
 if 'MS' in tags:
  try:p=apply_parts(p,data)
  except ValueError as error:
   raise ValueError(p['id']+': '+str(error))
 for key,w in p['weapons'].items():
  if not p['stats'].get('ship') and key in BALANCED:
   template=BALANCED[key]
   for field in ['damagePerShot','damageComponents','en','hit','hitMultiplier','hitBonus','min','max']:
    w[field]=copy.deepcopy(template[field])
  elif not p['stats'].get('ship') and w['type']!='melee':
   desired=2 if 'Bazooka' in key or 'BeamRifle' in key or key.endswith('_BR') else 3 if 'Cannon' in key else None
   count=sum(step.get('shots',0)*step.get('repeat',1) for step in w['attack']['steps'])
   if desired and count!=desired:
    w['attack']['steps']=[{'delay':.4,'shots':1,'animation':w['clip']} for _ in range(desired)]+[{'delay':.3}]
    w['damageComponents']={k:v*.7 for k,v in w['damageComponents'].items()};w['damagePerShot']=sum(w['damageComponents'].values())
 # Special weapons are audited individually even when their RTS subsystem is not implemented.
 spec=importlib.util.spec_from_file_location('page_graph',Path(__file__).with_name('import-0079-page-one.py'));module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 for file in module.graph(ROOT/row['source']):
  if '/Units/BattleUnits/Weapon/Sp/' not in file.as_posix():continue
  ident='special_'+file.stem
  if not any(m['id']==ident for m in p['mechanics']):p['mechanics'].append({'id':ident,'name':'特殊武装：'+file.stem,'source':file.relative_to(ROOT).as_posix(),'status':'review'})
 for key,weapon in p['weapons'].items():weapon['name']=weapon_label(key,weapon)
 for kit in p['weaponKits']:
  if kit['id'].startswith('kit_'):
   primary=p['weapons'][kit['weapons'][0]];name=primary['sourceName']
   kit['name']=primary['name']+'套件'
   kit['cost']=100 if 'Cannon' in name or 'Rifle' in name or name.endswith('_BR') else 75 if primary['type']=='beam' else 50 if any(token in name for token in ['Bazooka','Missile','_MS','BigGun']) else 0
 for weapon in p['weapons'].values():weapon['hitBonus']=weapon['hit']-int(weapon['sourceHit']*weapon['hitMultiplier']+.5)
 for key,w in p['weapons'].items():
  if p['stats'].get('ship') or w['type']=='melee':continue
  count=sum(step.get('shots',0)*step.get('repeat',1) for step in w['attack']['steps'])
  desired=2 if 'Bazooka' in key or 'BeamRifle' in key or key.endswith('_BR') else 3 if 'Cannon' in key else None
  if desired and count!=desired:
   w['attack']['steps']=[{'delay':.4,'shots':1,'animation':w['clip']} for _ in range(desired)]+[{'delay':.3}]
   if key not in BALANCED:w['damageComponents']={k:v*.7 for k,v in w['damageComponents'].items()};w['damagePerShot']=sum(w['damageComponents'].values())
 p['sourceStats']['balanceStatus']='provisional-native-import'
 p['sourceStats'].update(reaction=p['stats']['mobility'],accuracy=p['stats']['accuracy'])
 if any(n in skills for n in ['Stealth','Stealth_Aqua']):p['stats']['stealth']={'waterOnly':'Stealth_Aqua' in skills}
 if 'Sonar' in skills or p['id'] in ['RFF_06','Type74','Type74Kai','MS_06E','Luggun']:
  waterOnly='Sonar' in skills
  skill=dict(id='SonarScan' if waterOnly else 'ReconScan',type='recon',name='声呐搜索' if waterOnly else '战场侦察',range=6,maxUses=99,consumeAction=True,enCost=15,waterOnly=waterOnly,effect='Light_75_NotAttached',sound={'file':'../../sounds/Transform_4.ogg','volume':.3})
  p.setdefault('skills',[])
  if not any(s['id']==skill['id'] for s in p['skills']):p['skills'].append(skill)
  if not any(m['id']==skill['id'] for m in p['mechanics']):p['mechanics'].append({'id':skill['id'],'name':skill['name']+'：标记近距离敌军，提高友军命中率','status':'adapted'})
 # These effects are conditional legacy forms, not always-visible parts of the hull.
 filtered=[]
 for layer in p['layers']:
  native=section(data,'decal_'+layer['name']) if 'decal_'+layer['name'] in data else {}
  condition=native.get('isVisible','')
  if condition.strip() in ['false','if false'] or 'Common_ReEntry' in layer['name'] or 'Common_FullBoost' in layer['name']:continue
  if layer['name'].startswith('Body_') and 'isTransportUnloading' in condition:continue
  if 'BoostReversing' in layer['name']:layer['visibleWhen']={'moving':True,'boosting':True}
  if 'Boost' in layer['name']:layer['visibleWhen']={'moving':True,'boosting':True}
  if layer['name'] in ['ZN_HeatHawk_A','ZN_HeatHawk_A_Step2']:
   layer['visibleWhen']={'heldWeapon':'ZN_HeatHawk_A'}
   layer['animationVisibility']={'clip':'Common_Melee_A','start':.6,'end':2,'visibleInside':layer['name'].endswith('_Step2')}
  if layer.get('frames',1)>1 and any(token in native.get('frame','') for token in ['LegFrame','self.timeAlive']):
   layer['frameFps']=12
   layer['onlyAnimateWhenMoving']='LegFrame' in native.get('frame','')
  if layer.get('scale')==0:layer['scale']=1
  filtered.append(layer)
 p['layers']=filtered
 if not any('Boost' in l['name'] for l in p['layers']):
  p['presentation']['movement']='walk'
  p['presentation']['move']='OnMovingWalk' if 'OnMovingWalk' in p['animations'] else 'ImportedIdle'
 # Native aircraft rotor joints use spinRate; retain a genuine rotor loop without MS idle motion.
 for key in data:
  if not key.startswith('decal_'):continue
  native=section(data,key);bone=native.get('basePositionFromLegEnd','').replace('_','');joint='arm_'+re.sub(r'\D','',bone)
  speed=float(data.get(joint,{}).get('spinRate',0))
  if speed and native.get('image','').startswith('ROOT:'):
   semantic=BONE_NAMES.get(bone,'Attachment'+re.sub(r'\D','',bone))
   if semantic not in p['skeleton']:continue
   layer=next((l for l in p['layers'] if l['name']==key[6:]),None)
   if not layer:
    source=resolve(native['image']);dest=ASSETS/f"units/{p['id']}/textures"/source.name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(source.read_bytes());p['materials']['textures'][source.name]='textures/'+source.name
    layer={'name':key[6:],'bone':semantic,'texture':source.name,'order':4,'scale':float(native.get('imageScale',1))};p['layers'].append(layer)
   layer['rotationSpeed']=speed*60
 if p['stats']['ship']:
  if 'Body' not in p['skeleton'] and 'Pelvis' in p['skeleton']:
   p['skeleton']['Body']=p['skeleton'].pop('Pelvis')
   for layer in p['layers']:
    if layer['bone']=='Pelvis':layer['bone']='Body'
   for weapon in p['weapons'].values():
    for mount in weapon.get('muzzle',{}).get('mounts',[]):
     if mount.get('bone')=='Pelvis':mount['bone']='Body'
  ground=p['stats']['adaptability']['ground']
  if ground<=10:p['stats']['adaptability']['ground']=0
  if 'NavyUnit' not in tags and 'skyAdaptability=100' in ' '.join(v for s in data.values() for v in s.values()).replace(' ',''):p['stats']['movementType']='air';p['stats']['adaptability']['ground']=100
 for mechanic in p['mechanics']:
  ident=mechanic['id'];mechanic['name']=LABELS.get(ident,ident)
  if ident=='movement':mechanic['name']={'air':'空中移动：可跨越山岩与水域','naval':'海军：只能在水域移动和部署','amphibious':'两栖：可穿越陆地与水域','hover':'气垫移动：可横越水域','ground':'地面移动'}[p['stats']['movementType']]
  if ident=='ExitUnit_NewUnit' and p['id'] in ['RX_78_2','RX_77_2','RX_75']:mechanic['status']='implemented';mechanic['name']='核心战斗机脱出：移除原机体，生成FF-X7'
  if ident=='AutoRepair':mechanic['status']='adapted';mechanic['name']='自动修复：己方行动开始时消耗10 EN恢复10%HP'
  if ident in ['Stealth','Stealth_Aqua','Sonar']:mechanic['status']='adapted'
  if ident in ['Unit_BreakableTurret','Hover']:mechanic['status']='implemented'
  if ident in ['Fighter','FlyUnit'] and p['stats']['movementType']=='air':mechanic['status']='adapted'
  if ident in ['CantDeconstruct','CustomUnit_PilotCustomUnit']:mechanic['status']='not_applicable'
 if 'MS' not in tags:p['stats']['partsBreakable']=False
 for weapon in p['weapons'].values():
  mounts=weapon.get('muzzle',{}).get('mounts',[])
  source=load(ROOT/weapon['source']['file']) if mounts else {}
  for index,mount in enumerate(mounts):
   barrels=weapon['source'].get('barrels',[])
   if index>=len(barrels):continue
   turret=section(source,'turret_'+barrels[index]['id']);alternate=module.numeric(turret.get('barrelOffsetX_onOddShots',0))
   if alternate and mount.get('layer'):
    first=module.base.mount(p,turret,mount['layer']);other=module.base.mount(p,{**turret,'barrelX':module.numeric(turret.get('barrelX',0))+alternate},mount['layer'])
    mount['alternatingPoint']={key:other['point'][key]-first['point'][key] for key in ['x','y']}
   elif alternate:mount['alternatingOffsetX']=alternate

  for index,mount in enumerate(mounts):
   if mount.get('layer') and not any(l['name']==mount['layer'] for l in p['layers']):
    source=load(ROOT/weapon['source']['file']);barrel=weapon['source']['barrels'][index]['id'];turret=section(source,'turret_'+barrel);bone='Body' if 'Body' in p['skeleton'] else next(iter(p['skeleton']));joint=p['skeleton'][bone]
    mounts[index]={'bone':bone,'offset':{'x':float(turret.get('barrelX',0))-joint.get('x',0),'y':float(turret.get('barrelY',0))-joint.get('y',0)}}
 from native_weapon_layout import correct
 return correct(p,row,data)

def main():
 manifest=json.loads(Path('tools/0079-page-one-manifest.json').read_text(encoding='utf-8'))
 for row in manifest:
  path=ASSETS/f"units/{row['id']}/unit.json"
  if not path.exists():continue
  p=json.loads(path.read_text(encoding='utf-8'))
  if 'mechanics' not in p:continue
  p=finalize(p,row,load(ROOT/row['source']));path.write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()