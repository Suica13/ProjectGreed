"""Complete native 0079 roster, retaining state-only helpers outside the build list."""
import importlib.util, json, re, sys, subprocess, shutil
from pathlib import Path
from mod_source import ROOT, MOD, ASSETS, load, parse
from native_refits import definitions

def write(path,value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')

def main():
    sys.stdout.reconfigure(encoding='utf8')
    spec=importlib.util.spec_from_file_location('extra_bulk',Path(__file__).with_name('import-0079-page-one.py'))
    bulk=importlib.util.module_from_spec(spec);spec.loader.exec_module(bulk)
    catalog=json.loads((ASSETS/'unit-catalog.json').read_text(encoding='utf8'))
    effects=json.loads((ASSETS/'effects/effects.json').read_text(encoding='utf8'))
    existing={json.loads((ASSETS/p).read_text(encoding='utf8'))['id'] for p in catalog['units']}
    rows=[]
    for f in sorted((ROOT/'Units/BattleUnits').rglob('*.ini')):
        if any(x in f.parts for x in ['Weapon','Pilot']):continue
        own=parse(f).get('core',{});ident=own.get('name')
        if not ident or ident in existing:continue
        # Helpers render turrets, doors, out-of-bounds flights and deployed states.
        if any(x in ident for x in ['_CloseState','_OverLine','_DeployState','_StyleB','_EXAM']):continue
        try:data=load(f)
        except FileNotFoundError:continue
        tags=data['core'].get('tags','').split(',')
        if not {'0079','Unit'} <= set(tags) or ident not in tags or not {'EFSF','ZEON'} & set(tags):continue
        refs=own.get('copyFrom','')
        rows.append(dict(id=ident,name=data['core'].get('displayText_zh',data['core'].get('displayText',ident)),faction=next(t for t in tags if t in ['EFSF','ZEON']),source=f.relative_to(ROOT).as_posix(),tags=','.join(tags),nativeSkills=re.findall(r'(Template/Unit/Skill/[^,\s]+)',refs)))
    for row in rows:
        native=load(ROOT/row['source'])
        if not native['core'].get('displayDescription') and not native['core'].get('displayDescription_zh'):
            native['core']['displayDescription_zh']=row['name']
            native['core']['displayDescription']=native['core'].get('displayText',row['id'])
        p=bulk.build(row,effects)
        if row['id'].endswith('_BPart'):p['formOnly']=True
        write(ASSETS/f"units/{p['id']}/unit.json",p)
        catalog['units'].append(f"units/{p['id']}/unit.json")
        print('Imported',p['id'],flush=True)
    write(ASSETS/'effects/effects.json',effects)
    from special_systems import refresh_systems
    catalog=refresh_systems(catalog,{r['id'] for r in rows},publish=False)
    from weapon_policy import configure
    from unit_eras import apply as apply_era
    # Refresh native rules only on newly imported hulls and their generated forms.
    new_ids={r['id'] for r in rows}
    for ref in catalog['units']:
        path=ASSETS/ref;p=json.loads(path.read_text(encoding='utf8'))
        if p['id'] in new_ids or p.get('formOf') in new_ids:
            configure(p,load(MOD/p['source']));apply_era(p);write(path,p)
    manifest=Path(__file__).with_name('0079-extras-manifest.json')
    previous=json.loads(manifest.read_text(encoding='utf8')) if manifest.exists() else []
    combined={r['id']:r for r in previous+rows}
    write(manifest,list(combined.values()))
    subprocess.run([shutil.which('node'),'-e',"require('./tools/load-catalog.cjs').loadCatalog({catalogOverride:JSON.parse(require('fs').readFileSync(0,'utf8'))})"],input=json.dumps(catalog),text=True,check=True,cwd=ASSETS.parent)
    write(ASSETS/'unit-catalog.json',catalog)
    print('Completed',len(rows),'extra hulls')
if __name__=='__main__':main()
