"""Import SEED combat roster and native technology. Original MOD stays read-only."""
import os
os.environ['PROJECTGREED_MOD_DLC']='GW_BattleUniverse_DLC_SEED'
import importlib.util,json,re,sys
from pathlib import Path
from mod_source import ROOT,ASSETS,load
from weapon_store import loads,dumps
PROJECT=ASSETS.parent

def module(name,file):
 spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file));m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def write(file,value):
 if file==ASSETS/'effects/effects.json' and file.exists():value={**loads(file.read_text(encoding='utf8')),**value}
 file.parent.mkdir(parents=True,exist_ok=True);file.write_text(dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')

def main():
 sys.stdout.reconfigure(encoding='utf8')
 if '--report' in sys.argv:
  catalog=json.loads((ASSETS/'unit-catalog.json').read_text(encoding='utf8'))
  prefabs=[loads((ASSETS/ref).read_text(encoding='utf8')) for ref in catalog['units']]
  prefabs=[p for p in prefabs if p['source'].startswith('GW_BattleUniverse_DLC_SEED/')]
  write(PROJECT/'docs/imports/seed-roster.json',[{'id':p['id'],'source':p['source'],'faction':p['faction'],'weapons':list(p['weapons']),'mechanics':p.get('mechanics',[])} for p in prefabs])
  print('Reported',len(prefabs),'SEED prefabs');return
 bulk=module('seed_bulk','import-0079-page-one.py')
 original_asset=bulk.asset
 def seed_asset(source,target):
  if source.parent.name in ('PS','NoPS'):
   target=target.with_name(source.parent.name+'__'+target.name)
   original_asset(source,target)
   return target.name
  return original_asset(source,target)
 bulk.asset=seed_asset;bulk.base.asset=seed_asset
 catalog=json.loads((ASSETS/'unit-catalog.json').read_text(encoding='utf8'))
 effects=loads((ASSETS/'effects/effects.json').read_text(encoding='utf8'))
 extras={'TFA_2_ModeB','GAT_01D_AS','GAT_01D1_AS','GAT_X105_A','GAT_X105_S','GAT_X105_L','GAT_X303_MA','TS_MA2_H','ZGMF_1017_D','ZGMF_1017_H','ConnectedArmoredVehicle_DeployState','LinearArtillery_DeployState','VTOLTransport_DeployState'}
 roster=[p for p in sorted((ROOT/'Units/BattleUnits').glob('*/*.ini')) if p.stem==p.parent.name or p.stem in extras]
 roster += [bulk.INDEX[ident] for ident in ['Army_Squad_OMNI_CE71_N_G_A','Army_Squad_ZAFT_CE71_N_G_A']]
 if '--unit' in sys.argv:roster=[p for p in roster if p.stem==sys.argv[sys.argv.index('--unit')+1]]
 prefabs=[]
 for path in roster:
  native=load(path);core=native['core'];ident=core['name'];faction=next(t for t in core['tags'].split(',') if t in ('OMNI','ZAFT'))
  target=ASSETS/f'units/{ident}/unit.json'
  row=dict(id=ident,name=core.get('displayText_zh',core.get('displayText',ident)),faction=faction,tags=core['tags'],source=path.relative_to(ROOT).as_posix())
  p=loads(target.read_text(encoding='utf8')) if target.exists() and '--refresh' not in sys.argv else bulk.build(row,effects)
  from native_hangars import correct as hangars
  hangars(p,native)
  from native_armor import apply as armor
  armor(p,native)
  from native_melee_effects import apply as melee_effects
  melee_effects(p,native,effects)
  if ident.endswith('_DeployState') or ident in ('GAT_X303_MA','TFA_2_ModeB'):p.update(formOnly=True,formOf=ident.removesuffix('_DeployState').removesuffix('_MA').removesuffix('_ModeB'))
  p['tags']=[faction,'CE_0071_T1'];p['sourceStats']['technologyEra']='CE_0071_T1'
  from native_seed_repairs import apply as seed_repairs,railgun
  seed_repairs(p,native,effects,bulk);railgun(p)
  write(target,p);prefabs.append(p)
  ref=f'units/{ident}/unit.json'
  if ref not in catalog['units']:catalog['units'].append(ref)
  print('Imported',ident,len(p['weapons']),flush=True)
 from native_conversions import attach
 for p in prefabs:
  attach(p,load(ROOT/p['source'].split('/',1)[1]));write(ASSETS/f"units/{p['id']}/unit.json",p)
 write(ASSETS/'effects/effects.json',effects);write(ASSETS/'unit-catalog.json',catalog)
 if '--unit' in sys.argv:return
 tech=module('seed_tech','import-0079-tech.py');tree=json.loads((PROJECT/'shared/development-tree.json').read_text(encoding='utf8'))
 for faction in ('OMNI','ZAFT'):
  nodes=tech.import_faction(ROOT,faction,0,'CE71')
  for node in nodes:node.update(era='CE_0071_T1',technologyWeight=1)
  tree[faction]=nodes
 write(PROJECT/'shared/development-tree.json',tree)
 for p in prefabs:
  available=[f for f in ('OMNI','ZAFT') if any(p['id'] in n['unlocks'] for n in tree[f])]
  available=list(dict.fromkeys([p['faction'],*available]))
  if len(available)>1:p['availableFactions']=available
  write(ASSETS/f"units/{p['id']}/unit.json",p)
 production=module('seed_factory','import-production.py');offers=production.factory_offers(ROOT)
 data=json.loads((PROJECT/'shared/production-catalog.json').read_text(encoding='utf8'))
 from native_weapon_layout import conditions
 for p in prefabs:
  native=load(ROOT/p['source'].split('/',1)[1]);indices={}
  for key,w in p['weapons'].items():
   found={int(m[1]) for c in conditions(native,w) for m in re.finditer(r'\bEquipmentIndex\s*==\s*(\d+)',c)}
   if len(found)==1:indices[key]=next(iter(found))
  for kit in p['weaponKits']:
   if 'nativeEquipmentIndex' in kit:
    for key in kit['weapons']:
     if p['weapons'][key]['type']!='melee':indices[key]=kit['nativeEquipmentIndex']
  default=next((k for k in p['weaponKits'] if {indices[w] for w in k['weapons'] if w in indices}=={0}),p['weaponKits'][0])
  data['defaultKits'][p['id']]=default['id'];data['baseModels'][p['id']]=p['id']+'__'+default['id']
  for kit in p['weaponKits']:
   slots={indices[w] for w in kit['weapons'] if w in indices};slot=next(iter(slots),0);rows=offers.get((p['id'],slot),[])
   if not rows and len(p['weaponKits'])==1:rows=[r for (unit,index),values in offers.items() if unit==p['id'] for r in values]
   if not rows:continue
   regular=[r for r in rows if 'Fast' not in r['source']['file'] and '_Fast' not in r['source']['action']];offer=max(regular or rows,key=lambda r:r['source']['buildSeconds'])
   data['offers'][p['id']+'__'+kit['id']]={**offer,'unitId':p['id'],'faction':p['faction'],**({'availableFactions':p['availableFactions']} if p.get('availableFactions') else {}),'output':{'unitId':p['id'],'kitId':kit['id'],'quantity':offer['quantity']},'sourceAlternatives':[]}
  offer=data['offers'].get(data['baseModels'][p['id']])
  if offer:
   price=lambda x:max(50,int(x/offer['quantity']/50+0.5)*50) if x else 0
   data.setdefault('licenseOffers',{})[p['id']]={'unitId':p['id'],'faction':p['faction'],**({'availableFactions':p['availableFactions']} if p.get('availableFactions') else {}),'money':price(offer['money']),'supplies':price(offer['supplies']),'sourceType':'factory','source':offer['source']}
 for p in prefabs:
  if not p.get('formOf'):continue
  parent=data['offers'].get(data['baseModels'].get(p['formOf']))
  if parent:
   p['sourceStats']['nativeProductionQuantity']=parent['quantity']
   p['sourceStats']['nativeProductionSource']=parent['source']
   write(ASSETS/f"units/{p['id']}/unit.json",p)
 write(PROJECT/'shared/production-catalog.json',data)
 write(PROJECT/'docs/imports/seed-roster.json',[{'id':p['id'],'source':p['source'],'faction':p['faction'],'weapons':list(p['weapons']),'mechanics':p.get('mechanics',[])} for p in prefabs])
 print('SEED roster:',len(prefabs),'units;',sum(len(tree[f]) for f in ('OMNI','ZAFT')),'tech nodes')
if __name__=='__main__':main()
