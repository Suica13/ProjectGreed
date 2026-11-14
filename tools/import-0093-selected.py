"""Import the selected 0093 roster; source MOD is read-only; research bindings are refreshed when connected."""
import os
os.environ['PROJECTGREED_MOD_DLC'] = 'GW_BattleUniverse_DLC_0093'
import importlib.util, json, subprocess, sys
from pathlib import Path
from mod_source import ROOT, ASSETS, load
from weapon_store import loads, dumps

ROSTER = [
    ('RGM_89', '杰刚', 'EFSF', 'Jegan', 'ジェガン'),
    ('AMS_119', '基拉德卡', 'NEO_ZEON', 'Geara Doga', 'ギラ・ドーガ'),
    ('RGZ_91', '灵格斯', 'EFSF', 'Re-GZ', 'リ・ガズィ'),
    ('RGZ_91B', '灵格斯特装型', 'EFSF', 'Re-GZ Custom', 'リ・ガズィ・カスタム'),
    ('MSN_03', '乍得多加', 'NEO_ZEON', 'Jagd Doga', 'ヤクト・ドーガ'),
    ('MSN_04', '沙扎比', 'NEO_ZEON', 'Sazabi', 'サザビー'),
    ('RX_93', '牛高达', 'EFSF', 'Nu Gundam', 'νガンダム'),
    ('RX_93_Test', '牛高达TEST型', 'EFSF', 'Nu Gundam [TEST]', 'νガンダム［TEST］'),
    ('RGZ_91_MA', '灵格斯［BWS］', 'EFSF', 'Re-GZ [BWS]', 'リ・ガズィ［BWS］'),
    ('RGZ_91B_MA', '灵格斯特装型［MA］', 'EFSF', 'Re-GZ Custom [MA]', 'リ・ガズィ・カスタム［MA］'),
]

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

def main():
    sys.stdout.reconfigure(encoding='utf-8')
    spec = importlib.util.spec_from_file_location('bulk0093', Path(__file__).with_name('import-0079-page-one.py'))
    bulk = importlib.util.module_from_spec(spec); spec.loader.exec_module(bulk)
    catalog = bulk.read(ASSETS/'unit-catalog.json')
    effects = bulk.read(ASSETS/'effects/effects.json')
    # The requested green Sazabi substitute also needs matching hit and bullet assets.
    from mod_source import MAIN
    from native_melee_effects import import_effect
    import_effect("Beam_Hit_2_Green", load(MAIN/"Resource/Image/Fx/Weapon/Beam/Common/Beam_Hit_2_Green.gw"), effects)
    bulk.asset(MAIN/"Resource/Image/Bullet/Beam/Beam_2_Green.png", ASSETS/"projectiles/Beam_2_Green.png")
    report = []
    prefabs = []
    for ident, zh, faction, en, ja in ROSTER:
        source = bulk.INDEX[ident]
        native = load(source)
        if native['core']['name'] != ident: raise ValueError('Native ID mismatch: '+ident)
        row = dict(id=ident, name=zh, faction=faction, tags=native['core']['tags'], source=source.relative_to(ROOT).as_posix())
        path = ASSETS/f'units/{ident}/unit.json'
        prefab = bulk.read(path) if path.exists() and '--refresh' not in sys.argv else bulk.build(row, effects)
        introductions = prefab.get('localization', {})
        prefab.update(name=zh, faction=faction, tags=[faction,'UC_0093_T1'], production=dict(enabled=False),
            localization={lang:dict(name=name) for lang,name in [('zh',zh),('en',en),('ja',ja)]})
        for language in ('zh','en','ja'):
            description = introductions.get(language, {}).get('description') or introductions.get('en', {}).get('description')
            if description: prefab['localization'][language]['description'] = description
        # Native text is kept by the introduction importer. Names use the requested roster labels.
        prefab['sourceStats']['technologyEra'] = 'UC_0093_T1'
        if ident.endswith('_MA'):
            prefab.update(formOnly=False, formOf=ident.removesuffix('_MA'))
        write(path,prefab)
        prefabs.append(prefab)
        ref=f'units/{ident}/unit.json'
        if ref not in catalog['units']: catalog['units'].append(ref)
        print('Imported',ident,len(prefab['weapons']),flush=True)
    # Targets must exist before the conversion configurations are attached.
    from native_conversions import attach
    from native_beam_projectiles import apply as apply_beam_projectile
    for prefab in prefabs:
        native=load(ROOT/prefab['source'].split('/',1)[1])
        attach(prefab,native)
        for weapon in prefab["weapons"].values(): apply_beam_projectile(prefab,weapon,native)
        write(ASSETS/f"units/{prefab['id']}/unit.json",prefab)
        report.append(dict(id=prefab['id'],source=prefab['source'],era='UC_0093_T1',faction=prefab['faction'],
            weapons=list(prefab['weapons']),mechanics=prefab.get('mechanics',[]),
            beams=[k for k,w in prefab['weapons'].items() if w.get('projectile',{}).get('sequence')],
            forms=[s['source']['unitId'] for s in prefab.get('skills',[]) if s.get('source',{}).get('mode')=='transform']))
    write(ASSETS/'effects/effects.json',effects)
    check=subprocess.run(['node','-e',"require('./tools/load-catalog.cjs').loadCatalog({catalogOverride:JSON.parse(require('fs').readFileSync(0,'utf8')),embedAssets:false})"],input=json.dumps(catalog),text=True,capture_output=True,cwd=ASSETS.parent)
    if check.returncode: raise RuntimeError(check.stderr)
    write(ASSETS/'unit-catalog.json',catalog)
    write(ASSETS.parent/'docs/imports/0093-selected.json',report)
    # No factory/permit offers: these units can only enter personal stock via grants.
    production=ASSETS.parent/'shared/production-catalog.json'
    data=json.loads(production.read_text(encoding='utf-8'))
    from default_equipment import collect
    defaults=collect()
    for prefab in prefabs:
        ident=prefab['id']; kit=defaults[ident]
        data['defaultKits'][ident]=kit
        data['baseModels'][ident]=ident+'__'+kit
        data.get('licenseOffers',{}).pop(ident,None)
    write(production,data)
    # Remove only generated unit-prefixed intermediates no prefab references anymore.
    animations=ASSETS/'animations'
    referenced={(p.parent/ref).resolve() for p in (ASSETS/'units').glob('*/unit.json') for ref in loads(p.read_text(encoding='utf-8'))['animations'].values()}
    for prefab in prefabs:
        for path in animations.glob(prefab['id']+'__*.json'):
            if path.resolve() not in referenced: path.unlink()
    # Once the native tree is connected, refresh its faction/production bindings.
    tree=json.loads((ASSETS.parent/'shared/development-tree.json').read_text(encoding='utf8'))
    if 'EFSF_0093' in tree:
        subprocess.run([sys.executable,str(Path(__file__).with_name('import-0093-tech.py')),'--skip-units'],check=True)
    print('Validated selected 0093 roster:',len(prefabs))

if __name__=='__main__': main()
