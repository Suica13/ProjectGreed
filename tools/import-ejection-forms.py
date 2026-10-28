"""Import only missing native single-unit ejection forms and attach their skills."""
import importlib.util,json,re,sys
from pathlib import Path
from mod_source import ASSETS,MOD,ROOT,load,section
from native_conversions import attach

def main():
    spec=importlib.util.spec_from_file_location('ejection_importer',Path(__file__).with_name('import-0079-page-one.py'))
    importer=importlib.util.module_from_spec(spec);spec.loader.exec_module(importer)
    catalog=importer.read(ASSETS/'unit-catalog.json');effects=importer.read(ASSETS/'effects/effects.json')
    sources=[]
    for ref in list(catalog['units']):
        prefab=importer.read(ASSETS/ref);native=load(MOD/prefab['source'])
        if 'action_ExitUnit' not in native or native.get('hiddenAction_ExitUnit_Step2',{}).get('deleteSelf')!='true':continue
        spawn=re.fullmatch(r'(\w+)\*1(?:\(.*\))?',section(native,'action_ExitUnit').get('spawnUnits',''))
        if not spawn:continue
        target=spawn[1];file=ASSETS/f'units/{target}/unit.json'
        if not file.exists():
            source=importer.INDEX.get(target)
            if not source:raise ValueError('Missing native ejection source: '+target)
            core=load(source)['core']
            row=dict(id=target,faction=prefab['faction'],name=core.get('displayText_zh',target),
                     source=source.relative_to(ROOT).as_posix(),tags=core.get('tags',''))
            result=importer.build(row,effects);result['formOnly']=True
            importer.write(file,result)
            catalog['units'].append(f'units/{target}/unit.json')
            print('Imported ejection form',target)
        sources.append((ref,prefab,native))
    importer.write(ASSETS/'effects/effects.json',effects)
    importer.write(ASSETS/'unit-catalog.json',catalog)
    for ref,prefab,native in sources:
        if any(s.get('type') in ('escape','armor_purge') for s in prefab.get('skills',[])):continue
        attach(prefab,native);importer.write(ASSETS/ref,prefab)

if __name__=='__main__':main()
