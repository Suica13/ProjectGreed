"""Read native refit definitions without executing MOD conditions."""
import functools, json, re
from pathlib import Path
from mod_source import ASSETS, MOD, ROOT, parse, resolve, section, number

@functools.lru_cache(None)
def definitions(file):
    own = parse(file)
    current = None
    for line in Path(file).read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            current = own[line[1:-1]]
        else:
            match = re.match(r"@define\s+(\w+)\s*=\s*(.*)", line)
            if match and current is not None:
                current["define." + match[1]] = match[2]
    result = {}
    for reference in own.get("core", {}).get("copyFrom", "").split(","):
        if reference.strip():
            for key, value in definitions(resolve(reference, Path(file).parent)).items():
                result.setdefault(key, {}).update(value)
    for key, value in own.items():
        result.setdefault(key, {}).update(value)
    return result

def apply(prefab, native=None):
    data = definitions(MOD / prefab['source'])
    options = []
    for key in data:
        if not key.startswith('action_CustomUnit'):
            continue
        action = section(data, key)
        if action.get('define.CustomRule', '').strip('() ').lower() == 'false':
            continue
        target = action.get('define.UnitID', '')
        if not re.fullmatch(r'\w+', target):
            raise ValueError('Unresolved refit target: ' + prefab['id'] + '/' + key)
        rule = action.get('define.CustomRule', '(true)')
        unlocks = re.findall(r"globalTeamTags\(includes=['\"]Unlock_(\w+)['\"]\)", rule)
        remainder = re.sub(r"self\.globalTeamTags\(includes=['\"]Unlock_\w+['\"]\)", 'true', rule)
        supported = bool(re.fullmatch(r'[()\s]*(?:true|false)[()\s]*', remainder))
        pilot = action.get('define.CustomRule_PilotCustomUnit') if 'PilotCustomUnit' in key else None
        options.append(dict(id=key, unitId=target,
            money=int(action['define.Money']), supplies=int(action['define.Resource']),
            **({"pilotId":re.search(r"includes=['\"](Pilot_\w+)['\"]",pilot)[1]} if pilot and re.search(r"includes=['\"](Pilot_\w+)['\"]",pilot) else {}),
            unlockUnits=unlocks, blocked=bool(pilot) or not supported or 'false' in remainder,
            source=dict(file=prefab['source'], action=key, seconds=number(action.get("buildSpeed", 0)))))
    prefab['refits'] = options
    for mechanic in prefab.get('mechanics', []):
        if mechanic.get('id') in ('CustomUnit', 'CustomUnit_NewUnit') and options:
            mechanic.update(status='adapted', name='特殊变换：配属对应ACE时自动转换为专用机，普通改装费用保留为许可报价来源')
    return prefab

if __name__ == '__main__':
    from mod_source import load
    total = 0
    report = ["# 原 MOD 改装来源档案", "", "以下仅为原MOD来源档案。当前不执行库存改装；普通改装限定单位直接购买许可，ACE专用机通过驾驶员配属自动转换。", "", "| 原机体 | 目标机体 | 资金 | 物资 | 条件 |", "| --- | --- | --- | --- | --- |"]
    for ref in json.loads((ASSETS / 'unit-catalog.json').read_text(encoding='utf-8'))['units']:
        path = ASSETS / ref
        p = json.loads(path.read_text(encoding='utf-8'))
        if not any(k.startswith('action_CustomUnit') for k in load(MOD / p['source'])):
            continue
        apply(p)
        path.write_text(json.dumps(p, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        total += len(p['refits'])
        for option in p['refits']:
            reason = '专属驾驶员／未支持原条件' if option['blocked'] else '目标未移植' if not (ASSETS / 'units' / option['unitId'] / 'unit.json').exists() else '、'.join(option['unlockUnits']) or '无额外开发条件'
            report.append(f"| {p['id']} | {option['unitId']} | {option['money']} | {option['supplies']} | {reason} |")
    Path('单位改装路线.md').write_text('\n'.join(report) + '\n', encoding='utf-8')
    print('Native refit routes:', total)
