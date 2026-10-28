"""Import Page_00 combat prefabs. Source MOD remains read-only.
Each source weapon/skill is audited; unsupported RTS systems are never silently emulated.
"""
import copy, importlib.util, json, math, re, shutil, sys, subprocess
from pathlib import Path
from mod_source import ROOT, MAIN, ASSETS, parse, load, section, resolve, stat, number
from unit_visuals import BONE_NAMES
from page_one_adaptations import finalize
from unit_introductions import apply_introduction
from unit_muzzle_effects import apply_muzzle_effects
spec=importlib.util.spec_from_file_location('base',Path(__file__).with_name('import-additional-units.py'));base=importlib.util.module_from_spec(spec);spec.loader.exec_module(base)
read,write,asset=base.read,base.write,base.asset
INDEX={p.stem:p for p in (ROOT/'Units/BattleUnits').rglob('*.ini')}
CHANNELS={'BeamDamage':'beam','ShellDamage':'shell','CqbDamage':'melee','CqbBeamDamage':'meleeBeam','CqbShellDamage':'meleeShell'}

def graph(path,seen=None):
 seen=set() if seen is None else seen
 if path in seen:return []
 seen.add(path);out=[]
 for ref in parse(path).get('core',{}).get('copyFrom','').split(','):
  if ref.strip():out+=graph(resolve(ref,path.parent),seen)
 return out+[path]

def numeric(value,data=None,default=0):
 try:return number(value,data)
 except (ValueError,KeyError):
  return default

def val(text,key,default=0):
 m=re.search(r'\b'+re.escape(key)+r'\s*[:=]\s*(-?[\d.]+)',text);return float(m[1]) if m else default

def namekey(bone):return BONE_NAMES.get(bone,'Attachment'+re.sub(r'\D','',bone))

def visual(row,data):
 # Existing MS reader preserves animated limbs and native eye/weapon layers.
 base.unit_source=lambda _:ROOT/row['source']
 base.configure_movement=lambda p,d:p
 base.number=numeric
 filtered=data
 p=base.visuals(row['id'],filtered)
 for layer in p['layers']:
  layer['_nativeVisibility']=layer.pop('_visibility',None)
 # Read omitted rigid-body decals (ships), rotors and looping movement graphics.
 for key in data:
  if not key.startswith('decal_'):continue
  d=section(data,key);name=key[6:]
  if not d.get('image','').startswith('ROOT:') or not d.get('basePositionFromLegEnd') or any(l['name']==name for l in p['layers']):continue
  if any(x in name for x in ['Stun','LowHp','Burned','Shadow']):continue
  source=resolve(d['image']);texture=asset(source,ASSETS/f"units/{p['id']}/textures"/source.name);p['materials']['textures'][texture]='textures/'+texture
  layer=dict(name=name,texture=texture,bone=d['basePositionFromLegEnd'],order=numeric(d.get('order',0)),scale=numeric(d.get('imageScale',1)),offset=dict(x=numeric(d.get('xOffsetRelative',0)),y=numeric(d.get('yOffsetRelative',0))))
  for k,target in [('imageScaleX','scaleX'),('imageScaleY','scaleY'),('dirOffset','rotation'),('alpha','alpha'),('total_frames','frames')]:
   if k in d:layer[target]=numeric(d[k],default=1)
  if layer.get('frames',1)>1:layer.update(frameFps=12,frame=0)
  if 'Boost' in name:layer['visibleWhen']={'moving':True,'boosting':True}
  p['layers'].append(layer)
 # Semantic names include all otherwise-unmapped native joints: never delete used reserves.
 mapping={k:namekey(k) for k in p['skeleton']}
 p['layers']=[l for l in p['layers'] if l['bone'] in mapping]
 for layer in p['layers']:layer['bone']=mapping.get(layer['bone'],layer['bone'])
 p['skeleton']={mapping[k]:v for k,v in p['skeleton'].items()}
 for clip,ref in p['animations'].items():
  path=(ASSETS/f"units/{p['id']}"/ref).resolve();animation=read(path);animation['curves']={mapping.get(k,k):v for k,v in animation['curves'].items() if k in mapping};write(path,animation)
 write(ASSETS/'animations/ImportedIdle.json',{'duration':1,'curves':{}});p['animations']['ImportedIdle']='../../animations/ImportedIdle.json'
 for key in ['idle','move','walk','stagger','dodge']:
  wanted={'idle':'Common_Idle','move':'OnMoving','walk':'OnMovingWalk','stagger':'Common_Stagger','dodge':'Common_Dodge_L'}[key]
  p['presentation'][key]=wanted if wanted in p['animations'] else 'ImportedIdle'
 p['presentation']['movement']='boost' if any('Boost' in l['name'] for l in p['layers']) else 'walk'
 p['layers'].sort(key=lambda l:l['order'])
 return p

def weapon(p,path,effects,attach=None):
 data=load(path);turrets=[k for k in data if k.startswith('turret_') and section(data,k).get('projectile') and section(data,k).get('projectile')!='IGNORE']
 if not turrets:return []
 # Some wrappers define several independent weapons: group by the projectile's native damage payload.
 result=[]
 for tn in turrets:
  t=section(data,tn);key=tn[7:];proj=section(data,'projectile_'+t['projectile']);spawn=proj.get('spawnUnit','')
  components={channel:val(spawn,native) for native,channel in CHANNELS.items() if val(spawn,native)>0}
  if not components:continue
  if any(w[1]['sourceName']==key for w in result):continue
  melee=any(k.startswith('melee') for k in components);kind='melee' if melee else 'beam' if 'beam' in components else 'shell'
  sourceHit=val(spawn,'WeaponAccuracy',100);hit=95 if melee else max(40,min(100,round(sourceHit*.85/5)*5))
  clips=p['animations'];steps=[]
  queue=next((section(data,n).get('alsoQueueAction') for n in data if n.startswith('hiddenAction_'+key) and section(data,n).get('alsoQueueAction')),None)
  start=next((base.animation_clip(section(data,n).get('alsoTriggerAction',''),clips) for n in data if n.startswith('hiddenAction_'+key) and n.endswith('_Fire')),None)
  if queue:
   for action in queue.split(','):
    if 'hiddenAction_'+action.strip() not in data:continue
    d=section(data,'hiddenAction_'+action.strip());step={'delay':numeric(d.get('buildSpeed',0),data)}
    fire=d.get('fireTurretXAtGround');clip=base.animation_clip(d.get('alsoTriggerAction',''),clips)
    if clip:step['animation']=clip
    if fire:
     selected='turret_'+fire
     if selected not in turrets:continue
     shot=section(data,'projectile_'+d.get('fireTurretXAtGround_withProjectile',section(data,selected)['projectile'])).get('spawnUnit','')
     step.update(shots=min(32,int(re.search(r'\*(\d+)',shot)[1]) if re.search(r'\*(\d+)',shot) else 1),muzzleIndex=turrets.index(selected))
    steps.append(step)
  if not any(s.get('shots') for s in steps):
   own=path.read_text(encoding='utf-8-sig');count=re.search(r'@global\s+\w+_Shoot\s*=\s*(\d+)',own)
   count=min(40,int(count[1])) if count else 1
   if count==0:continue
   shots=min(32,int(re.search(r'\*(\d+)',spawn)[1])) if re.search(r'\*(\d+)',spawn) else 1
   steps=[{'delay':max(.05,min(.3,numeric(t.get('delay',.12),default=.12))),'shots':shots,'repeat':count}]
  if sum(s.get('shots',0)*s.get('repeat',1) for s in steps)>128:raise ValueError('Native volley exceeds safe playback limit: '+key)
  steps.append({'delay':.3})
  maximum=1 if melee else max(2,min(10,round(numeric(t.get('limitingRange',stat(data,'baseAttackRange',450)),default=450)/100)))
  label=base.WEAPONS.get(key,(None,))[0] or key.replace('_',' ')
  w=dict(name=label,type=kind,min=1,max=maximum,hit=hit,en=12.5 if melee else 15,sourceName=key,sourceHit=sourceHit,hitMultiplier=.85,hitBonus=hit-math.floor(sourceHit*.85+.5),slot='secondary' if melee else 'primary',
   clip=start,damagePerShot=sum(components.values()),damageComponents=components,hitsPerShot=1,attack={'steps':steps,'startAnimation':start},requiredParts=[],partBreakModifier=val(spawn,'PartBreakModifier',1),changeHeldWeapon=not attach,
   source={'file':path.relative_to(ROOT).as_posix(),'barrels':[{'id':n[7:]} for n in turrets]})
  if melee:w.update(hitEffect='Cqb_Hit_1',swingEffects=['Cqb_Fire_1_Pink_R','Cqb_Fire_1_Pink_L'])
  else:
   projectileId=re.match(r'\w+',spawn)[0];candidates=list((MAIN/'Units/BattleUnits/Weapon').rglob(projectileId+'.ini'))+list((ROOT/'Units/BattleUnits/Weapon').rglob(projectileId+'.ini'))
   if not candidates:
    # Native spawn IDs need not match filenames (Public-class diffusion missile).
    candidates=[file for root in (MAIN,ROOT) for file in (root/'Units/BattleUnits/Weapon').rglob('*.ini') if parse(file).get('core',{}).get('name')==projectileId]
   if not candidates:raise ValueError('Missing native projectile '+projectileId)
   bulletRoot=MAIN if candidates[0].is_relative_to(MAIN) else ROOT
   bullet=load(candidates[0],bulletRoot)
   if projectileId.startswith('Projectile_MortarMarker'):
    nextId='Projectile_Mortar_FromSky';nextFile=next((MAIN/'Units/BattleUnits/Weapon').rglob(nextId+'.ini'));bullet=load(nextFile,MAIN);bulletRoot=MAIN
   decal=next((n for n in bullet if n=='decal_Projectile_Image'),None) or next((n for n in bullet if n.startswith('decal_') and section(bullet,n).get('image','').startswith('ROOT:')),None)
   if not decal:
    effectSource=next((n for n in bullet if n.startswith('effect_') and section(bullet,n).get('image','').startswith('ROOT:')),None)
    if not effectSource:raise ValueError('No native projectile image: '+projectileId)
    decal=effectSource
   d=section(bullet,decal);image=resolve(d['image'],root=bulletRoot);asset(image,ASSETS/'projectiles'/image.name)
   w['projectile']=dict(texture='../../projectiles/'+image.name,scale=numeric(d.get('imageScale',1)),speed=max(5,val(spawn,'ProjectileSpeed',50)*(.5 if any(k in key for k in ['Bazooka','Cannon','MS_']) else 1)),forwardOffset=numeric(d.get('yOffsetRelative',0)),rotation=numeric(d.get('dirOffset',0)))
   if 'hiddenAction_SpawnHitEffect' not in bullet:bullet={**bullet,'hiddenAction_SpawnHitEffect':bullet.get('hiddenAction_SpawnDeleteEffect',{'spawnEffects':'Explosion_Hit_1'})}
   hook=bullet['hiddenAction_SpawnHitEffect'].get('spawnEffects','')
   if hook=='IGNORE' or not hook or 'effect_'+hook.split(',')[0].strip() not in bullet and hook.split(',')[0].strip() not in effects:w['hitEffect']='Explosion_Hit_1'
   else:w['hitEffect']=base.import_effect(bullet,effects)
   mounts=[]
   for name in turrets:
    turret=section(data,name);bone=attach['bone'] if attach else 'Head' if 'Vulcan_MS' in key else 'Body' if 'Body' in p['skeleton'] else next(iter(p['skeleton']))
    # Held guns use their visible texture pose; fixed guns follow the appropriate rigid joint.
    if not attach and any(l['name']==name[7:] for l in p['layers']):
     legacy=copy.deepcopy(p);inverse={v:k for k,v in BONE_NAMES.items()};legacy['skeleton']={inverse.get(k,k):v for k,v in legacy['skeleton'].items()}
     for l in legacy['layers']:l['bone']=inverse.get(l['bone'],l['bone'])
     mount=base.mount(legacy,turret,name[7:]);mounts.append(mount)
    else:
     j=p['skeleton'][bone];mounts.append({'bone':bone,'offset':{'x':numeric(turret.get('barrelX',0))-(0 if attach else j.get('x',0)),'y':numeric(turret.get('barrelY',0))-(0 if attach else j.get('y',0))}})
   w['muzzle']={'mounts':mounts}
  if t.get('shoot_sound','').startswith('ROOT:'):
   sound=resolve(t['shoot_sound']);asset(sound,ASSETS/'sounds'/sound.name);w['sound']={'file':'../../sounds/'+sound.name,'volume':min(1,numeric(t.get('shoot_sound_vol',.5)))}
  w['targetModifiers']={k:val(spawn,n,1) for k,n in [('air','AntiAir'),('water','AntiAqua'),('ground','AntiLand'),('space','AntiSpace')]}
  if attach:
   module=attach['id'];w['moduleIds']=[module]
   for step in steps:
    if step.get('shots'):step['moduleId']=module
  if all(section(data,n).get('shoot_flame','') and 'effect_'+section(data,n)['shoot_flame'] in data for n in turrets):apply_muzzle_effects({'id':p['id'],'weapons':{key:w}},data,effects)
  elif not melee:w['source']['muzzleNote']='Native weapon has no standalone muzzle flash'
  result.append((key,w))
 return result

def build(row,effects):
 path=ROOT/row['source'];data=load(path);files=graph(path);refs=[f for f in files if '/Units/BattleUnits/Weapon/' in f.as_posix()]
 p=visual(row,data);tags=[t.strip() for t in row['tags'].split(',')];ship='Ship' in tags;modular=ship or row['id'] in ('Medea','FatUncle');air='Aircraft' in tags;amphib='Amphibious' in tags or stat(data,'waterAdaptability')>=100 and 'MS' in tags
 skillfiles=[f for f in files if '/Template/Unit/Skill/' in f.as_posix()];skillnames=[f.stem for f in skillfiles]
 moveType='air' if air else 'naval' if 'NavyUnit' in tags else 'amphibious' if amphib else 'hover' if 'Hover' in skillnames else 'ground'
 p.update(name=row['name'],faction=row['faction'],tags=[row['faction'],'0079'],localization={'zh':{'name':row['name']},'en':{'name':data['core'].get('displayText',row['id'])}})
 p['stats'].update(hp=numeric(data['core']['maxHp']),accuracy=max(1,stat(data,'baseAccuracyLevel',100)),mobility=max(1,stat(data,'baseReactionLevel',100)),partStructuralStrength=max(1,stat(data,'partStructuralStrength',100)),partsBreakable='MS' in tags,movementType=moveType,adaptability={'ground':min(100,max(stat(data,'groundAdaptability'),stat(data,'skyAdaptability') if air else 0,100 if moveType=='naval' else 0)),'space':0 if moveType=='naval' else max(50,min(100,stat(data,'spaceAdaptability',50)))},ship=ship)
 p['shield']['blockChance']=min(1,max(0,p['shield']['blockChance']));p['shield']['coverage']=min(1,max(0,p['shield']['coverage']))
 p['weapons']={};p['mechanics']=[]
 for f in refs:
  if '/Sp/' in f.as_posix():continue
  for k,w in weapon(p,f,effects):p['weapons'].setdefault(k,w)
 if modular:
  p['stats']['modules']=[]
  if ship:p['stats']['footprint']={'width':3,'height':6}
  # Native attached weapons are not merged into hull guns: each module retains its own HP and muzzle.
  for key in data:
   if not key.startswith('attachment_') or not ('Turret' in key or 'Weapon' in key):continue
   d=section(data,key);spawn=d.get('onCreateSpawnUnitOf')
   action=data.get('hiddenAction_'+key,{})
   spawn=spawn or action.get('attachments_addNewUnits')
   if not spawn:continue
   ident=spawn.split('*')[0].split('(')[0].strip();source=INDEX.get(ident)
   if not source:continue
   native=load(source);module=key[11:];bone='Turret_'+module;p['skeleton'][bone]={'x':numeric(d.get('x',0)),'y':numeric(d.get('y',0)),'endDirOffset':numeric(d.get('idleDir',0))}
   p['stats']['modules'].append({'id':module,'name':module,'hp':max(1,numeric(native['core']['maxHp'])),'bone':bone,'x':numeric(d.get('x',0)),'y':numeric(d.get('y',0)),'idleDir':numeric(d.get('idleDir',0)),'arc':360,'damageToHull':1})
   for dn in native:
    if not dn.startswith('decal_'):continue
    layer=section(native,dn)
    if not layer.get('image','').startswith('ROOT:') or 'Turret' not in dn:continue
    image=resolve(layer['image']);asset(image,ASSETS/f"units/{p['id']}/textures"/image.name);p['materials']['textures'][image.name]='textures/'+image.name
    p['layers'].append({'name':module,'bone':bone,'texture':image.name,'order':3,'scale':numeric(layer.get('imageScale',1)),'moduleId':module})
   for k,w in weapon(p,source,effects,{'id':module,'bone':bone}):p['weapons'][k+'__'+module]=w
  if ship:p['presentation'].update(mapScale=1,battleScale=.9,deathType='large')
 if modular:
  groups={}
  for key,w in p['weapons'].items():
   native=w['sourceName']
   if '__' not in key:groups[key]=w;continue
   if native not in groups:groups[native]=w;continue
   g=groups[native];offset=len(g['muzzle']['mounts']);g['muzzle']['mounts']+=w['muzzle']['mounts'];g['moduleIds']+=w['moduleIds'];g['source']['barrels']+=w['source']['barrels']
   if g.get('muzzleEffects') and w.get('muzzleEffects'):g['muzzleEffects']+=w['muzzleEffects']
   # Modules fire concurrently; store absolute times then convert back into ordinary delayed Steps.
   timeline=[]
   for entry,shift in [(g,0),(w,offset)]:
    at=0
    for step in entry['attack']['steps']:
     for _ in range(step.get('repeat',1)):
      at+=step.get('delay',0)
      if step.get('shots'):timeline.append((at,{**step,'repeat':1,'muzzleIndex':step.get('muzzleIndex',0)+shift}))
   timeline.sort(key=lambda x:x[0]);steps=[];at=0
   for time,step in timeline:step['delay']=round(time-at,6);at=time;steps.append(step)
   steps.append({'delay':.3});g['attack']['steps']=steps
  p['weapons']=groups
 # Preserve all source primary choices as independent kits, with fixed weapons shared.
 primary=[k for k,w in p['weapons'].items() if w['type']!='melee' and not ('Vulcan' in k or '__' in k)]
 fixed=[k for k in p['weapons'] if k not in primary]
 if ship:primary=[];fixed=list(p['weapons'])
 p['weaponKits']=[{'id':'standard','name':'标准武装','cost':0,'weapons':list(p['weapons'])}]
 if len(primary)>1 and 'MS' in tags:
  p['weaponKits']=[{'id':'kit_'+str(i),'name':p['weapons'][k]['name']+'套件','cost':100 if any(x in k for x in ['Cannon','Rifle','_BR']) else 50 if any(x in k for x in ['Bazooka','Missile']) else 0,'weapons':[k,*fixed]} for i,k in enumerate(primary)]
 for layer in p['layers']:
  condition=layer.pop('_nativeVisibility','') or ''
  held=next((k for k in p['weapons'] if layer['name']==k or layer['name']==k+'_NotUsing'),None)
  if held:layer['visibleWhen']={'heldWeapon':{'not':held} if 'NotUsing' in layer['name'] else held}
 # Turn-based supply explicitly replaces the source real-time recovery tick.
 if any(n.startswith('SupplyPoint') for n in skillnames):
  p['skills']=[dict(id='FieldMaintenance',type='repair',name='战场整备',range=2,maxUses=99,consumeAction=True,enCost=20,hpRecoveryPercent=25,enRecoveryPercent=30,shieldRecoveryPercent=20,effect='Light_75_NotAttached',sound={'file':'../../sounds/Transform_4.ogg','volume':.4})]
 # Audit native skill provenance separately from actionable skill buttons.
 for f in skillfiles:p['mechanics'].append({'id':f.stem,'source':f.relative_to(ROOT).as_posix(),'status':'adapted' if f.stem.startswith('SupplyPoint') else 'implemented' if f.stem in ['Hover'] else 'review','name':'整备：消耗行动恢复附近友军HP、EN和盾牌' if f.stem.startswith('SupplyPoint') else f.stem})
 p['mechanics'].insert(0,{'id':'movement','name':moveType,'status':'implemented'})
 p['sourceStats']['nativeTags']=tags;p['sourceStats']['nativeSkills']=skillnames
 apply_introduction(p,data)
 from animation_pool import share
 return share(finalize(p,row,data))

def main():
 sys.stdout.reconfigure(encoding='utf-8');catalog=read(ASSETS/'unit-catalog.json');effects=read(ASSETS/'effects/effects.json');existing={'RGM_79','RGC_80','RGM_79L','MS_06F','MS_09','RGM_79_G','MS_06J','MS_06K','MS_14A','RX_79_G','MS_06F2','MS_09R','SalamisClass','RX_78_1','FF_X7'};report=[]
 for row in read(Path(__file__).with_name('0079-page-one-manifest.json')):
  if 'Pilot' in row['tags'].split(','):continue
  if row['id'] in existing:report.append({'id':row['id'],'status':'existing'});continue
  try:
   p=build(row,effects);write(ASSETS/f"units/{p['id']}/unit.json",p)
   report.append({'id':row['id'],'status':'imported','weapons':len(p['weapons']),'mechanics':p['mechanics']});print('OK',row['id'],len(p['weapons']))
  except Exception as e:report.append({'id':row['id'],'status':'error','error':str(e)});print('ERROR',row['id'],str(e))
 write(Path(__file__).with_name('0079-import-report.json'),report);write(ASSETS/'effects/effects.json',{**read(ASSETS/'effects/effects.json'),**effects})
 # Only expose the batch when every prefab has passed import, followed by loader validation.
 if any(r['status']=='error' for r in report):raise SystemExit('Import failed; unit catalog was not updated.')
 for r in report:
  ref=f"units/{r['id']}/unit.json"
  if ref not in catalog['units']:catalog['units'].append(ref)
 from special_systems import refresh_systems
 catalog=refresh_systems(catalog)
 from refresh_weapon_skills import refresh
 refresh()
 node=shutil.which('node')
 if not node:raise SystemExit('Node.js is required to validate imported units before updating the catalog. Add Node.js to PATH.')
 check=subprocess.run([node,'-e',"require('./tools/load-catalog.cjs').loadCatalog({catalogOverride:JSON.parse(require('fs').readFileSync(0,'utf8'))})"],input=json.dumps(catalog),text=True,cwd=ASSETS.parent,capture_output=True)
 if check.returncode:raise SystemExit(check.stderr)
 write(ASSETS/'unit-catalog.json',catalog)
if __name__=='__main__':main()
