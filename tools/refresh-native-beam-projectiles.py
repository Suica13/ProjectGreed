"""Refresh only native beam presentation and misread damage-carrier speed."""
import json
from mod_source import ASSETS
from weapon_store import loads, dumps
from native_beam_projectiles import apply


def refresh(write=False):
    report = []
    for path in (ASSETS / 'units').glob('*/unit.json'):
        prefab = loads(path.read_text(encoding='utf-8'))
        changed = False
        for key, weapon in prefab['weapons'].items():
            updated = apply(prefab, weapon)
            changed |= updated
            sequence = weapon.get('projectile', {}).get('sequence')
            if sequence:
                report.append(dict(unit=prefab['id'], weapon=key, source=sequence['source'],
                    color=sequence['color'], segments=len(sequence['segments']),
                    frames=sequence['segments'][0]['frames'], speed=weapon['projectile']['speed']))
        if write and changed:
            path.write_text(dumps(prefab, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    if write:
        destination = ASSETS.parent / 'docs/imports/beam-projectiles.json'
        destination.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(dict(units=len(set(r['unit'] for r in report)), weapons=len(report), report=report)))


if __name__ == '__main__':
    import sys
    refresh('--write' in sys.argv)
