"""Source-backed corrections shared by batch import and existing-prefab migration.
Native conditions become plain requirements; no MOD expression is executed at runtime.
"""
import copy,json,re
from pathlib import Path
from mod_source import ROOT,ASSETS,load,section,resolve,number
LEGACY=set('RGM_79 RGC_80 RGM_79L MS_06F MS_09 RGM_79_G MS_06J MS_06K MS_14A RX_79_G MS_06F2 MS_09R SalamisClass RX_78_1 FF_X7'.split())
def num(v,default=0):
 try:return number(v)
 except (ValueError,KeyError,TypeError):return default

def family(w):
 return re.sub(r'_(?:L|R)$','',w.get('sourceName',''))

def conditions(data,w):
 stem=Path(w['source']['file']).stem;name=family(w)
 candidates=[(k,section(data,k)) for k in data if k.startswith('hiddenAction_') and k.endswith('_Trigger') and (k[13:-8] in [stem,name,w.get('sourceName')] or section(data,k).get('alsoTriggerAction','').strip() in [stem+'_Fire',name+'_Fire'])]
 return [d.get('requireConditional','') for _,d in candidates]

def tank_turrets(p,data):
 if p['stats'].get('ship'):return
 turrets=[]
 for key in data:
  if not key.startswith('decal_'):continue
  d=section(data,key);tid=d.get('basePositionFromTurret');image=d.get('image','')
  if not tid or not image.startswith('ROOT:') or d.get('isVisible','').strip() in ['false','if false']:continue
  native=section(data,'turret_'+tid) if 'turret_'+tid in data else {};bone='Turret_'+tid
  x,y=num(native.get('x')),num(native.get('y'));idle=num(native.get('idleDir'))
  attached=native.get('attachedTo')
  if attached and 'turret_'+attached in data:
   parent=section(data,'turret_'+attached);x+=num(parent.get('x'));y+=num(parent.get('y'))
  p['skeleton'][bone]={'x':x,'y':y,'endDirOffset':idle}
  source=resolve(image);dest=ASSETS/f"units/{p['id']}/textures"/source.name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(source.read_bytes())
  p['materials']['textures'][source.name]='textures/'+source.name
  layer={'name':key[6:],'bone':bone,'texture':source.name,'order':max(3,num(d.get('order',3))),'scale':num(d.get('imageScale',1),1),'offset':{'x':num(d.get('xOffsetRelative')),'y':num(d.get('yOffsetRelative'))},'rotation':num(d.get('dirOffset'))}
  p['layers']=[l for l in p['layers'] if l['name']!=key[6:]]+[layer]
  turrets.append({'id':tid,'bone':bone,'idleDir':idle,'arc':180})
  for w in p['weapons'].values():
   for i,b in enumerate(w.get('source',{}).get('barrels',[])):
    if b['id']==tid and i<len(w.get('muzzle',{}).get('mounts',[])):
     w['muzzle']['mounts'][i]={'bone':bone,'offset':{'x':num(native.get('barrelX')),'y':num(native.get('barrelY'))},'alternatingOffsetX':num(native.get('barrelOffsetX_onOddShots'))}
 if turrets:p['stats']['visualTurrets']=list({t['id']:t for t in turrets}.values())
 p['layers'].sort(key=lambda l:l.get('order',0))

def add_subshots(w,p=None):
 """Include immediate firing sub-actions omitted by the old queue importer."""
 native=load(ROOT/w['source']['file']);barrels=[b['id'] for b in w['source'].get('barrels',[])];name=family(w)
 queue=next((section(native,k).get('alsoQueueAction') for k in native if k.startswith('hiddenAction_'+name) and section(native,k).get('alsoQueueAction')),None)
 if not queue and p is not None:
  stem=Path(w['source']['file']).stem
  queue=next((section(native,k).get('alsoQueueAction') for k in native if k.startswith('hiddenAction_'+stem) and section(native,k).get('alsoQueueAction')),None)
  if queue:
   steps=[];hits=0
   for a in queue.split(','):
    action='hiddenAction_'+a.strip()
    if action not in native:continue
    d=section(native,action);step={'delay':num(d.get('buildSpeed',0))}
    clip=next((c for c in sorted(p['animations'],key=len,reverse=True) if 'Play'+c in d.get('alsoTriggerAction','')),None)
    if clip:step['animation']=clip
    if d.get('fireTurretXAtGround') in barrels:
     step.update(shots=1,muzzleIndex=barrels.index(d['fireTurretXAtGround']))
     if w['type']=='melee' and hits:step['damageMultiplier']=.5
     hits+=1
    steps.append(step)
   if hits:w['attack']['steps']=steps+[{'delay':.3}]
   return
 if not queue:return
 # Match each native queue shot to its existing balanced shot; only append missing sub-barrels.
 subs={}
 def visit(action,seen):
  key='hiddenAction_'+action.strip()
  if key not in native or key in seen:return []
  d=section(native,key);out=[];fire=d.get('fireTurretXAtGround')
  if fire in barrels:
   spawn=section(native,'projectile_'+d.get('fireTurretXAtGround_withProjectile',section(native,'turret_'+fire).get('projectile',''))).get('spawnUnit','')
   count=re.search(r'\*(\d+)',spawn);out.append((barrels.index(fire),min(32,int(count[1])) if count else 1))
  for child in d.get('alsoTriggerAction','').split(','):out+=visit(child,seen|{key})
  return out
 for a in queue.split(','):
  key='hiddenAction_'+a.strip()
  if key not in native:continue
  d=section(native,key);fire=d.get('fireTurretXAtGround');children=[]
  for child in d.get('alsoTriggerAction','').split(','):children+=visit(child,{key})
  if fire in barrels and children:subs[barrels.index(fire)]=children
 if subs:
  steps=[]
  for step in w['attack']['steps']:
   steps.append(step)
   if step.get('shots') and step.get('muzzleIndex',0) in subs:
    for index,count in subs[step.get('muzzleIndex',0)]:steps.append({**step,'delay':0,'shots':count,'muzzleIndex':index})
  w['attack']['steps']=steps

def merge_positions(p):
 groups={}
 for key,w in p['weapons'].items():groups.setdefault((w['source']['file'],family(w)),[]).append(key)
 remap={}
 for (_,fam),keys in groups.items():
  if len(keys)<2:continue
  canonical=next((k for k in keys if p['weapons'][k].get('sourceName')==fam),keys[0]);g=p['weapons'][canonical]
  # Root native flow already includes L/R. Preserve every physical module once.
  modules=set(g.get('moduleIds',[]));timelines=[]
  def timeline(w,shift=0):
   at=0;out=[]
   for s in w['attack']['steps']:
    for _ in range(s.get('repeat',1)):
     at+=s.get('delay',0)
     if s.get('shots'):out.append((at,{**s,'repeat':1,'muzzleIndex':s.get('muzzleIndex',0)+shift}))
   return out
  timelines=timeline(g)
  for key in keys:
   if key==canonical:continue
   other=p['weapons'][key];newmodules=set(other.get('moduleIds',[]))-modules
   if not modules and g.get('sourceName') != fam:
    # Automatic L/R guns lack a dispatcher action. Each physical barrel fires once.
    barrels=[b['id'] for b in g['source']['barrels']]
    index=barrels.index(other['sourceName']) if other['sourceName'] in barrels else 0
    timelines += [(at,{**step,'muzzleIndex':index}) for at,step in timeline(other)]
   if newmodules:
    # A module can occur in both root and side variants; only add genuinely missing modules.
    offset=len(g.get('muzzle',{}).get('mounts',[]));g['muzzle']['mounts']+=copy.deepcopy(other['muzzle']['mounts']);g['source']['barrels']+=copy.deepcopy(other['source']['barrels'])
    if g.get('muzzleEffects') and other.get('muzzleEffects'):g['muzzleEffects']+=copy.deepcopy(other['muzzleEffects'])
    timelines +=[(at,s) for at,s in timeline(other,offset) if s.get('moduleId') in newmodules]
    modules|=newmodules
   other['availability']={'hidden':True,'reasons':['merged_position'],'mergedInto':canonical}
   remap[key]=canonical
  if modules:g['moduleIds']=sorted(modules)
  timelines.sort(key=lambda item:item[0]);steps=[];at=0
  for time,s in timelines:s['delay']=round(time-at,6);at=time;steps.append(s)
  g['attack']['steps']=steps+[{'delay':.3}]
  g['mergedPositions']=keys
 return remap

def surcharge(key):
 if re.search('Cannon|Rifle|_BR|_BR_',key):return 100
 if re.search('BeamGun|BeamSpray',key):return 75
 if re.search('Bazooka|Missile|Launcher|(?:^|_)MS(?:_|$)|SMS',key):return 50
 return 0

def visibility_and_deferred(p,data):
 # Hidden loadouts must not leave their holstered textures visible on the unit.
 for key,w in p['weapons'].items():
  if w.get('availability',{}).get('mergedInto'):continue
  stem=Path(w['source']['file']).stem
  for layer in p['layers']:
   if not (layer['name']==stem or layer['name'].startswith(stem+'_') or layer['name']==key):continue
   if w.get('availability',{}).get('hidden'):
    layer['hidden']=True
   elif 'decal_'+layer['name'] in data:
    native=section(data,'decal_'+layer['name'])
    if 'nowWeaponIndex' in native.get('isVisible',''):
     layer['visibleWhen']={'heldWeapon':{'not':key} if 'NotUsing' in layer['name'] else key}
     kits=[k['id'] for k in p['weaponKits'] if key in k['weapons']]
     if kits:layer['visibleWhen']['kit']=kits
 from native_presentation import correct_shared_weapon_layers
 correct_shared_weapon_layers(p,data)
 known={Path(w['source']['file']).stem for w in p['weapons'].values()}
 deferred=[]
 for key in data:
  if not key.startswith('hiddenAction_') or not key.endswith('_Trigger'):continue
  name=key[13:-8];condition=section(data,key).get('requireConditional','');reasons=[]
  if name in known:continue
  if re.search(r'pilot\w*(?:Skill|Level)|pilot\w*Final',condition,re.I):reasons.append('pilot_skill')
  slots=[{'slot':int(m[1]),'choice':int(m[2])} for m in re.finditer(r'EquipmentIndex(\d+)\s*==\s*(\d+)',condition)]
  if any(s['choice']!=0 for s in slots):reasons.append('secondary_loadout')
  if reasons:deferred.append({'id':name,'name':name,'hidden':True,'reasons':reasons,'secondarySlots':slots,'sourceTrigger':key})
 p['deferredWeapons']=deferred
 return p

def kit_names(p):
 for kit in p['weaponKits']:
  name = '标准套件' if len(p['weaponKits']) == 1 else None
  if p['id'] in ('RX_80PR_2', 'RX_80PR_2_HADES') and kit['id'] == 'kit_0':
   name = '复合发射器套件'
  if name:
   kit['name'] = name
   if 'zh' in kit.get('localization', {}):kit['localization']['zh']['name'] = name
 return p

def correct(p,row,data):
 from native_passives import apply_command_auras
 apply_command_auras(p,data)
 from v05_balance import apply_balance
 if p.get('nativeLayoutRevision')==1:return kit_names(apply_balance(visibility_and_deferred(p,data),data))
 oldkits=copy.deepcopy(p['weaponKits']);tank_turrets(p,data)
 # World-space command/range overlays must never become hull-sized sprite decals.
 p['layers']=[l for l in p['layers'] if '/Ring/' not in section(data,'decal_'+l['name']).get('image','') ] if all('decal_'+l['name'] in data for l in p['layers']) else [l for l in p['layers'] if not any(x in l['name'] for x in ['cmdCom_Range','cmdDef_Range','SupplyRange','ReEntry_Range'])]
 hidden=[];main={}
 for key,w in p['weapons'].items():
  cond=conditions(data,w);reasons=[]
  if any(re.search(r'pilot\w*(?:Skill|Level)|pilot\w*Final',c,re.I) for c in cond):reasons.append('pilot_skill')
  slots=[(int(m[1]),int(m[2])) for c in cond for m in re.finditer(r'EquipmentIndex(\d+)\s*==\s*(\d+)',c)]
  if any(index!=0 for slot,index in slots):reasons.append('secondary_loadout')
  if reasons:
   requirements=[]
   for c in cond:
    for match in re.finditer(r'readUnitMemory\("(pilot[^"]+)"[^)]*\)\s*>\s*([\d.]+)',c):requirements.append({'stat':match[1],'greaterThan':float(match[2])})
   w['availability']={'hidden':True,'reasons':reasons,'requirements':requirements,'secondarySlots':[{'slot':slot,'choice':index} for slot,index in slots]};hidden.append(key)
  matches=[int(m[1]) for c in cond for m in re.finditer(r'EquipmentIndex\s*==\s*(\d+)',c)]
  if matches and not reasons:main[key]=matches[0]
  if p['id'] not in LEGACY:add_subshots(w,p)
 remap=merge_positions(p) if p['id'] not in LEGACY else {}
 active=[k for k,w in p['weapons'].items() if not w.get('availability',{}).get('hidden')]
 if p['id'] in LEGACY:
  for kit in p['weaponKits']:kit['weapons']=[k for k in kit['weapons'] if k in active]
 else:
  primary=sorted([k for k in main if k in active],key=lambda k:(main[k],k))
  fixed=[k for k in active if k not in primary]
  p['weaponKits']=[{'id':'standard','name':'标准武装','cost':0,'weapons':active}]
  if primary:
   p['weaponKits']=[{'id':next((k['id'] for k in oldkits if k['weapons'] and k['weapons'][0]==key),'main_'+str(main[key])),'name':p['weapons'][key]['name']+'套件','cost':surcharge(key),'weapons':[key,*fixed]} for key in primary]
  # Multiple weapons in the same equipment slot are one kit, not alternatives.
  grouped={}
  for kit in p['weaponKits']:
   slot=main.get(kit['weapons'][0],-1) if kit['weapons'] else -1
   if slot in grouped:
    target=grouped[slot];target['weapons']=list(dict.fromkeys(target['weapons']+kit['weapons']))
   else:grouped[slot]=kit
  p['weaponKits']=list(grouped.values())
  aliases={}
  for old in oldkits:
   if any(k['id']==old['id'] for k in p['weaponKits']):continue
   best=max(p['weaponKits'],key=lambda k:len(set(k['weapons'])&set(remap.get(w,w) for w in old['weapons'])))
   aliases[old['id']]=best['id']
  if aliases:p['kitAliases']=aliases
 p['nativeLayoutRevision']=1
 return kit_names(apply_balance(visibility_and_deferred(p,data),data))

def main():
 rows=json.loads(Path(__file__).with_name('0079-page-one-manifest.json').read_text(encoding='utf-8'));catalog=json.loads((ASSETS/'unit-catalog.json').read_text(encoding='utf-8'));byid={r['id']:r for r in rows}
 report=[]
 for ref in catalog['units']:
  path=ASSETS/ref;p=json.loads(path.read_text(encoding='utf-8'));row=byid.get(p['id'])
  if not row:continue
  p=correct(p,row,load(ROOT/row['source']));path.write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
  report.append({'id':p['id'],'kits':len(p['weaponKits']),'hidden':{k:w['availability'] for k,w in p['weapons'].items() if w.get('availability')},'cost':p.get('costBalance')})
 Path('tools/0079-layout-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 print('Corrected',len(report),'prefabs')
if __name__=='__main__':main()
