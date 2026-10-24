"""Import the three GM variants. Only this offline tool reads RW configuration syntax.

Run: python tools/import-units.py. Edit the resulting ordinary JSON for game balance.
"""
import copy
import json
import re
import runpy
import shutil
import struct
from unit_movement import configure_movement
from unit_introductions import apply_introduction
from pathlib import Path

legacy = runpy.run_path(str(Path(__file__).with_name('import-rgm79.py')))
ROOT, DEST = legacy['ROOT'], legacy['DEST']
parse, load, write = legacy['parse'], legacy['load'], legacy['write']
MAIN = ROOT.parent / 'GW_BattleUniverse_Main'


def copy_asset(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)


def source_path(reference, root=ROOT):
    return root / reference.replace('\\', '/').removeprefix('ROOT:').lstrip('/')


def inherited(data, name):
    value = data[name].copy()
    parent = value.pop('@copyFromSection', None)
    return {**inherited(data, parent), **value} if parent else value


def import_visuals(unit_id):
    data = load(ROOT / f'Units/BattleUnits/{unit_id}/{unit_id}.ini')
    textures, bones, layers, animations = {}, {}, [], {}

    def texture(reference):
        source = source_path(reference)
        copy_asset(source, DEST / f'units/{unit_id}/textures' / source.name)
        textures[source.name] = 'textures/' + source.name
        return source.name

    numeric = dict(imageScale='scale', imageScaleX='scaleX', imageScaleY='scaleY',
                   dirOffset='rotation', pivotOffset='pivot', hOffset='height',
                   total_frames='frames', frame_width='frameWidth', frame_height='frameHeight',
                   frame='frame', alpha='alpha')
    for name in data:
        value = inherited(data, name)
        if re.fullmatch(r'(arm|leg)_\d+', name):
            bones[name.replace('_', '')] = {k: float(v) for k, v in value.items()
                                           if k in ('x', 'y', 'endDirOffset', 'drawDirOffset')}
        elif name.startswith('decal_') and value.get('image', '').startswith('ROOT:') and value.get('basePositionFromLegEnd'):
            if value.get('onlyOnNonPreview') == 'true' or any(s in name for s in ('Boost', 'Stun', 'LowHp', 'Eye')):
                continue
            layer = dict(name=name[6:], texture=texture(value['image']),
                         bone=value['basePositionFromLegEnd'], order=float(value.get('order', 0)),
                         offset=dict(x=float(value.get('xOffsetRelative', 0)), y=float(value.get('yOffsetRelative', 0))))
            for key, target in numeric.items():
                if key in value:
                    layer[target] = float(value[key])
            if layer['name'] == 'Shield':
                layer['visibleWhen'] = dict(shieldVisible=True)
            elif layer['name'] in ('Head', 'Head_Close'):
                layer['visibleWhen'] = dict(visorClosed=layer['name'].endswith('_Close'))
            layers.append(layer)
        elif name.startswith('animation_'):
            curves, scale = {}, float(value.get('KeyframeTimeScale', 1))
            for key, point in value.items():
                match = re.fullmatch(r'(arm\d+|leg\d+)_([\d.]+)s', key)
                if not match:
                    continue
                for field, number in re.findall(r'(\w+)\s*:\s*(-?[\d.]+)', point):
                    curves.setdefault(match[1], {}).setdefault(field, []).append([float(match[2])*scale, float(number)])
            if curves:
                for fields in curves.values():
                    for points in fields.values():
                        points.sort()
                clip = name[10:]
                animations[clip] = '../../animations/' + clip + '.json'
                write(DEST / 'animations' / (clip+'.json'), dict(duration=max(p[-1][0] for f in curves.values() for p in f.values()), curves=curves))
    prefab = dict(schemaVersion=2, id=unit_id, code=unit_id.replace('_', '-'),
                      source=f'GW_BattleUniverse_DLC_0079/Units/BattleUnits/{unit_id}/{unit_id}.ini',
                      materials=dict(icon=texture(data['graphics']['icon_build']), textures=textures),
                      skeleton=bones, layers=sorted(layers, key=lambda l: l['order']), animations=animations,
                      presentation=dict(shield=True, mapScale=1, battleScale=1, idle='Common_Idle',
                                        move='OnMovingWalk', stagger='Common_Stagger', dodge='Common_Dodge_L', deathEffect='Explosion_Ground_1'))
    return data, configure_movement(prefab, data)


def import_weapon(prefab, weapon_id, filename, name, kind, clip, minimum, maximum, hit, resource):
    data = parse(ROOT / 'Units/BattleUnits/Weapon' / filename)
    turret_name = next(k for k in data if k.startswith('turret_'))
    turret = data[turret_name]
    projectile = data['projectile_' + turret['projectile']]['spawnUnit']
    channels = dict(BeamDamage='beam', ShellDamage='shell', CqbDamage='melee',
                    CqbBeamDamage='meleeBeam', CqbShellDamage='meleeShell')
    components = {channel: float(re.search(r'\b'+source+r'[:=]([\d.]+)', projectile)[1])
                  for source, channel in channels.items() if re.search(r'\b'+source+r'[:=]([\d.]+)', projectile)}
    queue = next(v['alsoQueueAction'] for k, v in data.items() if k.startswith('hiddenAction_') and 'alsoQueueAction' in v)
    steps = []
    for action in queue.split(','):
        value = inherited(data, 'hiddenAction_' + action.strip())
        step = dict(delay=float(value.get('buildSpeed', '0s').removesuffix('s')))
        if 'fireTurretXAtGround' in value:
            step['shots'] = 1
        if 'PlayCommon_Melee_F' in value.get('alsoTriggerAction', ''):
            step['animation'] = 'Common_Melee_F'
        steps.append(step)
    sound = source_path(turret['shoot_sound'])
    copy_asset(sound, DEST / 'sounds' / sound.name)
    weapon = dict(name=name, sourceName=weapon_id, type=kind, min=minimum, max=maximum,
                  hit=hit, clip=clip, slot='primary', damagePerShot=sum(components.values()),
                  damageComponents=components, hitsPerShot=1, attack=dict(steps=steps),
                  source=dict(file='Units/BattleUnits/Weapon/'+filename, barrelX=float(turret.get('barrelX', 0)), barrelY=float(turret.get('barrelY', 0))),
                  sound=dict(file='../../sounds/'+sound.name, volume=float(turret['shoot_sound_vol'])),
                  hitEffect='Cqb_Hit_1' if kind == 'melee' else 'Explosion_Hit_1' if weapon_id == 'Common_Cannon' else 'Beam_Hit_1_S_Pink', **resource)
    if kind != 'melee':
        projectile_id = projectile.split('*')[0].strip()
        decal = parse(MAIN / f'Units/BattleUnits/Weapon/{"Beam" if kind == "beam" else "Shell"}/Projectile/{projectile_id}.ini')['decal_Projectile_Image']
        image = source_path(decal['image'], MAIN)
        copy_asset(image, DEST / 'projectiles' / image.name)
        weapon['projectile'] = dict(texture='../../projectiles/'+image.name, scale=float(decal.get('imageScale', 1)),
                                    speed=float(re.search(r'ProjectileSpeed[:=]([\d.]+)', projectile)[1]),
                                    forwardOffset=float(decal.get('yOffsetRelative', 0)), rotation=float(decal.get('dirOffset', 0)))
        layer_name = 'RGC_80_Cannon' if weapon_id == 'Common_Cannon' else weapon_id
        layer = next(l for l in prefab['layers'] if l['name'] == layer_name)
        bone = prefab['skeleton'][layer['bone']]
        weapon['muzzle'] = dict(layer=layer_name, point=dict(
            x=(weapon['source']['barrelX']-bone['x']-layer['offset']['x'])/layer.get('scale', 1),
            y=-(weapon['source']['barrelY']-bone['y']-layer['offset']['y'])/layer.get('scale', 1)))
    if weapon_id == 'Common_Cannon':
        weapon.update(slot='fixed', changeHeldWeapon=False)
        weapon['attack']['startAnimation'] = None
        weapon['attack']['steps'][0]['animation'] = clip
    return weapon


def add_stats(prefab, data, hp, move, mobility, cost):
    text = ' '.join(v for section in data.values() for v in section.values())

    def number(name):
        return float(re.search(r'\b'+name+r'\s*=\s*([\d.]+)', text)[1])

    channels = dict(beam='Beam', shell='Shell', melee='Cqb', dp='Dp', sp='Sp')
    prefab['stats'] = dict(hp=hp, en=100, move=move, mobility=mobility, cost=cost)
    prefab['attackBonuses'] = dict(melee=0, shooting=0, beam=0, shell=0)
    prefab['defenses'] = {key: dict(percent=number('base'+source+'Def'), flat=number('base'+source+'DefPlus')) for key, source in channels.items()}
    prefab['shield'] = dict(hp=float(data['core']['maxShield']), blockChance=number('finalShieldBlockPR'), coverage=number('finalShieldSize'),
                            defenses={key: dict(percent=number('shield'+source+'Def'), flat=number('shield'+source+'DefPlus')) for key, source in channels.items() if key != 'sp'})
    prefab['sourceStats'] = dict(hp=float(data['core']['maxHp']), walkSpeed=number('baseMoveSpeed'), boostSpeed=number('boostMoveSpeed'), turnSpeed=number('baseTurnSpeed'), reaction=number('baseReactionLevel'))


gm_file = DEST / 'units/RGM_79/unit.json'
gm = json.loads(gm_file.read_text(encoding='utf-8'))
gm_data = load(ROOT / 'Units/BattleUnits/RGM_79/RGM_79.ini')
add_stats(gm, gm_data, 21000, 5, 100, 300)
gm['description'] = '标准型：均衡的机动性与耐久，主武器可选三种套件。'
# Retain separate melee/beam components instead of applying one defense to their sum.
for key, weapon in gm['weapons'].items():
    data = parse(ROOT / weapon['source']['file'])
    spawn = next(v['spawnUnit'] for k, v in data.items() if k.startswith('projectile_') and 'spawnUnit' in v)
    weapon['damageComponents'] = {channel: float(match[1]) for source, channel in dict(BeamDamage='beam', ShellDamage='shell', CqbDamage='melee', CqbBeamDamage='meleeBeam').items() if (match := re.search(r'\b'+source+r'[:=]([\d.]+)', spawn))}

new_prefabs = []
for unit_id in ('RGC_80', 'RGM_79L'):
    data, prefab = import_visuals(unit_id)
    if unit_id == 'RGC_80':
        prefab.update(name='吉姆加农', description='支援型：机动与耐久偏低，固定肩部加农炮不随主武器套件更换。')
        add_stats(prefab, data, 16500, 4, 85, 300)
        prefab['weapons'] = {key: copy.deepcopy(gm['weapons'][key]) for key in ('EF_BeamSprayGun', 'EF_90mmMG')}
        prefab['weapons']['Common_Cannon'] = import_weapon(prefab, 'Common_Cannon', 'Shell/Common_Cannon.gw', '肩部加农炮', 'shell', 'Common_Cannon_Shoot_A', 3, 7, 75, dict(ammo=8))
        prefab['weapons']['Common_Cqb_A'] = import_weapon(prefab, 'Common_Cqb_A', 'Cqb/Common_Cqb_A.gw', '格斗', 'melee', 'Common_Melee_A', 1, 1, 96, {})
        secondaries = ['Common_Cannon', 'Common_Cqb_A']
        primary = [('beam_spray', '光束喷枪套件', 'EF_BeamSprayGun', 100), ('machine_gun', '机枪套件', 'EF_90mmMG', 0)]
    else:
        prefab.update(name='轻装吉姆', description='轻装型：高机动、移动距离较长，耐久中等，盾牌较小。')
        add_stats(prefab, data, 18500, 7, 120, 325)
        prefab['weapons'] = {'EF_90mmMG': copy.deepcopy(gm['weapons']['EF_90mmMG'])}
        prefab['weapons']['EF_BOWA_BeamGun'] = import_weapon(prefab, 'EF_BOWA_BeamGun', 'Beam/EF_BOWA_BeamGun.gw', 'BOWA光束枪', 'beam', 'Common_Shoot_A', 2, 5, 85, dict(en=10))
        prefab['weapons']['EF_BeamSaber_BF'] = import_weapon(prefab, 'EF_BeamSaber_BF', 'Cqb/EF_BeamSaber_BF.gw', '光束军刀', 'melee', 'Common_Melee_B', 1, 1, 96, dict(en=8))
        secondaries = ['EF_BeamSaber_BF']
        primary = [('beam_gun', '光束枪套件', 'EF_BOWA_BeamGun', 100), ('machine_gun', '机枪套件', 'EF_90mmMG', 0)]
    for key in secondaries:
        if key != 'Common_Cannon':
            prefab['weapons'][key]['slot'] = 'secondary'
    prefab['weaponKits'] = [dict(id=kit, name=name, cost=cost, weapons=[weapon, *secondaries]) for kit, name, weapon, cost in primary]
    for layer in prefab['layers']:
        for kit, _, weapon, _ in primary:
            if layer['name'].startswith(weapon):
                layer['visibleWhen'] = dict(kit=kit, heldWeapon={'not': weapon} if layer['name'].endswith('_NotUsing') else weapon)
        if layer['name'] == 'EF_BeamSaber_BF':
            layer['visibleWhen'] = dict(heldWeapon='EF_BeamSaber_BF')
        if layer['name'] == 'Body_BeamSaberL':
            layer['visibleWhen'] = dict(heldWeapon={'not': 'EF_BeamSaber_BF'})
    new_prefabs.append(prefab)

for prefab in (gm, *new_prefabs):
    kit_costs = json.loads((DEST / 'weapon-kit-costs.json').read_text(encoding='utf-8'))
    for kit in prefab['weaponKits']:
        kit['cost'] = kit_costs[kit['id']]
    for key, weapon in prefab['weapons'].items():
        # Re-importing is deterministic: copied GM weapons have not been reduced yet.
        multiplier = .65 if key in ('EF_HypeBazooka', 'Common_Cannon') else .75 if key == 'EF_90mmMG' else .85 if weapon['type'] == 'melee' or key == 'Common_DoubleVulcan_MS' else .8
        weapon['sourceHit'] = weapon['hit']
        weapon['hitMultiplier'] = multiplier
        weapon['hit'] = round(weapon['hit'] * multiplier)
        weapon['hitBonus'] = 10
        weapon['hit'] = min(100, weapon['hit'] + weapon['hitBonus'])
        if key == 'EF_BeamSprayGun':
            weapon['damagePerShot'] = 5000 / 3
            weapon['damageComponents'] = dict(beam=5000 / 3)
            weapon['attack'] = dict(steps=[dict(delay=.25,shots=1),dict(delay=.4,shots=1,animation=weapon['clip'],repeat=2),dict(delay=.25)])
        if key == 'Common_Cannon':
            weapon['damagePerShot'] = 2600
            weapon['damageComponents'] = dict(shell=2600)
            weapon['max'] += 1
            weapon['attack']['steps'] = [step for _ in range(3) for step in (dict(delay=.35,animation=weapon['clip']),dict(delay=.25,shots=1))] + [dict(delay=1.25)]
        if key == 'EF_BOWA_BeamGun':
            weapon['damagePerShot'] = 1300
            weapon['damageComponents'] = dict(beam=1300)
            weapon['attack'] = dict(steps=[dict(delay=.15,shots=1),dict(delay=.4,shots=1,animation=weapon['clip'],repeat=2),dict(delay=.15)])
        if key == 'EF_HypeBazooka':
            weapon['damagePerShot'] = 5000
            weapon['damageComponents'] = dict(shell=5000)
            weapon['attack'] = dict(steps=[dict(delay=.35,shots=2),dict(delay=.3)])
            weapon['muzzle']['pairSpacing'] = 3
        weapon.pop('ammo',None)
        weapon['en'] = {'EF_BeamSprayGun':12,'EF_90mmMG':10,'EF_HypeBazooka':18,'Common_Cannon':20,
                        'EF_BOWA_BeamGun':12,'EF_BeamSaber_A':8,'EF_BeamSaber_BF':8,
                        'Common_Cqb_A':6,'Common_DoubleVulcan_MS':6}[key]
        if key in ('EF_HypeBazooka', 'Common_Cannon'):
            weapon['projectile']['speed'] *= .5
        if key == 'EF_BeamSaber_A':
            prefab['animations']['Common_Melee_F'] = '../../animations/Common_Melee_F.json'
            weapon['hitsPerShot'] = 1
            weapon['attack'] = dict(steps=[dict(delay=.6, shots=1), dict(delay=.4, animation='Common_Melee_F'), dict(delay=.3, shots=1), dict(delay=1.4)])
        weapon['hit'] = int((weapon['hit'] + 2.5) // 5 * 5)
        weapon['hitBonus'] = weapon['hit'] - int(weapon['sourceHit'] * weapon['hitMultiplier'] + .5)
    apply_introduction(prefab, load(ROOT / f'Units/BattleUnits/{prefab["id"]}/{prefab["id"]}.ini'))
    write(DEST / f'units/{prefab["id"]}/unit.json', prefab)

catalog = json.loads((DEST / 'unit-catalog.json').read_text(encoding='utf-8'))
catalog['units'] = [f'units/{p["id"]}/unit.json' for p in (gm, *new_prefabs)]
catalog['map'] = dict(width=24, height=18)
catalog['formation'] = dict(maxUnits=12, maxCost=5000, aiUnits=12, unitCostLimit=500)
catalog['deployment'] = dict(radius=4, spawns=[dict(x=2,y=8),dict(x=21,y=8)])
catalog['music'] = 'music/playlist.json'
write(DEST / 'unit-catalog.json', catalog)
tracks = []
for index in range(1, 7):
    name = f'GRNYB_{index:02d}_Remix'
    copy_asset(ROOT / f'Resource/Music/{name}.ogg', DEST / f'music/{name}.ogg')
    tracks.append(dict(name=name, file=name+'.ogg'))
write(DEST / 'music/playlist.json', dict(volume=.25, tracks=tracks))
presentation = json.loads((DEST / 'presentation.json').read_text(encoding='utf-8'))
presentation['sfxVolume'] = .5
presentation.pop('dodgeHold', None)
presentation.pop('dodgeReturn', None)
presentation['meleeAnimationSpeed'] = 1
presentation['battleFadeIn'] = .3
presentation['battleHold'] = 2
presentation['battleFadeOut'] = .3
for key, filename, volume in [('deathSound','Dead_4.ogg',1),('moveSound','Boost_1.ogg',.5)]:
    source = ROOT / 'Resource/Sound/SE/Unit' / filename
    copy_asset(source,DEST / 'sounds' / filename)
    data=source.read_bytes()
    rate=struct.unpack_from('<I',data,data.index(b'\x01vorbis')+12)[0]
    duration=struct.unpack_from('<Q',data,data.rfind(b'OggS')+6)[0]/rate
    presentation[key]=dict(file='sounds/'+filename,volume=volume,duration=duration)
presentation['deathDelay'] = presentation['deathSound']['duration']
write(DEST / 'presentation.json', presentation)
print('Imported RGM-79, RGC-80, RGM-79L and six offline BGM tracks')
