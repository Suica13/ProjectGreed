"""Generate missing 5v5 regional maps; preserve authored maps and reference overrides."""
import argparse
import copy
import hashlib
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCENARIO_ID = 'earth_0079_mid'
DEST = ROOT / 'assets/maps/strategy' / SCENARIO_ID


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def make_layout(region, lookup, width, height):
    center_x, center_y = width // 2, height // 2
    nodes = [dict(id='base', kind='base', name='中心基地', x=center_x, y=center_y,
                  radius=1, deploymentRadius=10)]
    for index in range(6):
        angle = math.pi * (index / 3 - 0.5)
        nodes.append(dict(id='post_' + str(index + 1), kind='outpost', name='据点' + str(index + 1),
                          x=round(center_x + 23 * math.cos(angle)),
                          y=round(center_y + 29 * math.sin(angle)), radius=1, deploymentRadius=3))
    links = [dict(id='base_' + node['id'], a='base', b=node['id']) for node in nodes[1:]]
    gates = []
    sides = {side: [] for side in ['west', 'east', 'north', 'south']}
    for neighbor in region['links']:
        other = lookup[neighbor]
        dx = (other['center'][0] - region['center'][0] + 600) % 1200 - 600
        dy = other['center'][1] - region['center'][1]
        side = ('east' if dx >= 0 else 'west') if abs(dx) >= abs(dy) else ('south' if dy >= 0 else 'north')
        sides[side].append(neighbor)
    for side, neighbors in sides.items():
        for index, neighbor in enumerate(sorted(neighbors)):
            fraction = (index + 1) / (len(neighbors) + 1)
            x = 1 if side == 'west' else width - 2 if side == 'east' else round(5 + fraction * (width - 11))
            y = 1 if side == 'north' else height - 2 if side == 'south' else round(6 + fraction * (height - 13))
            gate = dict(id='gate_' + neighbor, region=neighbor, x=x, y=y,
                        radius=3, deploymentRadius=7, side=side)
            gates.append(gate)
            nearest = min(nodes[1:], key=lambda node: math.hypot(node['x'] - x, node['y'] - y))
            links.append(dict(id=gate['id'], a=nearest['id'], b=gate['id']))
    return dict(regionId=region['id'], nodes=nodes, gates=gates, links=links)


def resize_local_map(battle):
    """Reduce regional dimensions once; keep all terrain/objective coordinates in bounds."""
    if battle.get('regionalScale') == 0.75:
        return False
    old_width, old_height = battle['width'], battle['height']
    width, height = round(old_width * 0.75), round(old_height * 0.75)
    sx, sy = width / old_width, height / old_height
    battle['tiles'] = [[battle['tiles'][min(old_height-1, int(y / sy))][min(old_width-1, int(x / sx))]
                        for x in range(width)] for y in range(height)]
    for spawn in battle['spawns']:
        spawn.update(x=min(width-1, round(spawn['x'] * sx)), y=min(height-1, round(spawn['y'] * sy)))
    for area in battle.get('deploymentAreas', []):
        right = min(width, round((area['x'] + area['width']) * sx))
        bottom = min(height, round((area['y'] + area['height']) * sy))
        area.update(x=round(area['x'] * sx), y=round(area['y'] * sy))
        area.update(width=max(1, right-area['x']), height=max(1, bottom-area['y']))
    expansion = battle.get('deploymentExpansion')
    if expansion:
        left, right = max(1, round(expansion['addedLeft'] * sx)), max(1, round(expansion['addedRight'] * sx))
        top, bottom = round(expansion.get('addedTop', 0) * sy), round(expansion.get('addedBottom', 0) * sy)
        expansion.update(baseWidth=width-left-right, addedLeft=left, addedRight=right,
                         baseHeight=height-top-bottom, addedTop=top, addedBottom=bottom)
    layout = battle['strategic']
    for node in layout['nodes'] + layout['gates']:
        node.update(x=min(width-2, max(1, round(node['x'] * sx))),
                    y=min(height-2, max(1, round(node['y'] * sy))))
        if node.get('side') == 'west': node['x'] = 1
        if node.get('side') == 'east': node['x'] = width-2
        if node.get('side') == 'north': node['y'] = 1
        if node.get('side') == 'south': node['y'] = height-2
    battle.update(width=width, height=height, regionalScale=0.75)
    return True


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--resize-existing', action='store_true', help='Apply the regional 75% dimensions once to existing local maps.')
    parser.add_argument('--rebuild-geography', action='store_true', help='Rebuild the regional terrain from world projection and physical geography.')
    parser.add_argument('--dependencies', help='Generation-only Shapely/numpy package directory.')
    args = parser.parse_args()
    if args.dependencies: sys.path.insert(0, args.dependencies)
    world = read(DEST / 'world.json')
    template = read(ROOT / 'assets/maps/encounter/military_base_5v5.json')
    info = DEST / 'scenario.json'
    scenario = read(info) if info.exists() else dict(id=SCENARIO_ID, name=world['name'],
                                                   playersPerTeam=5, world='world.json', regions={})
    if scenario['id'] != SCENARIO_ID:
        raise ValueError('Scenario ID must match its folder')
    lookup = {region['id']: region for region in world['regions']}
    geography = None
    if args.rebuild_geography:
        from regional_geography import RegionalGeography
        geography = RegionalGeography(world)
    for region in world['regions']:
        filename = 'local-battles/' + region['id'] + '_5v5.json'
        scenario['regions'].setdefault(region['id'], dict(map=filename))
        target = DEST / filename
        if target.exists():
            if args.resize_existing or args.rebuild_geography:
                battle = read(target)
                changed = resize_local_map(battle) if args.resize_existing else False
                if args.rebuild_geography:
                    # Start from the fixed objective template so rebuilding is idempotent.
                    battle['strategic'] = make_layout(region, lookup, template['width'], template['height'])
                    for point in battle['strategic']['nodes'] + battle['strategic']['gates']:
                        point['x'] = round(point['x'] * battle['width'] / template['width'])
                        point['y'] = round(point['y'] * battle['height'] / template['height'])
                        if point.get('side') == 'west': point['x'] = 1
                        if point.get('side') == 'east': point['x'] = battle['width']-2
                        if point.get('side') == 'north': point['y'] = 1
                        if point.get('side') == 'south': point['y'] = battle['height']-2
                    geography.generate(region, battle)
                    changed = True
                if changed: write(target, battle)
            continue
        battle = copy.deepcopy(template)
        battle.update(id=SCENARIO_ID + '_' + region['id'] + '_5v5', name=region['name'] + ' · 局地战5v5',
                      description='占领中心基地或消灭敌军。', scope='strategic')
        battle.pop('localization', None)
        width, height = battle['width'], battle['height']
        seed = int.from_bytes(hashlib.sha256(region['id'].encode()).digest()[:4], 'big')
        battle['tiles'] = [['forest' if (x * 73 + y * 47 + seed) % 19 == 0 else 'plain'
                            for x in range(width)] for y in range(height)]
        battle['strategic'] = make_layout(region, lookup, width, height)
        resize_local_map(battle)
        if geography is None:
            from regional_geography import RegionalGeography
            geography = RegionalGeography(world)
        geography.generate(region, battle)
        write(target, battle)
    write(info, scenario)
    index_file = DEST.parent / 'index.json'
    index = read(index_file) if index_file.exists() else dict(scenarios=[])
    reference = SCENARIO_ID + '/scenario.json'
    if reference not in index['scenarios']:
        index['scenarios'].append(reference)
    write(index_file, index)
    print('Generated/indexed', len(scenario['regions']), 'regional 5v5 maps')


if __name__ == '__main__':
    main()
