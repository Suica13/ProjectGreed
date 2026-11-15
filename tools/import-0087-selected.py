"""Import four requested 0087 additions without rebuilding the existing roster."""
import os
os.environ['PROJECTGREED_MOD_DLC']='GW_BattleUniverse_DLC_0087'
import importlib.util,json,re,shutil,subprocess,sys
from pathlib import Path
from mod_source import ROOT,ASSETS,load,parse,section
from weapon_store import loads,dumps
PROJECT=ASSETS.parent
ROSTER=[
 ('EndraClass','恩多拉级','NEO_ZEON','Endra Class','エンドラ級','Tech_NEO_ZEON_0087_T2_QubeleyDevelopmentPlan'),
 ('NahelArgamaClass','拟阿卡玛级','AEUG','Nahel Argama Class','ネェル・アーガマ級','Tech_AEUG_0087_T2_ZZGundamDevelopmentPlan'),
 ('ORX_012','高达Mk-IV','TITANS','Gundam Mk-IV','ガンダムMk-IV','Tech_TITANS_0087_T2_GundamMkIVVDevelopmentPlan'),
 ('ORX_013','高达Mk-V','TITANS','Gundam Mk-V','ガンダムMk-V','Tech_TITANS_0087_T2_GundamMkIVVDevelopmentPlan'),
]
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
 result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result
def write(file,value):
 file.parent.mkdir(parents=True,exist_ok=True)
 file.write_text(dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
def add_technology(tree):
 ident=ROSTER[2][-1]
 file=ROOT/f'Units/TechTree/Tech/Faction/TITANS_0087/Common/{ident}.ini'
 own=file.read_text(encoding='utf-8-sig')
 data=load(file)
 if not any(n['id']==ident for n in tree['TITANS']):
  listing=(ROOT/'Units/TechTree/Tech/Faction/TITANS_0087/TechList_TITANS_0087.ini').read_text(encoding='utf-8-sig')
  costs=re.search(r'\[hiddenAction_'+ident+r'_Awake\]([\s\S]*?)(?=\[hiddenAction_|\Z)',listing)[1]
  values={key:int(re.search('_'+key+r'=(\d+)',costs)[1]) for key in ('Money','Resource','TechPoint','Time')}
  ui=next((ROOT/'Units/TechTree').rglob('TechTree_UI_Page_TITANS_0087_01.ini')).read_text(encoding='utf-8-sig')
  slot=re.search(r'\[attachment_Tech_(Mid|Top|Bot|Main)_(\d+)\](?:(?!\[attachment_Tech_)[\s\S])*?onCreateSpawnUnitOf:'+ident+r'\*1',ui)
  if not slot:raise ValueError('No native technology slot: '+ident)
  icon=re.search(r'^@global IconImage=ROOT:([^\r\n]+)',own,re.M)[1]
  target=ASSETS/'tech-icons'/f'{ident}.png';target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/icon,target)
  requires=list(dict.fromkeys(re.findall(r'Tech_\w+',re.search(r'^@global Unlocked=([^\r\n]+)',own,re.M)[1])))
  tree['TITANS'].append(dict(id=ident,name=data['core']['displayText_zh'],description=data['core']['displayDescription_zh'],icon=f'assets/tech-icons/{ident}.png',row='mid' if slot[1]=='Main' else slot[1].lower(),column=int(slot[2])+(slot[1]=='Main'),money=values['Money']*2,supplies=values['Resource']*2,sourceCosts=dict(money=values['Money'],supplies=values['Resource'],points=values['TechPoint'],researchSeconds=values['Time']),points=values['TechPoint'],requires=requires,unlocks=[],page=1,era='UC_0087_T2',technologyWeight=4))
 for ident,zh,faction,en,ja,tech in ROSTER:
  node=next(n for n in tree[faction] if n['id']==tech)
  if ident not in node['unlocks']:node['unlocks'].append(ident)
def main():
 sys.stdout.reconfigure(encoding='utf-8')
 treefile=PROJECT/'shared/development-tree.json';tree=json.loads(treefile.read_text(encoding='utf-8'));add_technology(tree);write(treefile,tree)
 bulk=module('selected0087','import-0079-page-one.py')
 registry=bulk.read(ASSETS/'unit-catalog.json');effects=bulk.read(ASSETS/'effects/effects.json');prefabs=[]
 from native_conversions import attach
 for ident,zh,faction,en,ja,tech in ROSTER:
  source=ROOT/f'Units/BattleUnits/{ident}/{ident}.ini';native=load(source)
  row=dict(id=ident,name=zh,faction=faction,tags=native['core']['tags'],source=source.relative_to(ROOT).as_posix())
  file=ASSETS/f'units/{ident}/unit.json'
  p=bulk.read(file) if file.exists() and '--refresh' not in sys.argv else bulk.build(row,effects)
  p['name']=zh;p['faction']=faction
  p['tags']=[faction,'UC_0087_T2'];p['sourceStats'].update(technologyEra='UC_0087_T2',technologyWeight=4)
  for language,name in [('zh',zh),('en',en),('ja',ja)]:p.setdefault('localization',{}).setdefault(language,{})['name']=name
  attach(p,native);write(file,p);prefabs.append(p)
  ref=f'units/{ident}/unit.json'
  if ref not in registry['units']:registry['units'].append(ref)
  print('Imported',ident,'weapons',list(p['weapons']),'modules',len(p['stats'].get('modules',[])),flush=True)
 bulk.write(ASSETS/'effects/effects.json',effects)
 # Validate the candidate registry before exposing it to ordinary clients.
 check=subprocess.run(['node','-e',"require('./tools/load-catalog.cjs').loadCatalog({catalogOverride:JSON.parse(require('fs').readFileSync(0,'utf8')),embedAssets:false})"],input=json.dumps(registry),text=True,cwd=PROJECT,capture_output=True)
 if check.returncode:raise RuntimeError(check.stderr)
 write(ASSETS/'unit-catalog.json',registry)
 factory=module('factory0087','import-production.py');offers=factory.factory_offers(ROOT)
 prodfile=PROJECT/'shared/production-catalog.json';production=json.loads(prodfile.read_text(encoding='utf-8'))
 from native_weapon_layout import conditions
 report=[]
 native_production_file=PROJECT/'shared/native-production.json'
 native_production=json.loads(native_production_file.read_text(encoding='utf-8'))
 for p in prefabs:
  native=load(ROOT/p['source'].split('/',1)[1]);default=None
  for kit in p['weaponKits']:
   indices={int(m[1]) for key in kit['weapons'] for c in conditions(native,p['weapons'][key]) for m in re.finditer(r'\bEquipmentIndex\s*==\s*(\d+)',c)}
   index=next(iter(indices),0)
   if len(indices)>1:raise ValueError('Ambiguous equipment index '+p['id']+'/'+kit['id'])
   candidates=offers.get((p['id'],index),[])
   if not candidates:raise ValueError('Missing native factory offer '+p['id']+'/'+kit['id'])
   normal=[o for o in candidates if '_Fast' not in o['source']['action'] and 'Fast' not in Path(o['source']['file']).stem];candidates=normal or candidates
   offer=max(candidates,key=lambda x:x['source']['buildSeconds'])
   production['offers'][p['id']+'__'+kit['id']]={'output':dict(unitId=p['id'],kitId=kit['id'],quantity=offer['quantity']),'unitId':p['id'],'faction':p['faction'],**offer,'sourceAlternatives':[o['source'] for o in candidates if o!=offer]}
   if index==0 and default is None:default=kit['id']
  native_offer=production['offers'][p['id']+'__'+(default or p['weaponKits'][0]['id'])]
  native_production[p['id']]=dict(quantity=native_offer['quantity'],source=native_offer['source']['file'],action=native_offer['source']['action'])
  p['sourceStats']['nativeProductionQuantity']=native_offer['quantity'];write(ASSETS/f"units/{p['id']}/unit.json",p)
  default=default or p['weaponKits'][0]['id'];production['defaultKits'][p['id']]=default;production['baseModels'][p['id']]=p['id']+'__'+default
  production['unavailable']=[m for m in production.get('unavailable',[]) if not m.startswith(p['id']+'__')]
  report.append(dict(id=p['id'],source=p['source'],era='UC_0087_T2',faction=p['faction'],weapons=list(p['weapons']),hangars=p.get('hangars',[]),modules=len(p['stats'].get('modules',[])),defaultKit=default,remoteWeapons={key:dict(units=len(w['remote']['units']),projectiles=w['nativeTiming']['projectiles']) for key,w in p['weapons'].items() if w.get('remote')},sourceStats=p['sourceStats']))
 write(prodfile,production)
 write(native_production_file,native_production)
 subprocess.run(['node','-e',
  "const fs=require('fs'),L=require('./tools/license-catalog.cjs'),ids=JSON.parse(process.argv[1]),file='shared/production-catalog.json',p=JSON.parse(fs.readFileSync(file,'utf8')),units=ids.map(id=>JSON.parse(fs.readFileSync('assets/units/'+id+'/unit.json','utf8')));p.licenseOffers={...p.licenseOffers,...L.compile(p,units)};p.nativePricing={...p.nativePricing,...L.archive(p,units)};fs.writeFileSync(file,JSON.stringify(p,null,2)+String.fromCharCode(10));",
  json.dumps([row[0] for row in ROSTER])],cwd=PROJECT,check=True)
 # Remove only unreferenced intermediate clips generated for these four imports.
 referenced={(f.parent/ref).resolve() for f in (ASSETS/'units').glob('*/unit.json') for ref in loads(f.read_text(encoding='utf-8'))['animations'].values()}
 for p in prefabs:
  for f in (ASSETS/'animations').glob(p['id']+'__*.json'):
   if f.resolve() not in referenced:f.unlink()
 write(PROJECT/'docs/imports/0087-selected.json',report)
 print('Registered four selected 0087 additions')
if __name__=='__main__':main()
