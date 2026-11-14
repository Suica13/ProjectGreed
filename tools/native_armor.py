"""Native ABC/PS coating rules and their visual state; MOD is read-only."""
import re
import functools
from mod_source import MOD,MAIN,ASSETS,load,section
from native_combat import globals_for

@functools.lru_cache(None)
def ensure_abc_assets():
 from weapon_store import loads,dumps
 from native_melee_effects import import_effect
 path=ASSETS/'effects/effects.json';effects=loads(path.read_text(encoding='utf8'))
 import_effect('ABC_1',load(MAIN/'Resource/Image/Fx/Unit/ABC_1.gw'),effects)
 path.write_text(dumps(effects,ensure_ascii=False,indent=2)+'\n',encoding='utf8')

def apply(prefab,native=None):
 native=native or load(MOD/prefab['source'])
 values=globals_for(MOD/prefab['source'])
 skills=set(prefab.get('sourceStats',{}).get('nativeSkills',[]))
 mechanics=prefab.setdefault('mechanics',[])
 skills.update(m.get('id') for m in mechanics)
 for kind,ident,capacity,level,channels,name in [
  ('abc','ABC','ABCHpMax','ABCLevel',{'beam':1,'beamAP':.25,'meleeBeam':.5,'meleeBeamAP':.25},'ABC'),
  ('phaseShift','PSA','PSAHpMax','PSALevel',{'shell':1,'shellAP':.25,'melee':.25,'meleeShell':.5,'meleeAP':.25,'meleeShellAP':.25},'PS Armor')]:
  if ident not in skills:continue
  if kind=='abc':ensure_abc_assets()
  factor=float(values[level]);config={'capacity':float(values[capacity]),'reductions':{k:v*factor for k,v in channels.items()}}
  if kind=='phaseShift':
   config['energyPercent']=20
   prefab['skills']=[s for s in prefab.get('skills',[]) if s['id']!='PhaseShift']
   prefab['skills'].append(dict(id='PhaseShift',type='phase_shift',name='PS\u88c5\u7532\u5f00\u5173',range=0,enCost=0,maxUses=99,consumeAction=False,effect='Light_75_NotAttached',sound={'file':'../../sounds/Transform_4.ogg','volume':.4},
    localization={'zh':{'name':'PS\u88c5\u7532\u5f00\u5173'},'en':{'name':'Toggle PS Armor'},'ja':{'name':'PS\u88c5\u7532\u5207\u66ff'}}))
   for layer in prefab['layers']:
    key='decal_'+layer['name']
    if key not in native:continue
    condition=section(native,key).get('isVisible','')
    match=re.search(r'memory.PSAActive\s*==\s*(true|false)',condition)
    if match:layer.setdefault('visibleWhen',{})['phaseShiftActive']=match[1]=='true'
  prefab['stats'][kind]=config
  for m in mechanics:
   if m['id']==ident:m.update(status='adapted',name=name+' finite coating; native channel reductions and resource costs')
 if prefab['stats'].get('iField'):
  prefab['stats']['iField']['recoveryPercent']=5
  for m in mechanics:
   if m['id']=='I_Field':m['name']='I\u7acb\u573a\uff1a\u6bcf\u56de\u5408\u6062\u590d5%\u6700\u5927\u7acb\u573a\u8010\u4e45'
 return prefab
