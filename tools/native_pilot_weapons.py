"""Translate numeric native pilot gates; never execute MOD expressions at runtime."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
from pathlib import Path
import json
import re
from mod_source import ASSETS, MOD, load, section
from native_weapon_layout import conditions

STATS = dict(zip(('Shoot', 'Cqb', 'Def', 'Speed', 'Accuracy', 'Reaction', 'Leadership', 'Awakening'),
                 ('shooting', 'melee', 'defense', 'speed', 'accuracy', 'reaction', 'leadership', 'awakening')))
COMPARISON = re.compile(r'readUnitMemory\("pilot(\w+)SkillFinal"[^)]*\)\s*(>=|<=|==|!=|>|<)\s*(\d+(?:\.\d+)?)')

def apply(prefab, native):
    enabled = set()
    for key, weapon in prefab['weapons'].items():
        availability = weapon.get('availability', {})
        if 'pilot_skill' not in availability.get('reasons', []) and not weapon.get('pilotRequirements'):
            continue
        source = conditions(native, weapon)
        if len(source) != 1 or re.search(r'\bor\b', source[0], re.I):
            continue
        matches = list(COMPARISON.finditer(source[0]))
        if not matches or any(m[1] not in STATS for m in matches):
            continue
        remainder = COMPARISON.sub('', source[0])
        if re.search(r'pilot\w*(?:Skill|Level)|pilot\w*Final', remainder, re.I):
            continue
        weapon['pilotRequirements'] = [dict(stat=STATS[m[1]], operator=m[2], value=float(m[3])) for m in matches]
        weapon['pilotRequirementSource'] = {'unit': prefab['source'], 'stats': ['pilot' + m[1] + 'SkillFinal' for m in matches]}
        if re.search(r'self\.shield\s*>\s*0', source[0]):
            weapon['requiresShield'] = True
        if re.search(r'not\s*\(\s*memory\.arm[RL]Breaked==true\s+and\s+memory\.arm[RL]Breaked==true\s*\)', source[0]):
            weapon['requiredParts'] = [part for part in weapon.get('requiredParts', []) if part not in ('leftArm', 'rightArm')]
            weapon['anyParts'] = ['leftArm', 'rightArm']
        reasons = [r for r in availability.get('reasons', []) if r != 'pilot_skill']
        availability.update(hidden=bool(reasons), reasons=reasons)
        weapon['availability'] = availability
        if reasons:
            continue
        enabled.add(key)
        for kit in prefab['weaponKits']:
            if key not in kit['weapons']:
                kit['weapons'].append(key)
        stem = Path(weapon['source']['file']).stem
        for layer in prefab['layers']:
            if layer['name'] == key or layer['name'] == stem or layer['name'].startswith(stem + '_'):
                condition = section(native, 'decal_' + layer['name']).get('isVisible', '').strip().lower()
                if condition not in ('false', 'if false'):
                    layer.pop('hidden', None)
    deferred = []
    for entry in prefab.get('deferredWeapons', []):
        if entry['id'] in enabled:
            continue
        if prefab['id'] == 'RX_81AS' and entry['id'] == 'Common_Cqb_B_L':
            entry['reasons'] = ['source_missing']
        deferred.append(entry)
    prefab['deferredWeapons'] = deferred
    return prefab

if __name__ == '__main__':
    count = 0
    for ref in load_source_json((ASSETS / 'unit-catalog.json').read_text(encoding='utf-8'))['units']:
        path = ASSETS / ref
        prefab = load_source_json(path.read_text(encoding='utf-8'))
        if not any('pilot_skill' in w.get('availability', {}).get('reasons', []) or w.get('pilotRequirements') for w in prefab['weapons'].values()):
            continue
        apply(prefab, load(MOD / prefab['source']))
        path.write_text(dump_source_json(prefab, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        count += sum(bool(w.get('pilotRequirements')) for w in prefab['weapons'].values())
    print('Pilot-gated weapons:', count)
