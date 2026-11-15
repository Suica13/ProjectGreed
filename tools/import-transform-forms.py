"""Import missing native transform forms; preserve existing base units and source MOD."""
import copy, importlib.util, json, os, subprocess, sys
from pathlib import Path
PROJECT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(PROJECT/'tools'))
from mod_source import ASSETS, MOD, load, section
from weapon_store import dumps

def write(path,value):
 path.parent.mkdir(parents=True,exist_ok=True)
 path.write_text(dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def main():
 sys.stdout.reconfigure(encoding='utf-8')
 catalog=json.loads((ASSETS/'unit-catalog.json').read_text(encoding='utf-8'))
 package=sys.argv[2] if len(sys.argv)>2 and sys.argv[1]=='--package' else None
 if not package:
  packages=sorted({json.loads((ASSETS/ref).read_text(encoding='utf-8'))['source'].split('/')[0] for ref in catalog['units']})
  for name in packages:
   subprocess.run([sys.executable,__file__,'--package',name],check=True,cwd=PROJECT,env={**os.environ,'PROJECTGREED_MOD_DLC':name})
  return
 spec=importlib.util.spec_from_file_location('transform_importer',PROJECT/'tools/import-0079-page-one.py')
 bulk=importlib.util.module_from_spec(spec);spec.loader.exec_module(bulk)
 effects=bulk.read(ASSETS/'effects/effects.json');prefabs=[];report=[]
 for ref in list(catalog['units']):
  base=bulk.read(ASSETS/ref)
  if not base['source'].startswith(package+'/'):continue
  native=load(MOD/base['source'])
  targets=[(name,section(native,name)['convertTo']) for name in native if name.startswith('action_Transform_') and section(native,name).get('convertTo') and section(native,name)['convertTo']!=base['id']]
  if not targets:continue
  prefabs.append(base)
  for action,target in targets:
   path=ASSETS/f'units/{target}/unit.json'
   if path.exists():continue
   source=bulk.INDEX.get(target)
   if source is None:raise ValueError('Missing native transform source: '+target)
   data=load(source)
   row=dict(id=target,name=base['name']+' [MA]' if target.endswith('_MA') else base['name']+' [变形]',faction=base['faction'],tags=data['core'].get('tags',''),source=source.relative_to(MOD/package).as_posix())
   form=bulk.build(row,effects)
   form.update(formOnly=True,formOf=base.get('formOf',base['id']),tags=copy.deepcopy(base['tags']))
   form['stats']['cost']=base['stats']['cost']
   if 'availableFactions' in base:form['availableFactions']=copy.deepcopy(base['availableFactions'])
   for lang,label in [('zh','变形'),('en','Transformed'),('ja','変形')]:
    form.setdefault('localization',{}).setdefault(lang,{})['name']=base.get('localization',{}).get(lang,{}).get('name',base['name'])+' ['+label+']'
   write(path,form);prefabs.append(form);catalog['units'].append(f'units/{target}/unit.json')
   report.append(dict(unit=base['id'],form=target,nativeAction=action));print('Imported transform',target,flush=True)
 from native_conversions import attach
 for prefab in {p['id']:p for p in prefabs}.values():
  attach(prefab,load(MOD/prefab['source']));write(ASSETS/f"units/{prefab['id']}/unit.json",prefab)
 write(ASSETS/'effects/effects.json',{**bulk.read(ASSETS/'effects/effects.json'),**effects})
 write(ASSETS/'unit-catalog.json',catalog)
 # Inventory must recognize a transformed chassis without granting a permit or price.
 from default_equipment import collect
 production_path=PROJECT/'shared/production-catalog.json'
 production=json.loads(production_path.read_text(encoding='utf-8'))
 forms=[p for p in prefabs if p.get('formOnly') and p.get('formOf')]
 if forms:
  defaults=collect()
  for form in forms:
   ident=form['id'];kit=defaults[ident]
   production.setdefault('defaultKits',{}).setdefault(ident,kit)
   production.setdefault('baseModels',{}).setdefault(ident,ident+'__'+kit)
  write(production_path,production)
 report_path=PROJECT/f'tmp/verification/reports/transform-import-{package}.json'
 report_path.parent.mkdir(parents=True,exist_ok=True);report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
if __name__=='__main__':main()
