"""Regenerate native EXAM/HADES forms and shared balance; source MOD stays read-only."""
from pathlib import Path
import sys,json,importlib.util,copy
from mod_source import ROOT,ASSETS,load,resolve
from v05_balance import apply_balance

def refresh_systems(catalog, unit_ids=None, publish=True):
 forms=[]
 for ref in catalog['units']:
  path=ASSETS/ref;p=json.loads(path.read_text(encoding='utf-8'))
  if unit_ids is not None and p['id'] not in unit_ids:continue
  source=ROOT/p['source'].split('/',1)[1];data=load(source)
  if not p.get('formOnly'):apply_balance(p,data)
  for system in ([] if p.get('formOnly') else ['EXAM','HADES']):
   action=data.get('hiddenAction_'+system+'Start',{});target=action.get('convertTo')
   if not target:continue
   forms.append((p,system,target,data))
  path.write_text(json.dumps(p,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
 spec=importlib.util.spec_from_file_location('bulk',Path('tools/import-0079-page-one.py'));bulk=importlib.util.module_from_spec(spec);spec.loader.exec_module(bulk)
 effects=bulk.read(ASSETS/'effects/effects.json');index={f.stem:f for f in (ROOT/'Units/BattleUnits').rglob('*.ini')}
 for p,system,target,data in forms:
  source=index[target];row={'id':target,'source':source.relative_to(ROOT).as_posix(),'name':p['name']+' ['+system+']','faction':p['faction'],'tags':','.join(p['sourceStats'].get('nativeTags',['MS',p['faction']]))}
  form=bulk.build(row,effects);form['formOnly']=True;form['skills']=[]
  # Native conversion keeps hull resources; only performance and art change.
  form['stats']['hp']=p['stats']['hp'];form['stats']['en']=p['stats']['en'];form['shield']=copy.deepcopy(p['shield'])
  form['stats']['mobility']=max(form['stats']['mobility'],p['stats']['mobility']*1.35)
  form['stats']['accuracy']=max(form['stats']['accuracy'],p['stats']['accuracy']*1.2)
  form['stats']['move']=max(form['stats']['move'],p['stats']['move']+1)
  form['sourceStats']['tacticalMoveBeforeBonus']=form['stats']['move']-1
  for w in form['weapons'].values():
   w['damageComponents']={k:v*1.35 for k,v in w['damageComponents'].items()};w['damagePerShot']=sum(w['damageComponents'].values())
  form['formOf']=p['id'];form['stats']['cost']=p['stats']['cost']
  # Map each base kit to the closest form kit by main weapon ID.
  formMap={}
  for kit in p['weaponKits']:
   chosen=max(form['weaponKits'],key=lambda k:len(set(k['weapons'])&set(kit['weapons'])))
   formMap[kit['id']]=chosen['id']
  from native_movement_effects import import_system_effect
  import_system_effect(system,data,effects)
  skill={'effect':'System_'+system+'_1','id':system,'type':'overdrive','name':system+'系统','range':0,'maxUses':99,'consumeAction':False,'enPercent':25,'duration':3,'hpDrainPercent':10,'enDrainPercent':5,'formUnitId':target,'formKits':formMap}
  sound=data.get('action_'+system,{}).get('playSoundAtUnit','').split(':')
  if len(sound)>=2 and sound[0]=='ROOT':
   native=resolve('ROOT:'+sound[1]);dest=ASSETS/'sounds'/native.name;dest.write_bytes(native.read_bytes());skill['sound']={'file':'../../sounds/'+native.name,'volume':.5}
  p['skills']=[s for s in p.get('skills',[]) if s['id']!=system]+[skill]
  # The actionable skill card is the single source of truth; imported mechanics used to duplicate it.
  p['mechanics']=[m for m in p.get('mechanics',[]) if system not in str(m.get('id','')).upper() and system not in str(m.get('name','')).upper()]
  from weapon_policy import configure
  configure(form,load(source))
  for obj in [p,form]:
   path=ASSETS/f"units/{obj['id']}/unit.json";path.parent.mkdir(parents=True,exist_ok=True);bulk.write(path,obj)
  ref=f'units/{target}/unit.json'
  if ref not in catalog['units']:catalog['units'].append(ref)
  print(p['id'],system,target)
 bulk.write(ASSETS/'effects/effects.json',effects)
 if publish:bulk.write(ASSETS/'unit-catalog.json',catalog)
 return catalog

if __name__=="__main__":
 refresh_systems(json.loads((ASSETS/"unit-catalog.json").read_text(encoding="utf-8")))
