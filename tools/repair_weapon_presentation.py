"""Targeted, repeatable sniper and scatter-bazooka presentation refresh."""
import copy
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from weapon_store import loads, dumps
from weapon_policy import configure_sniper

ROOT = Path(__file__).resolve().parents[1]

def repair_scatter(prefab):
    for key, weapon in prefab['weapons'].items():
        if not re.search(r'(?:Bazooka\w*|(?:^|_)BZ)_(?:SG|ShotgunMode)(?:_|$)', weapon.get('sourceName', key), re.I):
            continue
        weapon['name'] = '火箭筒[霰弹]'
        weapon['localization'] = {
            'zh': {'name': '火箭筒[霰弹]'},
            'en': {'name': 'Bazooka [Scatter]'},
            'ja': {'name': 'バズーカ[散弾]'},
        }
        kits = [kit['id'] for kit in prefab['weaponKits'] if key in kit['weapons']]
        for kit in prefab['weaponKits']:
            if kit['id'] not in kits:
                continue
            kit['name'] = '火箭筒[霰弹]套件'
            kit['localization'] = {
                'zh': {'name': '火箭筒[霰弹]套件'},
                'en': {'name': 'Bazooka [Scatter] Kit'},
                'ja': {'name': 'バズーカ[散弾]装備'},
            }
        for layer in prefab['layers']:
            if layer['name'] == key or layer['name'].startswith(key + '_'):
                condition = layer.setdefault('visibleWhen', {})
                condition['kit'] = kits
                # SG is a fire mode of the same physical launcher, not a second
                # held weapon that can be hidden when an inherited alias is used.
                condition.pop('heldWeapon', None)
    return prefab

def main():
    catalog = json.loads((ROOT / 'assets/unit-catalog.json').read_text(encoding='utf-8'))
    changed = []
    for relative in catalog['units']:
        path = ROOT / 'assets' / relative
        original = path.read_text(encoding='utf-8')
        prefab = loads(original)
        before = copy.deepcopy(prefab)
        configure_sniper(prefab)
        repair_scatter(prefab)
        if prefab != before:
            path.write_text(dumps(prefab, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            changed.append(prefab['id'])
    print(json.dumps({'changed': changed}, ensure_ascii=False))

if __name__ == '__main__':
    main()
