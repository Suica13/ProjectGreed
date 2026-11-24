"""Scoped Battle Operation 2 V5 level-4 Celestial Being import. Source MOD is read-only.

Native unitLevel is a tier (4), not Battle Universe's thousand-scale level.
Raw tier COST and payloads remain native. Shared GBO2 policy and additive
editor adjustments are applied at runtime; same-name weapons are refreshed last.
"""
import os,sys,copy,json,re,importlib.util,argparse,shutil,subprocess
from pathlib import Path
os.environ['PROJECTGREED_MOD_DLC_ROOT']=r'E:/RustedWarfare_Reunion/mods/GundamWars_BattleOperation2_V5'
from mod_source import ROOT,ASSETS,load,parse,section,stat,resolve
from native_combat import native_weapon,damage_spawn,CHANNELS
from weapon_store import dumps
spec=importlib.util.spec_from_file_location('bulk',Path(__file__).with_name('import-0079-page-one.py'))
bulk=importlib.util.module_from_spec(spec);spec.loader.exec_module(bulk)
bulk.MAIN=ROOT;bulk.base.MAIN=ROOT
bulk.CHANNELS=CHANNELS
# Shared files with the same name differ between MOD generations. Namespace
# only collisions and retain the imported resource reference in every consumer.
asset_aliases={}
def scoped_asset(source,target):
 if target.exists() and target.read_bytes()!=source.read_bytes():
  original=target.name;target=target.with_name('GBO2_'+target.name);asset_aliases[original]=target.name
 target.parent.mkdir(parents=True,exist_ok=True)
 if not target.exists():shutil.copyfile(source,target)
 return target.name
def aliases(value):
 if isinstance(value,dict):return {k:aliases(v) for k,v in value.items()}
 if isinstance(value,list):return [aliases(v) for v in value]
 if isinstance(value,str) and '/' in value:
  head,tail=value.rsplit('/',1)
  return head+'/'+asset_aliases.get(tail,tail)
 return value
bulk.asset=scoped_asset;bulk.base.asset=scoped_asset
current_data={}
original_load=load
def payload_load(path,*args,**kwargs):
 data=copy.deepcopy(original_load(path,*args,**kwargs))
 for _ in range(8):
  missing={v['@copyFromSection'] for v in data.values() if '@copyFromSection' in v and v['@copyFromSection'] not in data}
  for key in missing:
   if key not in current_data:raise ValueError('Missing parent '+key)
   data[key]=copy.deepcopy(current_data[key])
 for key in data:
  if key.startswith('projectile_') and 'spawnUnit' in data[key]:data[key]['spawnUnit']=damage_spawn(data[key]['spawnUnit'])
 return data
bulk.load=payload_load
NAMES={'GN_001':('能天使高达','Gundam Exia','ガンダムエクシア'),'GN_002':('力天使高达','Gundam Dynames','ガンダムデュナメス'),'GN_003':('主天使高达','Gundam Kyrios','ガンダムキュリオス'),'GN_003_MA':('主天使高达[MA]','Gundam Kyrios [MA]','ガンダムキュリオス [MA]'),'GN_005':('德天使高达','Gundam Virtue','ガンダムヴァーチェ')}
WEAPONS={'CB_GN_001_BG':('GN剑·步枪模式','GN Sword Rifle Mode','GNソード ライフルモード','beam_rifle',2,5), 'CB_GN_001_Sword_FT':('GN剑','GN Sword','GNソード','melee',1,1),'EF_BeamSaber_Double_DBDF':('双GN光束军刀','Twin GN Beam Sabers','GNビームサーベル二刀流','melee',1,1),'CB_GN_001_GNArmGun':('GN腕部火神炮','GN Arm Vulcans','GNバルカン','vulcan',1,2),'CB_GN_002_BSR':('GN狙击步枪','GN Sniper Rifle','GNスナイパーライフル','sniper',3,7),'EF_BeamSaber_F':('GN光束军刀','GN Beam Saber','GNビームサーベル','melee',1,1),'CB_GN_002_BG_Double':('双GN光束手枪','Twin GN Beam Pistols','GNビームピストル二挺','beam_pistol',1,3),'CB_GN_002_MS':('GN导弹','GN Missiles','GNミサイル','missile',2,5),'CB_GN_003_BMG':('GN光束冲锋枪','GN Beam Submachine Gun','GNビームサブマシンガン','beam_machine_gun',2,4),'EF_BeamSaber_BF':('GN光束军刀','GN Beam Saber','GNビームサーベル','melee',1,1),'CB_GN_003_Combo':('GN盾钳连击','GN Shield Pincer Combo','GNシールド連撃','melee',1,1),'Common_ShieldAttack_BL':('GN盾牌攻击','GN Shield Strike','GNシールド打撃','melee',1,1),'CB_GN_003_GNVulcan':('GN火神炮','GN Vulcans','GNバルカン','vulcan',1,2),'CB_GN_005_GNBazooka_BurstMode':('GN火箭筒·爆发模式','GN Bazooka Burst Mode','GNバズーカ バーストモード','beam_cannon',3,6),'CB_GN_005_GNBazooka':('GN火箭筒','GN Bazooka','GNバズーカ','beam_cannon',2,5),'EF_BeamSaber_A':('GN光束军刀','GN Beam Saber','GNビームサーベル','melee',1,1),'CB_GN_005_BeamCannon':('GN加农炮','GN Cannons','GNキャノン','cannon',3,6)}
def localized(names):return {lang:{'name':n} for lang,n in zip(('zh','en','ja'),names)}
def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--icons',type=Path,default=Path(r'C:/Users/jpex1/OneDrive/桌面/素材/111/4'));args=parser.parse_args()
 effects=bulk.read(ASSETS/'effects/effects.json');report=[];prefabs=[]
 field_source=ROOT/'Resource/Image/Fx/Weapon/Sp/Image/GN_Field_1.png'
 scoped_asset(field_source,ASSETS/'effects/textures/GN_Field_1.png')
 effects['GN_Field']={**effects['I_Field_2'],'texture':'textures/GN_Field_1.png','frames':4,'startFrame':0,'endFrame':3,'fps':12,'scaleFrom':.6,'scaleTo':1,'source':'GundamWars_BattleOperation2_V5/Resource/Image/Fx/Weapon/Sp/Image/GN_Field_1.png'}
 for id,names in NAMES.items():
  global current_data
  native_id=id.replace('_','-',1);path=ROOT/'Units/BattleUnits'/native_id[:6]/(native_id+'.ini');data=load(path)
  # The level-4 form's own initialization is authoritative over inherited defaults.
  current_data=data
  stats=parse(path)['hiddenAction_InitializeStats']['setUnitMemory'];values={k:float(v) for k,v in re.findall(r'(\w+)=(-?[\d.]+)',stats)}
  data=copy.deepcopy(data);data['graphics']['icon_build']=data['graphics']['icon_zoomed_out']
  p=bulk.visual({'id':id,'source':path.relative_to(ROOT).as_posix()},data)
  p.update(name=names[0],localization=localized(names),tags=['CB','AD_2307_T1'],weapons={},weaponKits=[],skills=[],mechanics=[],formOnly=id.endswith('_MA'))
  p['stats'].update(hp=values['baseHpMax'],en=values['baseEnMax'],cost=values['unitLevel']*250,move=round(5*values['baseBoostMoveSpeed']/1.4)+1,mobility=100,accuracy=100,actionPoints=10,vision=round(values['baseFogOfWarSightRange']/5),movementType='air' if values['flyUnit'] else 'ground',adaptability={k:min(100,values[v+'Adaptability']) for k,v in [('ground','ground'),('water','water'),('air','sky'),('space','space')]})
  p['unitTags']=['MS']+(['Aircraft'] if id.endswith('_MA') else [])
  p['sourceStats'].update(nativeLevel=4,hp=values['baseHpMax'],en=values['baseEnMax'],boostSpeed=values['baseBoostMoveSpeed'],technologyEra='AD_2307_T1',technologyWeight=1,costPolicy='GBO2 tier x 250')
  p['shield'].update(hp=values['baseShieldMax'],blockChance=.5 if values['baseShieldMax'] else 0,coverage=1 if values['baseShieldMax'] else 0,requiredParts=['leftArm'] if values['baseShieldMax'] else [])
  icon=args.icons/(id[:6]+'.png');dest=ASSETS/'units'/id/'textures'/icon.name
  if icon.exists():shutil.copyfile(icon,dest)
  elif not dest.exists():raise FileNotFoundError('Missing supplied icon: '+str(icon))
  p['materials']['icon']=icon.name;p['materials']['textures'][icon.name]='textures/'+icon.name
  # Only actions actually equipped by this exact form; inherited weapons of other forms stay unavailable.
  for action in ['action_Weapon'+str(i) for i in range(6)]:
   parent=data.get(action,{}).get('@copyFromSection','')
   if not parent.startswith('template_') or parent in ('template_NoWeapon','template_TransfromAction'):continue
   candidates=[f for f in bulk.graph(path) if '/Weapon/' in f.as_posix() and parent in load(f)]
   if not candidates:raise ValueError('Missing equipped weapon source '+id+'/'+parent)
   source=candidates[-1];weapons=bulk.weapon(p,source,effects)
   if not weapons:raise ValueError('No weapon payload '+str(source))
   # Multi-barrel/sequence wrappers are one weapon, not duplicated complete volleys.
   key,w=weapons[0];w['source']['entry']=action
   if source.stem=='CB_GN_003_Combo':
    # Native contact message continues the pincer sequence after a successful
    # grab. Compile the complete landed attack; normal hit resolution applies.
    data=copy.deepcopy(data)
    data['hiddenAction_CB_GN_003_Combo_Try_Step_Final']['alsoQueueAction']='CB_GN_003_Combo_Start'
   # Dual sabers spawn two independent, identical damaging carriers together.
   if source.stem.startswith('EF_BeamSaber_Double_DBDF'):
    data=copy.deepcopy(data)
    for name in list(data):
     if name.startswith('projectile_EF_BeamSaber_Double_DBDF'):
      raw=data[name].get('spawnUnit','')
      if raw.count('addResources=')==2:
       data[name]['spawnUnit']=damage_spawn(raw).split('),')[0].replace('*1(', '*2(')+')'

   native_weapon(p,w,data)
   if id=='GN_003' and key=='CB_GN_003_Combo':w['pilotRequirements']=[{'stat':'melee','operator':'>=','value':175}]
   base=re.sub(r'_Lv\d+$','',source.stem);label=WEAPONS[base]
   w.update(name=label[0],localization=localized(label[:3]),category={'beam_machine_gun':'machine_gun','beam_pistol':'beam_gun','vulcan':'machine_gun'}.get(label[3],label[3]),min=label[4],max=label[5],actionCost=1,level=2 if '_Lv2' in source.stem else 1)
   w['sourceName']='GBO2_'+base
   w['requiredParts']=list(dict.fromkeys(part for step in w['attack']['steps'] for part in step.get('requiredParts',[])))
   if not w['requiredParts']:w['requiredParts']=['leftArm'] if 'Shield' in base or 'Combo' in base else ['backpack'] if base=='CB_GN_005_BeamCannon' else ['rightArm']
   if label[3]=='vulcan':w['weaponClass']='small_vulcan'
   p['weapons'][base]=w
  p['weaponKits']=[{'id':'default','name':'标准武装','weapons':list(p['weapons']),'primary':next(iter(p['weapons'])),'cost':0}]
  for layer in p['layers']:
   condition=layer.pop('_nativeVisibility','') or ''
   index=re.search(r'nowWeaponIndex\s*==\s*(\d+)',condition)
   if index:layer.setdefault('visibleWhen',{})['weaponDisplayIndex']=int(index[1])
  from native_presentation import correct
  # Reuse mount/visibility correction; GBO2 renamed runtime memory fields.
  saved_stats=copy.deepcopy(p['stats']);saved_source=copy.deepcopy(p['sourceStats'])
  legacy=copy.deepcopy(data);legacy['hiddenAction_GBO2Compatibility']={'setUnitMemory':'enMax=1000, boostMoveSpeed='+str(values['baseBoostMoveSpeed'])+', baseReactionLevel=100, baseAccuracyLevel=100'}
  correct(p,legacy)
  p['stats']=saved_stats;p['sourceStats']=saved_source
  from native_sensors import correct as correct_sensors
  correct_sensors(p,data)
  # GBO2 has no Battle Universe carrier tag. Restore compatibility after
  # native_presentation corrects transport metadata from the source MOD.
  p['transport']={'slotCost':1,'loadTags':['CanLoadInto','CanUseSFS']}
  p['presentation']['shield']=values['baseShieldMax']>0
  dual=p['weapons'].get('CB_GN_002_BG_Double')
  if dual:
   dual['requiredParts']=[];dual['anyParts']=['leftArm','rightArm']
   for step in dual['attack']['steps']:
    if step.get('shots'):
     barrel=dual['source']['barrels'][step.get('muzzleIndex',0)]['id']
     step['requiredParts']=['leftArm' if barrel.endswith('_L') else 'rightArm']
  fixed=p['weapons'].get('CB_GN_002_MS')
  if fixed:fixed['requiredParts']=[]
  from paired_weapons import configure as paired
  paired(p)
  p['sourceStats']['adaptability']={k:values[v+'Adaptability'] for k,v in [('ground','ground'),('water','water'),('air','sky'),('space','space')]}
  for layer in p['layers']:
   bone=layer['bone']
   native_layer='decal_'+layer['name']
   if native_layer in data and re.sub(r'\s+','',section(data,native_layer).get('isVisible','')).lower() in ('false','iffalse'):
    layer['hidden']=True
   parts={'Head':'head','Eye':'head','LeftArm':'leftArm','LeftShoulder':'leftArm','LeftWeapon':'leftArm','RightArm':'rightArm','RightShoulder':'rightArm','RightWeapon':'rightArm','LeftLeg':'leftLeg','LeftFoot':'leftLeg','RightLeg':'rightLeg','RightFoot':'rightLeg'}
   if bone in parts:layer['requiredParts']=[parts[bone]]
   if id=='GN_003' and layer['name'] in ('Shield','Shield_Combo'):
    layer['visibleWhen']={'shieldVisible':True,'attackWeapon':'CB_GN_003_Combo' if layer['name']=='Shield_Combo' else {'not':'CB_GN_003_Combo'}}
  if id=='GN_003_MA':
   p['hangars']=[{'id':'SFS_Slot','name':'SFS','kind':'sfs','capacity':1,'allowedTags':['CanUseSFS'],'launchRange':1,'emergencyRange':3,'offset':{'x':0,'y':0,'height':1},'source':'Template/Unit/Skills/TMS_SFS_Off_Lv2.gw','sourceUnit':'native attachment_SFS_Slot'}]
   p['unitTags'].append('Transport');p['formOf']='GN_003'
  if id in NAMES:
   p['stats'].update(speed=100,partStructuralStrength=100)
   p['stats']['gnField']={'capacity':1,'reduction':1,'piercingReduction':1,'minimumRatio':0,'recoveryPercent':0,'guardOnly':True,'allDamage':True}
   p['stats']['solarFurnace']={'enRecoveryPercent':0,'antiDetect':True,'stealth':True}
   p['mechanics'].extend([{'id':'GNField','status':'adapted','name':'GN立场：仅防御时吸收全部伤害类型'}, {'id':'SolarFurnace','status':'adapted','name':'太阳炉：己方回合恢复5% EN，附带反侦测与隐蔽'}])
  if id=='GN_005':
   import native_irradiation
   native_irradiation.MAIN=ROOT
   def gbo_beam_load(file,*args):
    # V5 stores all palettes in one INI; Battle Universe split them by color.
    renamed=not file.exists() and file.name.endswith('_Pink.ini')
    if renamed:file=file.with_name(file.name.replace('_Pink.ini','.ini'))
    result=copy.deepcopy(load(file,*args))
    if renamed:
     for key in list(result):
      if key.endswith('_Pink'):result[key.removesuffix('_Pink')]=result[key]
    for value in result.values():value.setdefault('imageScaleY','1')
    return result
   native_irradiation.load=gbo_beam_load
   native_irradiation.BEAMS[id]='CB_GN_005_GNBazooka_BurstMode'
   native_irradiation.apply(p,data)
   p['skills'][-1]['effectPrefix']='GBO2_Irradiation'
   for part in ('Start','Mid','End','Charge'):
    source=ROOT/('Resource/Image/Fx/Weapon/Beam/Charge/Image/Beam_Charge_1_Pink.png' if part=='Charge' else f'Resource/Image/Fx/Weapon/Beam/HighMegaCannon/Image/HighMegaCannon_1_{part}_Pink.png')
    name='GBO2_Irradiation_'+part+'_Pink';target=ASSETS/'effects/textures'/(name+'.png');scoped_asset(source,target)
    effect=copy.deepcopy(effects['Irradiation_'+part+'_Pink']);effect['texture']='textures/'+target.name;effect['source']=source.relative_to(ROOT).as_posix();effects[name]=effect
   p['skills'][-1]['effect']='GBO2_Irradiation_Charge_Pink'
  for source in bulk.graph(path):
   if '/Skills/' in source.as_posix() and source.suffix=='.gw':
    adapted=source.stem.startswith('TMS_') or source.stem=='GNField'
    existing=next((m for m in p['mechanics'] if m['id']==source.stem),None)
    if existing:existing['source']=source.relative_to(ROOT).as_posix()
    else:p['mechanics'].append({'id':source.stem,'status':'adapted' if adapted else 'review','name':source.stem,'source':source.relative_to(ROOT).as_posix()})
  p['mechanics']=p.get('mechanics',[])+[{'id':'GBO2Level4','status':'adapted','name':'原MOD 4级普通版，不含Trans-AM'}]
  report.append({'id':id,'source':p['source'],'nativeLevel':4,'hp':p['stats']['hp'],'cost':p['stats']['cost'],'weapons':{k:w['nativeTiming'] for k,w in p['weapons'].items()},'review':['实时弹匣按每次攻击完整原生齐射转换；未接入即时制倒地、DP、刚体控制类被动。GN立场与太阳炉按人工差值配置；仅防御时吸收所有伤害，每己方回合恢复最大容量5%。']})
  prefabs.append(p)
 # These GBO2 definitions are new and exclusively owned by this importer.
 # Refresh their canonical common payload before packing per-model mounts.
 import weapon_store
 definitions=weapon_store.library();seen=set()
 for prefab in prefabs:
  for weapon in [*prefab['weapons'].values(),*[s for s in prefab['skills'] if s.get('sourceWeapon')]]:
   family=weapon['sourceWeapon']+'__skill_'+weapon['type'] if weapon.get('sourceWeapon') else weapon['sourceName']
   ref=family+'__lv'+str(weapon.get('level',1))
   if ref not in seen:
    definitions[ref]={k:v for k,v in aliases(weapon).items() if k not in weapon_store.LOCAL_FIELDS};seen.add(ref)
 weapon_store.LIBRARY.write_text(json.dumps({'schemaVersion':1,'definitions':definitions},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 for p in prefabs:
  if p['id'] in ('GN_003','GN_003_MA'):
   target='GN_003' if p['formOnly'] else 'GN_003_MA'
   p['skills'].append({'id':'Transform','name':'变形','type':'transform','range':0,'maxUses':99,'consumeAction':True,'nativeAction':'template_TransfromAction','effect':'Light_75_NotAttached','sound':{'file':'../../sounds/Transform_4.ogg','volume':.6},'source':{'mode':'transform','unitId':target,'kitId':'default','kitMap':{'default':'default'},'inheritResources':True,'hpRecoveryPercent':0,'enRecoveryPercent':0,'shieldRecoveryPercent':0,'repairAllParts':False}})
  bulk.write(ASSETS/'units'/p['id']/'unit.json',aliases(p))
 catalog=bulk.read(ASSETS/'unit-catalog.json')
 for id in NAMES:
  ref=f'units/{id}/unit.json'
  if ref not in catalog['units']:catalog['units'].append(ref)
 bulk.write(ASSETS/'unit-catalog.json',catalog);bulk.write(ASSETS/'effects/effects.json',effects)
 doc=Path('docs/imports/reports/gbo2-gn-level4.json');doc.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 subprocess.run(['node',str(Path(__file__).with_name('refresh-gbo2-weapons.cjs'))],check=True)
 print('Imported '+', '.join(NAMES))
if __name__=='__main__':main()
