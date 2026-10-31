"""One-time, read-only MOD importer. Runtime only uses assets/ JSON and PNG files."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json, re, shutil
from normalize_rgm79 import normalize
from import_mod_effects import import_effects
from pathlib import Path

ROOT = Path(r'E:\RustedWarfare_Reunion\mods\units\GW_BattleUniverse_DLC_0079')
DEST = Path(__file__).resolve().parents[1] / 'assets'

def parse(file):
    sections, current = {}, None
    lines = iter(file.read_text(encoding='utf-8-sig').splitlines())
    for line in lines:
        line = line.strip()
        if line.startswith('[') and line.endswith(']'):
            current = sections.setdefault(line[1:-1], {})
        elif current is not None and ':' in line and not line.startswith('#'):
            key, value = line.split(':', 1)
            if value.strip() == '"""':
                parts = []
                for part in lines:
                    if part.strip() == '"""': break
                    parts.append(part.strip())
                value = ' '.join(parts)
            current[key.strip()] = value.strip()
    return sections

def resolve(name, base):
    name = name.replace('\\', '/').strip()
    return ROOT / name[5:].lstrip('/') if name.startswith('ROOT:') else base / name

def load(file, stack=()):
    if file in stack: raise ValueError('cyclic copyFrom')
    own = parse(file)
    result = {}
    for name in own.get('core', {}).get('copyFrom', '').split(','):
        if name.strip():
            for key, value in load(resolve(name, file.parent), (*stack, file)).items():
                result.setdefault(key, {}).update(value)
    for key, value in own.items(): result.setdefault(key, {}).update(value)
    return result

data = load(ROOT / 'Units/BattleUnits/RGM_79/RGM_79.ini')
def section(name, stack=()):
    if name in stack: raise ValueError('cyclic section')
    value = data[name].copy()
    parent = value.pop('@copyFromSection', None)
    if parent: value = {**section(parent, (*stack, name)), **value}
    return value

def write(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dump_source_json(obj, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')

textures = {}
def texture(source):
    file = resolve(source, ROOT)
    if not file.is_file(): raise ValueError(str(file))
    name = file.name
    target = DEST / 'units/RGM_79/textures' / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(file, target)
    textures[name] = 'textures/' + name
    return name

bones, layers, animations = {}, [], {}
for name in data:
    value = section(name)
    if re.match(r'^(arm|leg)_\d+$', name):
        bones[name.replace('_', '')] = {k:v for k,v in value.items() if k in ('x','y','endDirOffset','drawDirOffset')}
    elif name.startswith('decal_') and value.get('image') and value.get('basePositionFromLegEnd'):
        if value.get('onlyOnNonPreview') == 'true' or any(w in name for w in ('Boost','Stun','LowHp','Eye')): continue
        if not value['image'].startswith('ROOT:'): continue
        layer = {k:v for k,v in value.items() if k in ('order','isVisible','basePositionFromLegEnd','imageScale','imageScaleX','imageScaleY','xOffsetRelative','yOffsetRelative','xOffsetAbsolute','yOffsetAbsolute','hOffset','pivotOffset','dirOffset','frame','frame_width','frame_height','total_frames','alpha')}
        layer.update(name=name[6:], texture=texture(value['image']))
        layers.append(layer)
    elif name.startswith('animation_'):
        curves, scale = {}, float(value.get('KeyframeTimeScale', 1))
        for key, point in value.items():
            match = re.fullmatch(r'(arm\d+|leg\d+)_([\d.]+)s', key)
            if not match: continue
            for field, number in re.findall(r'(\w+)\s*:\s*(-?[\d.]+)', point):
                curves.setdefault(match[1], {}).setdefault(field, []).append([float(match[2])*scale,float(number)])
        if curves:
            for fields in curves.values():
                for points in fields.values(): points.sort()
            clip = name[10:]
            animations[clip] = '../../animations/' + clip + '.json'
            write(DEST / 'animations' / (clip+'.json'), dict(duration=max(p[-1][0] for f in curves.values() for p in f.values()),curves=curves))

layers.sort(key=lambda d:float(d.get('order',0)))
icon = texture(data['graphics']['icon_build'])
prefab = dict(schemaVersion=1,id='RGM_79',name='吉姆',code='RGM-79',source='GW_BattleUniverse_DLC_0079/Units/BattleUnits/RGM_79/RGM_79.ini',
    stats=dict(hp=21000,en=100,move=5,armor=1,cost=300),
    materials=dict(icon=icon,textures=textures),skeleton=bones,layers=layers,animations=animations,
    presentation=dict(shield=True,mapScale=1,battleScale=1,idle='Common_Idle',move='OnMovingWalk',stagger='Common_Stagger'),
    weapons={
        'bsg':dict(name='光束喷枪',type='beam',min=2,max=5,damage=5000,hit=85,en=12,clip='Common_Shoot_A2',hold=0),
        'mg':dict(name='90mm机枪',type='shell',min=2,max=5,damage=3400,hit=92,ammo=12,clip='Common_Shoot_A',hold=0),
        'bz':dict(name='火箭筒',type='shell',min=3,max=6,damage=5800,hit=80,ammo=6,clip='Common_Shoot_A',hold=0),
        'bs':dict(name='光束军刀',type='melee',min=1,max=1,damage=4800,hit=96,en=8,clip='Common_Melee_A',hold=1),
        'vulcan':dict(name='火神炮',type='shell',min=1,max=2,damage=1400,hit=98,ammo=20,clip='Common_Shoot_A',hold=2)},
    secondaryWeapons=['bs','vulcan'],weaponKits=[dict(id='beam_spray',name='光束喷枪套件',primary='bsg',equipmentIndex=0,cost=100),dict(id='machine_gun',name='机枪套件',primary='mg',equipmentIndex=1,cost=0),dict(id='bazooka',name='火箭筒套件',primary='bz',equipmentIndex=2,cost=75)])
# A missing imported attack clip is an error rather than a silent frozen pose.
for w in prefab['weapons'].values():
    if w['clip'] not in animations:
        raise ValueError('Missing animation: ' + w['clip'])
import_effects(ROOT, DEST, parse)
write(DEST / 'units/RGM_79/unit.json', normalize(prefab, ROOT, DEST, parse))
write(DEST / 'unit-catalog.json',dict(schemaVersion=1,units=['units/RGM_79/unit.json'],effects='effects/effects.json',presentation='presentation.json',formation=dict(maxUnits=6,maxCost=2400),deployment=dict(radius=2,spawns=[dict(x=1,y=4),dict(x=10,y=4)])))
print('Imported',len(textures),'textures,',len(layers),'layers,',len(animations),'animations')
