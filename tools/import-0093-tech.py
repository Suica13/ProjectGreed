"""Import native 0093 research and its dependent units; MOD is read-only.
Existing imported weapons are retained. Only absent native research dependencies
are constructed; factory offers and prerequisite/icon provenance stay auditable.
"""
import os
os.environ['PROJECTGREED_MOD_DLC'] = 'GW_BattleUniverse_DLC_0093'
import importlib.util
import json
import re
import sys
from pathlib import Path
from mod_source import ROOT, ASSETS, load
from weapon_store import loads, dumps

PROJECT = ASSETS.parent
FACTIONS = {'EFSF_0093': '0093_EFSF', 'NEO_ZEON_0093': '0093_NZN'}

def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf8')

def main():
    sys.stdout.reconfigure(encoding='utf8')
    tech = module('research0093', 'import-0079-tech.py')
    factory = module('factory0093', 'import-production.py')
    bulk = module('bulk0093tech', 'import-0079-page-one.py')
    tree = json.loads((PROJECT/'shared/development-tree.json').read_text(encoding='utf8'))
    catalog = json.loads((ASSETS/'unit-catalog.json').read_text(encoding='utf8'))
    effects = loads((ASSETS/'effects/effects.json').read_text(encoding='utf8'))
    report = {'factions': {}, 'addedUnits': [], 'missingUnits': [], 'factoryMissing': []}
    prefabs = {}
    for faction, directory in FACTIONS.items():
        nodes = tech.import_faction(ROOT, faction, 0, '0093', directory)
        nodes = [node for node in nodes if not (node['unlocks'] and all(u.startswith('TechUnit_') for u in node['unlocks']))]
        for node in nodes:
            node['points'] *= 2
            node['pointsMultiplier'] = 2
            node.update(technologyWeight=5, sourceUnlocks=list(node['unlocks']), source={
                'root': ROOT.name,
                'file': f'Units/TechTree/Tech/Faction/{directory}/Common/{node["id"]}.ini'})
            playable = []
            for ident in node['sourceUnlocks']:
                native_path = bulk.INDEX.get(ident)
                target = ASSETS/f'units/{ident}/unit.json'
                if native_path is None:
                    if not ident.startswith(('Factory_', 'Refinery_', 'Institute_', 'SupplyDepot_', 'Academy_', 'Turret_', 'Wall_', 'HLV_', 'TechUnit_')):
                        report['missingUnits'].append(ident)
                    continue
                native = load(native_path)
                if not target.exists():
                    if '--skip-units' in sys.argv:
                        raise ValueError('Missing required unit: ' + ident)
                    row = dict(id=ident, name=native['core'].get('displayText_zh', ident), faction=faction,
                        tags=native['core']['tags'], source=native_path.relative_to(ROOT).as_posix())
                    prefab = bulk.build(row, effects)
                    write(target, prefab)
                    report['addedUnits'].append(ident)
                prefab = loads(target.read_text(encoding='utf8'))
                prefab['faction'] = faction
                prefab['tags'] = [faction, 'UC_0093_T1']
                prefab['sourceStats']['technologyEra'] = 'UC_0093_T1'
                prefab.pop('availableFactions', None)
                prefabs[ident] = prefab
                ref = f'units/{ident}/unit.json'
                if ref not in catalog['units']: catalog['units'].append(ref)
                playable.append(ident)
            node['unlocks'] = playable
            node['placeholder'] = bool(node['sourceUnlocks']) and all(u.startswith('TechUnit_') for u in node['sourceUnlocks'])
        tree[faction] = nodes
        report['factions'][faction] = nodes
    # Include previously imported native alternate forms and grant-only units.
    for ref in catalog['units']:
        prefab = loads((ASSETS/ref).read_text(encoding='utf8'))
        if not prefab['source'].startswith(ROOT.name + '/') or prefab['id'] in prefabs: continue
        faction = 'EFSF_0093' if prefab['faction'] in ('EFSF', 'EFSF_0093') else 'NEO_ZEON_0093'
        prefab.update(faction=faction, tags=[faction, 'UC_0093_T1'])
        prefab.pop('availableFactions', None)
        prefabs[prefab['id']] = prefab
        parent = prefab.get('formOf')
        for node in tree[faction]:
            if parent and parent in node['unlocks']:
                node['unlocks'].append(prefab['id'])
    from native_conversions import attach
    for prefab in prefabs.values():
        attach(prefab, load(ROOT/prefab['source'].split('/', 1)[1]))
    data = json.loads((PROJECT/'shared/production-catalog.json').read_text(encoding='utf8'))
    offers = factory.factory_offers(ROOT)
    from native_weapon_layout import conditions
    for ident, prefab in prefabs.items():
        native = load(ROOT/prefab['source'].split('/',1)[1])
        indices = {}
        for key, weapon in prefab['weapons'].items():
            found = {int(m[1]) for c in conditions(native, weapon) for m in re.finditer(r'\bEquipmentIndex\s*==\s*(\d+)', c)}
            if len(found) == 1: indices[key] = next(iter(found))
        default = next((k for k in prefab['weaponKits'] if {indices[w] for w in k['weapons'] if w in indices} == {0}), prefab['weaponKits'][0])
        kit_ids = {k['id'] for k in prefab['weaponKits']}
        if data['defaultKits'].get(ident) not in kit_ids: data['defaultKits'][ident] = default['id']
        data['baseModels'][ident] = ident + '__' + data['defaultKits'][ident]
        researched = any(ident in n['unlocks'] for n in tree[prefab['faction']])
        for kit in prefab['weaponKits']:
            slots = {indices[w] for w in kit['weapons'] if w in indices}
            slot = next(iter(slots), 0)
            rows = offers.get((ident, slot), [])
            if not rows and len(prefab['weaponKits']) == 1:
                rows = [r for (u, i), values in offers.items() if u == ident for r in values]
            if not rows:
                # Native factories can produce the equipped BWS rather than the bare MS.
                forms = [p['id'] for p in prefabs.values() if p.get('formOf') == ident]
                rows = [r for (u, i), values in offers.items() if u in forms and i == slot for r in values]
            if not rows: continue
            regular = [r for r in rows if 'Fast' not in r['source']['file'] and '_Fast' not in r['source']['action']]
            offer = max(regular or rows, key=lambda r: r['source']['buildSeconds'])
            data['offers'][ident+'__'+kit['id']] = {**offer, 'unitId':ident, 'faction':prefab['faction'],
                'output': {'unitId':ident, 'kitId':kit['id'], 'quantity':offer['quantity']}, 'sourceAlternatives':[]}
        offer = data['offers'].get(data['baseModels'][ident])
        if researched and offer:
            price = lambda x: max(50, int(x/offer['quantity']/50+.5)*50) if x else 0
            data.setdefault('licenseOffers', {})[ident] = {'unitId':ident, 'faction':prefab['faction'],
                'money':price(offer['money']), 'supplies':price(offer['supplies']), 'sourceType':'factory', 'source':offer['source']}
            prefab['production'] = {'enabled': True}
        else:
            data.get('licenseOffers', {}).pop(ident, None)
            prefab['production'] = {'enabled': False}
            if researched: report['factoryMissing'].append(ident)
        write(ASSETS/f'units/{ident}/unit.json', prefab)
    # Refresh form inheritance now that their parent production data is known.
    for prefab in prefabs.values():
        parent = data['offers'].get(data['baseModels'].get(prefab.get('formOf')))
        offer = data['offers'].get(data['baseModels'][prefab['id']]) or parent
        if offer:
            prefab['sourceStats']['nativeProductionQuantity'] = offer['quantity']
            prefab['sourceStats']['nativeProductionSource'] = offer['source']
            write(ASSETS/f'units/{prefab["id"]}/unit.json', prefab)
    write(ASSETS/'effects/effects.json', {**loads((ASSETS/'effects/effects.json').read_text(encoding='utf8')), **effects})
    write(ASSETS/'unit-catalog.json', catalog)
    write(PROJECT/'shared/development-tree.json', tree)
    write(PROJECT/'shared/production-catalog.json', data)
    write(PROJECT/'docs/imports/0093-technology.json', report)
    print('0093 research:', {f:len(tree[f]) for f in FACTIONS}, '; dependent units:', report['addedUnits'])
    print('Missing native dependencies:', report['missingUnits'], '; no native factory:', report['factoryMissing'])

if __name__ == '__main__': main()
