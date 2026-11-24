"""Scoped Duel A0 Thunderbolt import, using the user's UC balance references.

The source MOD is read-only. Original mutator payloads and child projectiles are
adapted in memory for the shared native firing-chain reader, never rewritten.
"""
import os,sys,json,re,copy,importlib.util,shutil,hashlib
from pathlib import Path
os.environ['PROJECTGREED_MOD_DLC_ROOT']=r'H:/RW_Modding/Locker/A/GundamWars/duel/GundamWars_Duel_A0'
from mod_source import ROOT,ASSETS,load,parse,section,resolve,stat
from weapon_store import loads,dumps
import native_combat
PROJECT=ASSETS.parent
spec=importlib.util.spec_from_file_location('tb_bulk',Path(__file__).with_name('import-0079-page-one.py'))
bulk=importlib.util.module_from_spec(spec);spec.loader.exec_module(bulk)
POLICY=json.loads((PROJECT/'shared/thunderbolt-import-policy.json').read_text(encoding='utf8'))
GBO=Path(r'E:/RustedWarfare_Reunion/mods/GundamWars_BattleOperation2_V5')
NAMES={'RGM_79_TB':('吉姆[TB]','GM [Thunderbolt]','ジム［TB］'),'MS_06F_TB':('扎古II F型[TB]','Zaku II F [Thunderbolt]','ザクII F型［TB］'),'MS_06R_TB':('高机动型扎古II[TB]','High Mobility Zaku II [Thunderbolt]','高機動型ザクII［TB］'),'MS_06R_TB_WeaponModeB':('高机动型扎古II[TB·双持]','High Mobility Zaku II [TB Twin Weapons]','高機動型ザクII［TB・二挺］'),'FA_78_1_TB':('全装甲高达[TB]','Full Armor Gundam [Thunderbolt]','フルアーマー・ガンダム［TB］'),'FA_78_1_TB_WeaponModeB':('全装甲高达[TB·重火力]','Full Armor Gundam [TB Heavy Weapons]','フルアーマー・ガンダム［TB・重火力］'),'FA_78_1_TB_NA':('高达[TB·脱甲]','Gundam [TB Armor Purged]','ガンダム［TB・装甲排除］')}
FILES={'RGM_79_TB':'RGM-79_TB/RGM-79_TB.ini','MS_06F_TB':'MS-06F_TB/MS-06F_TB.ini','MS_06R_TB':'MS-06R_TB/MS-06R_TB.ini','MS_06R_TB_WeaponModeB':'MS-06R_TB/MS-06R_TB_WeaponModeB.ini','FA_78_1_TB':'FA-78-1_TB/FA-78-1_TB.ini','FA_78_1_TB_WeaponModeB':'FA-78-1_TB/FA-78-1_TB_WeaponModeB.ini','FA_78_1_TB_NA':'FA-78-1_TB/FA-78-1_TB_NA.ini'}
aliases={}
def asset(source,target):
 if target.exists() and target.read_bytes()!=source.read_bytes() and '/units/' not in target.as_posix():
  old=target.name;target=target.with_name('TB_'+old);aliases[old]=target.name
 target.parent.mkdir(parents=True,exist_ok=True)
 if not target.exists() or target.read_bytes()!=source.read_bytes():shutil.copyfile(source,target)
 return target.name
bulk.asset=asset;bulk.base.asset=asset
def localized(names):return {lang:{'name':name} for lang,name in zip(('zh','en','ja'),names)}
def references(data):
 data=copy.deepcopy(data)
 for value in data.values():
  image=value.get('image','')
  m=re.fullmatch(r'\$\{(.+)\.(\w+)\}',image)
  if m:value['image']=section(data,m[1])[m[2]]
 return data
current={}
def adapted_load(path,*args,**kwargs):
 data=references(load(path,*args,**kwargs))
 if current.get('core',{}).get('name')=='FA-78-1_TB_NA' and path.stem=='EF_BeamSaber_Lv2':
  # The purged unit's B -> F -> kick sequence crosses into Common_Cqb.
  for key,value in current.items():
   if key.startswith(('turret_Common_Cqb','projectile_Common_Cqb')):data[key]=copy.deepcopy(value)
 # A weapon template may inherit a section supplied by its owning unit.
 for _ in range(6):
  missing={v['@copyFromSection'] for v in data.values() if '@copyFromSection' in v and v['@copyFromSection'] not in data}
  if not missing:break
  for key in missing:
   if key not in current:raise ValueError('Missing native section '+key)
   data[key]=copy.deepcopy(current[key])
 def leaf(name,stack=()):
  if name in stack:raise ValueError('Cyclic projectile '+name)
  p=section(data,'projectile_'+name);raw=p.get('spawnProjectilesOnCreate','')+','+p.get('spawnProjectilesOnEndOfLife','')
  children=re.findall(r'(\w+)\*(\d+)',raw)
  if children:
   result=[]
   for child,count in children:result+=leaf(child,(*stack,name))*int(count)
   return result
  payload={}
  for key,value in p.items():
   if re.match(r'mutator\d+_addResources(?:Area|Direct)Hit$',key):payload.update(native_combat.payload(value))
  if not any(payload.get(key,0)>0 for key in native_combat.CHANNELS):
   spawn=re.match(r'(\w+)',p.get('spawnUnit',''))
   if not spawn:return []
   child=next((ROOT/'Units/BattleUnits/Weapon').rglob(spawn[1]+'.ini'),None)
   if not child:return []
   child_data=load(child)
   for key in child_data:
    if not key.startswith('projectile_'):continue
    projectile=section(child_data,key);values={}
    for field,value in projectile.items():
     if re.match(r'mutator\d+_addResources(?:Area|Direct)Hit$',field):values.update(native_combat.payload(value))
    if not any(values.get(channel,0)>0 for channel in native_combat.CHANNELS):continue
    visual=next((section(child_data,k) for k in child_data if k.startswith('decal_') and section(child_data,k).get('image','').startswith('ROOT:')), {})
    values.update(ProjectileSpeed=float(child_data.get('movement',{}).get('moveSpeed',8)),ProjectileLife=3)
    return [(values,{**projectile,**visual,'nativeChildSource':child.relative_to(ROOT).as_posix()})]
   return []
  payload.update(ProjectileSpeed=float(p.get('speed',0)),ProjectileLife=float(p.get('life',1)))
  return [(payload,p)]
 for name,value in data.items():
  if not name.startswith('projectile_'):continue
  leaves=leaf(name[11:])
  if not leaves:continue
  first=leaves[0][0]
  if any(row[0]!=first for row in leaves):raise ValueError('Mixed child payload needs explicit conversion: '+str(path)+'/'+name)
  value['spawnUnit']='DuelDamageCarrier*'+str(len(leaves))+'(addResources='+'|'.join(k+'='+str(v) for k,v in first.items())+')'
  value['_duelLeaf']=json.dumps(leaves[0][1])
 return data
native_combat.load=adapted_load
def rename_assets(value):
 if isinstance(value,dict):return {k:rename_assets(v) for k,v in value.items()}
 if isinstance(value,list):return [rename_assets(v) for v in value]
 if isinstance(value,str) and '/' in value:
  head,tail=value.rsplit('/',1);return head+'/'+aliases.get(tail,tail)
 return value
def main():
 global current
 sys.stdout.reconfigure(encoding='utf8');effects=loads((ASSETS/'effects/effects.json').read_text(encoding='utf8'));prefabs=[];report=[]
 for ident,names in NAMES.items():
  path=ROOT/'Units/BattleUnits'/FILES[ident];data=references(load(path));current=data
  profile=POLICY['units'][ident]
  base=loads((ASSETS/'units'/profile['stats']/'unit.json').read_text(encoding='utf8'))
  handling=loads((ASSETS/'units'/profile['handling']/'unit.json').read_text(encoding='utf8'))
  data['graphics']['icon_build']=data['graphics']['icon_zoomed_out']
  p=bulk.visual({'id':ident,'source':path.relative_to(ROOT).as_posix()},data)
  provided=Path(r'C:/Users/jpex1/OneDrive/桌面/素材/111/4')/('FA_78_1_TB.png' if ident.startswith('FA') else 'MS_06R_TB.png' if ident.startswith('MS_06R') else '')
  if provided.is_file():
   icon=asset(provided,ASSETS/'units'/ident/'textures'/provided.name);p['materials']['icon']=icon;p['materials']['textures'][icon]='textures/'+icon
  native_stats=copy.deepcopy(p['sourceStats'])
  native_stats['initialization']=data.get('hiddenAction_StartSetUnitStats',{}).get('setUnitMemory','')
  p.update(name=names[0],code=data['core']['name'],localization=localized(names),tags=['EFSF' if ident.startswith(('RGM','FA')) else 'ZEON','UC_0079_T1'],unitTags=['MS'],stats=copy.deepcopy(base['stats']),attackBonuses=copy.deepcopy(base['attackBonuses']),defenses=copy.deepcopy(base['defenses']),sourceStats=copy.deepcopy(base['sourceStats']),transport=copy.deepcopy(base.get('transport',{'slotCost':1,'loadTags':['CanLoadInto','CanUseSFS']})),weapons={},skills=[],hangars=[],refits=[],mechanics=[])
  p['stats']['mobility']=handling['stats']['mobility'];p['stats']['accuracy']=handling['stats']['accuracy']
  p['sourceStats'].update(nativeDuel=native_stats,referenceUnits=profile,technologyEra='UC_0079_T1',technologyWeight=1)
  production_ref=json.loads((PROJECT/'shared/native-production.json').read_text(encoding='utf8')).get(profile['stats'])
  if production_ref:p['sourceStats']['nativeProductionQuantity']=production_ref['quantity']
  p['shield']=copy.deepcopy(loads((ASSETS/'units'/profile['shield']/'unit.json').read_text(encoding='utf8'))['shield'] if profile.get('shield') else base['shield'])
  if profile.get('shield'):p['shield']['requiredParts']=[]
  if profile.get('unshielded'):p['shield'].update(hp=0,blockChance=0,coverage=0,requiredParts=[])
  p['presentation']['shield']=bool(profile.get('shield'));p['presentation']['thrusters']=True
  for role,clip in [('move','OnMovingBoost'),('walk','OnMovingWalk'),('stagger','Common_Stagger_A')]:
   if clip in p['animations']:p['presentation'][role]=clip
  p['formOnly']=ident.endswith(('_WeaponModeB','_NA'))
  if p['formOnly']:p['formOf']='FA_78_1_TB' if ident.startswith('FA') else 'MS_06R_TB'
  # Keep each form's complete equipped action; weapons from other forms stay absent.
  for action in ['action_Weapon'+str(i) for i in range(6)]:
   parent=data.get(action,{}).get('@copyFromSection','')
   if not parent.startswith('template_') or parent in ('template_NonWeapon',):continue
   candidates=[f for f in bulk.graph(path) if '/Weapon/' in f.as_posix() and parent in load(f)]
   if not candidates:raise ValueError('Missing weapon source '+ident+'/'+parent)
   source=candidates[-1];reference=POLICY['weapons'].get(source.stem) or POLICY['weapons'].get(re.sub(r'_Lv\d+$','',source.stem))
   if not reference:raise ValueError('Missing UC balance reference '+source.stem)
   ref_unit=loads((ASSETS/'units'/reference[0]/'unit.json').read_text(encoding='utf8'));canonical=copy.deepcopy(ref_unit['weapons'][reference[1]])
   weapon_data=adapted_load(source);barrels=[key[7:] for key in weapon_data if key.startswith('turret_') and section(weapon_data,key).get('projectile') not in (None,'IGNORE')]
   weapon=copy.deepcopy(canonical);weapon['sourceName']=source.stem;weapon['source']={'file':source.relative_to(ROOT).as_posix(),'barrels':[{'id':b} for b in barrels],'entry':action}
   weapon['muzzle']={'mounts':[]}
   for barrel in barrels:
    turret=section(weapon_data,'turret_'+barrel)
    turret_image=turret.get('image','')
    texture=Path(turret_image.replace('\\','/')).name
    candidates_layers=[l for l in p['layers'] if l['texture']==texture]
    layer=next((l for l in candidates_layers if l['bone']==('LeftArm' if barrel.endswith('_L') else 'RightArm')),None) or next((l for l in p['layers'] if l['name'].rstrip('LR')==barrel.rstrip('LR') or l['name']==barrel),None)
    bone=layer['bone'] if layer else 'Head' if 'Vulcan' in source.stem else 'Body' if any(t in source.stem for t in ('Body','Backpack','BeamCannon')) else 'LeftArm' if 'MissileLauncher' in source.stem else 'RightArm'
    if layer:
     weapon['muzzle']['mounts'].append(bulk.base.mount(p,turret,layer['name']))
    else:
     if barrel.endswith('_L') and bone=='RightArm':bone='LeftArm'
     joint=p['skeleton'][bone]
     weapon['muzzle']['mounts'].append({'bone':bone,'offset':{'x':float(turret.get('barrelX',0))-joint['x'],'y':float(turret.get('barrelY',0))-joint['y']}})
   native_combat.native_weapon(p,weapon,adapted_load(path))
   if weapon.get('muzzleEffects'):
    weapon['muzzleEffects']=[weapon['muzzleEffects'][0]]*len(weapon['muzzle']['mounts'])
   firing_turret=section(weapon_data,'turret_'+weapon['nativeTiming']['barrel'])
   sound=firing_turret.get('shoot_sound','')
   if sound.startswith('ROOT:'):
    source_sound=resolve(sound);filename=asset(source_sound,ASSETS/'sounds'/source_sound.name)
    weapon['sound']={'file':'../../sounds/'+filename,'volume':min(1,float(firing_turret.get('shoot_sound_vol',.5)))}
   # Preserve native ammunition channels, with the UC reference's tactical range,
   # weapon class and energy policy. The runtime normalizes whole volleys.
   channel=next(iter(weapon['damageComponents']))
   weapon['type']='melee' if channel.startswith('melee') else 'beam' if channel.startswith('beam') else 'shell'
   weapon['category']=canonical.get('category','other');weapon['sourceName']=canonical.get('sourceName',reference[1]);weapon['level']=canonical.get('level',1)
   if source.stem.endswith('BeamCannon'):weapon['category']='beam_cannon'
   if 'BR_TB' in source.stem:weapon['category']='beam_rifle'
   for token,kind in [('BeamSprayGun','beam_spray'),('BeamBazooka','beam_bazooka'),('Panzerfaust','panzerfaust'),('HeadVulcan','small_vulcan')]:
    if token in source.stem:weapon['category']=kind
   weapon['weaponClass']=weapon['category'];weapon['thunderboltReference']=reference;weapon['nativeSourceName']=source.stem
   weapon['en']=canonical['en'];weapon['name']=canonical['name'];weapon['localization']=copy.deepcopy(canonical.get('localization',{}))
   if 'BR_TB' in source.stem:weapon.update(name='二连装光束步枪',localization=localized(('二连装光束步枪','Twin Beam Rifle','二連装ビーム・ライフル')))
   if source.stem.endswith('BeamCannon'):
    weapon.update(name='大型光束炮',localization=localized(('大型光束炮','Large Beam Cannon','大型ビーム砲')))
    weapon['muzzleEffects']=['Beam_Fire_1_Pink']*len(weapon['muzzle']['mounts']);weapon['hitEffect']='Beam_Hit_2_Pink'
   if 'BackpackMS' in source.stem:weapon.update(name='背包导弹齐射',localization=localized(('背包导弹齐射','Backpack Missile Salvo','バックパック・ミサイル斉射')))
   if weapon['type']!='melee':
    turret=section(weapon_data,'turret_'+weapon['nativeTiming']['barrel']);projectile=section(weapon_data,'projectile_'+turret['projectile']);leaf=json.loads(projectile['_duelLeaf']) if '_duelLeaf' in projectile else projectile
    image=leaf.get('image','')
    if image.startswith('ROOT:'):
     original_image=resolve(image)
     image=next((GBO/'Resource/Image/Bullet').rglob(original_image.name),None)
     if image is None:raise ValueError('Missing Battle Operation projectile artwork '+original_image.name)
     filename=asset(image,ASSETS/'projectiles'/image.name)
     weapon['projectile']={'texture':'../../projectiles/'+filename,'scale':float(leaf.get('imageScale',1)),'speed':weapon['nativePayload']['ProjectileSpeed'],'nativeSpeed':weapon['nativePayload']['ProjectileSpeed'],'rotation':float(leaf.get('dirOffset',0)),'presentationSource':GBO.name+'/'+image.relative_to(GBO).as_posix(),'presentationSha256':hashlib.sha256(image.read_bytes()).hexdigest()}
   # Both arms and backpack weapons retain their own break dependencies.
   parts=[]
   for step in weapon['attack']['steps']:
    if not step.get('shots'):continue
    mount=weapon['muzzle']['mounts'][step.get('muzzleIndex',0)]
    layer=next((l for l in p['layers'] if l['name']==mount.get('layer')),None)
    bone=layer['bone'] if layer else mount['bone']
    part='backpack' if any(t in source.stem for t in ('Backpack','BeamCannon')) else 'head' if 'Vulcan' in source.stem else 'leftArm' if bone.startswith('Left') else 'rightArm' if bone.startswith('Right') else None
    step['requiredParts']=[part] if part else []
    if part and part not in parts:parts.append(part)
   weapon['requiredParts']=parts if len(parts)==1 else []
   if len(parts)>1:weapon['anyParts']=parts
   p['weapons'][source.stem]=weapon
  first=base['weaponKits'][0]
  p['weaponKits']=[{'id':'default','name':'标准武装','cost':first['cost'],'weapons':list(p['weapons']),'localization':localized(('标准武装','Standard Armament','標準武装'))}]
  groups=[]
  for key,weapon in p['weapons'].items():
   if weapon['type']=='melee':continue
   channels=[]
   for index,barrel in enumerate(weapon['source']['barrels']):
    parts=next((s['requiredParts'] for s in weapon['attack']['steps'] if s.get('shots') and s.get('muzzleIndex',0)==index),[])
    if len(parts)==1 and parts[0] in ('leftArm','rightArm'):channels.append({'id':barrel['id'],'weaponId':key,'muzzleIndex':index,'requiredParts':parts,'limb':parts[0]})
   if {c['limb'] for c in channels}=={'leftArm','rightArm'}:groups.append({'id':key,'channels':channels,'fireMode':'simultaneous'})
  if groups:p['pairedWeapons']=groups
  for layer in p['layers']:
   condition=layer.pop('_nativeVisibility','') or ''
   native=section(data,'decal_'+layer['name']) if 'decal_'+layer['name'] in data else {}
   if re.sub(r'\s+','',condition).lower() in ('false','iffalse'):layer['hidden']=True
   index=re.search(r'nowWeaponIndex\s*==\s*(\d+)',condition)
   if index:layer.setdefault('visibleWhen',{})['weaponDisplayIndex']=int(index[1])
   if 'Shield' in layer['name']:layer.setdefault('visibleWhen',{})['shieldVisible']=True
  shield_layers=[l for l in p['layers'] if 'Shield' in l['name'] and not l.get('hidden')]
  p['sourceStats']['multiShieldCount']=len(shield_layers) if profile.get('shield') else 0
  if profile.get('shield') and len(shield_layers)==1:
   p['shield']['requiredParts']=['leftArm' if shield_layers[0]['bone'].startswith('Left') else 'rightArm']
  rendered=ASSETS/'units'/ident/'textures'/'TB_RenderedIcon.png'
  if not provided.is_file() and rendered.exists():
   p['materials']['icon']=rendered.name;p['materials']['textures'][rendered.name]='textures/'+rendered.name
  for key,value in data.items():
   target=value.get('convertTo');target_id=target.replace('-','_') if target else None
   if not target_id or target_id==ident or target_id not in NAMES:continue
   purge=target_id.endswith('_NA')
   if any(s['source']['unitId']==target_id for s in p['skills']):continue
   p['skills'].append({'id':'ArmorPurge' if purge else 'WeaponChange','name':'装甲排除' if purge else '武装切换','type':'armor_purge' if purge else 'transform','range':0,'maxUses':99,'consumeAction':True,'effect':'Light_75_NotAttached','sound':{'file':'../../sounds/Transform_4.ogg','volume':.5},'nativeAction':key,'source':{'mode':'transform','unitId':target_id,'kitId':'default','kitMap':{'default':'default'},'inheritResources':True,'hpRecoveryPercent':0,'enRecoveryPercent':0,'shieldRecoveryPercent':0,'repairAllParts':False}})
  for source in bulk.graph(path):
   if '/Skills/' in source.as_posix():p['mechanics'].append({'id':source.stem,'status':'adapted' if source.stem in ('WeaponChange','ComeOutSystem','LargeShield','ShieldBreakController') else 'review','source':source.relative_to(ROOT).as_posix(),'name':source.stem})
  p=rename_assets(p);prefabs.append(p)
  report.append({'id':ident,'source':p['source'],'reference':profile,'multiShieldCount':p['sourceStats']['multiShieldCount'],'weapons':{key:{'reference':w['thunderboltReference'],'payload':w['nativePayload'],'timing':w['nativeTiming']} for key,w in p['weapons'].items()},'skills':p['skills'],'review':['实时DP、弹匣装填、冲刺防御、外置燃料箱与姿态控制未冒充回合制主动技能。']})
  print('Imported',ident,'weapons',len(p['weapons']),'shields',p['sourceStats']['multiShieldCount'],flush=True)
 for p in prefabs:(ASSETS/'units'/p['id']/'unit.json').write_text(dumps(p,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 catalog=json.loads((ASSETS/'unit-catalog.json').read_text(encoding='utf8'))
 roles=json.loads((PROJECT/'shared/unit-roles.json').read_text(encoding='utf8'))
 production=json.loads((PROJECT/'shared/production-catalog.json').read_text(encoding='utf8'))
 for p in prefabs:
  ref='units/'+p['id']+'/unit.json'
  if ref not in catalog['units']:catalog['units'].append(ref)
  category=int(stat(load(ROOT/'Units/BattleUnits'/FILES[p['id']]),'unitCategory',1))
  roles['units'][p['id']]={'role':{1:'general',2:'raid',3:'support'}.get(category,'normal'),'method':'native','source':p['source'],'nativeId':p['code'],'nativeCategory':category}
  production['repairPriceReferences'][p['id']]=POLICY['units'][p['id']]['stats']
  production.setdefault('defaultKits',{})[p['id']]='default'
  production.setdefault('baseModels',{})[p['id']]=p['id']+'__default'
 for file,value in [(ASSETS/'unit-catalog.json',catalog),(PROJECT/'shared/unit-roles.json',roles),(PROJECT/'shared/production-catalog.json',production),(PROJECT/'docs/imports/reports/thunderbolt-duel.json',report)]:file.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
if __name__=='__main__':main()
