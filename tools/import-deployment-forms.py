"""Import only native deployment forms; preserve current base balance and hangar contracts."""
import importlib.util,json,copy
from pathlib import Path
from mod_source import ROOT,ASSETS,load
from native_conversions import DEPLOYMENTS,attach_deployment
spec=importlib.util.spec_from_file_location('bulk',Path(__file__).with_name('import-0079-page-one.py'))
bulk=importlib.util.module_from_spec(spec);spec.loader.exec_module(bulk)
def main():
 catalog=bulk.read(ASSETS/'unit-catalog.json');effects=bulk.read(ASSETS/'effects/effects.json')
 for ident,form in DEPLOYMENTS.items():
  base=bulk.read(ASSETS/f'units/{ident}/unit.json');source=bulk.INDEX[form];native=load(source)
  row=dict(id=form,name=base['name']+' [部署]',faction=base['faction'],tags=native['core'].get('tags',''),source=source.relative_to(ROOT).as_posix())
  unit=bulk.build(row,effects);unit.update(formOnly=True,formOf=ident)
  for key in ['hp','en','cost','footprint','ship','hangars','supplyAura','actionPoints']:
   if key in base['stats']:unit['stats'][key]=copy.deepcopy(base['stats'][key])
  unit['shield']=copy.deepcopy(base['shield']);unit['stats'].update(deployed=True,move=0)
  bulk.write(ASSETS/f'units/{form}/unit.json',unit)
  ref=f'units/{form}/unit.json'
  if ref not in catalog['units']:catalog['units'].append(ref)
  print('Imported deployment',form)
 for ident in list(DEPLOYMENTS)+list(DEPLOYMENTS.values()):
  path=ASSETS/f'units/{ident}/unit.json';unit=bulk.read(path)
  attach_deployment(unit,load(ROOT/unit['source'].split('/',1)[1]));bulk.write(path,unit)
 bulk.write(ASSETS/'effects/effects.json',{**bulk.read(ASSETS/'effects/effects.json'),**effects})
 bulk.write(ASSETS/'unit-catalog.json',catalog)
if __name__=='__main__':main()
