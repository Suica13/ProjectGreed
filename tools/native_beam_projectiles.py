"""Native segmented beam pulses; visual helpers never supply damage flight speed."""
import copy
import functools
import re
import shutil
import struct
from mod_source import ASSETS, MAIN, MOD, load, section, resolve


@functools.lru_cache(None)
def helper_path(name):
    return next((MAIN / 'Resource/Image/Fx/Weapon/Beam').rglob(name + '.ini'), None)


def parts(path, color):
    data = load(path)
    result = []
    for name in data:
        if not name.startswith('decal_Effect'):
            continue
        item = section(data, name)
        image = item.get('image', '')
        if not image.startswith('ROOT:') or not item.get('total_frames'):
            continue
        if any(c in image for c in ('Pink', 'Yellow', 'Blue', 'Green', 'Red')) and color not in image:
            continue
        from native_combat import numeric, globals_for
        item['total_frames'] = numeric(item['total_frames'], data, globals_for(path))
        result.append((item, data))
    if result:
        return result
    # Older all-around cannons put their two sheets on attached helper units.
    for name in data:
        if not name.startswith('attachment_Effect_'):
            continue
        item = section(data, name)
        child = helper_path(item.get('onCreateSpawnUnitOf', '') + '_' + color)
        if child is None:
            child = helper_path(item.get('onCreateSpawnUnitOf', ''))
        if child:
            for decal, child_data in parts(child, color):
                decal = dict(decal)
                decal['yOffsetRelative'] = float(decal.get('yOffsetRelative', 0)) + float(item.get('y', 0))
                result.append((decal, child_data))
    return result


def apply(prefab, weapon, data=None):
    if not weapon.get('projectile') or weapon.get('remote'):
        return False
    source = weapon.get('source', {}).get('file')
    if not source:
        return False
    root = MOD / prefab['source'].split('/')[0]
    source_path = root / source
    if not source_path.is_file():
        source_path = MOD / source
    if not source_path.is_file():
        return False
    data = data or load(source_path)
    stem = source.rsplit('/', 1)[-1].rsplit('.', 1)[0]
    helper = None
    color = 'Pink'
    carrier = None
    from native_combat import damage_spawn, payload
    for barrel in weapon.get('source', {}).get('barrels', []):
        turret = data.get('turret_' + barrel['id'])
        if not turret:
            continue
        raw = data.get('projectile_' + section(data, 'turret_' + barrel['id']).get('projectile', ''), {}).get('spawnUnit', '')
        match = re.search(r'\b(Projectile_HighBeamCannon_(\w+)_Effect)\b', raw)
        if match:
            helper, color = match[1], match[2]
            carrier = payload(damage_spawn(raw))
            break
    if not helper:
        for name, action in data.items():
            if not name.startswith('hiddenAction_' + stem):
                continue
            candidate = action.get('attachments_addNewUnits', '')
            if candidate.startswith('HighBeamRifle_') and candidate.endswith('EffectUnit'):
                helper = candidate
                slot = action.get('attachments_onlyOnSlots', '')
                tag = data.get('hiddenAction_' + slot + '_SetColor', {}).get('sendMessageWithTags', '')
                color = tag.removeprefix('SetColor_') or color
                break
    if not helper and prefab['id'] == 'MSN_04' and weapon.get('sourceName') == 'NZN_MSN_04_HighBeamCannon':
        # User-approved interim projectile: Re-GZ Custom's HighBeamCannon, in green.
        helper, color = 'Projectile_HighBeamCannon_Green_Effect', 'Green'
        reference = MOD / 'GW_BattleUniverse_DLC_0093/Units/BattleUnits/Weapon/Beam/EF_RGZ_91B_HighBeamCannon.gw'
        native_reference = load(reference)
        carrier = payload(damage_spawn(native_reference['projectile_EF_RGZ_91B_HighBeamCannon_Projectile']['spawnUnit']))
        weapon['projectile']['texture'] = '../../projectiles/Beam_2_Green.png'
        weapon['hitEffect'] = 'Beam_Hit_2_Green'
        weapon['projectile']['adaptationSource'] = reference.relative_to(MOD).as_posix()
    if not helper:
        return False
    path = helper_path(helper)
    if path is None:
        raise ValueError('Missing native beam helper: ' + helper)
    segments = []
    for decal, native in parts(path, color):
        image = resolve(decal['image'], root=MAIN)
        width, height = struct.unpack_from('>II', image.read_bytes(), 16)
        frames = int(decal['total_frames'])
        if width % frames:
            raise ValueError('Invalid native beam strip: ' + str(image))
        destination = ASSETS / 'projectiles' / image.name
        if not destination.exists() or destination.read_bytes() != image.read_bytes():
            shutil.copyfile(image, destination)
        scale = float(decal.get('imageScale', 1))
        segments.append(dict(texture='../../projectiles/' + image.name, frames=frames,
            width=width // frames, height=height,
            scaleX=scale * float(decal.get('imageScaleX', 1)),
            scaleY=scale * float(decal.get('imageScaleY', 1)),
            forward=float(decal.get('yOffsetRelative', 0)),
            lateral=float(decal.get('xOffsetRelative', 0)),
            rotation=float(decal.get('dirOffset', -90)) + 90))
    if not segments:
        raise ValueError('Missing segmented beam artwork: ' + helper)
    length = max(s['forward'] + s['width'] * s['scaleX'] / 2 for s in segments)
    sequence = dict(source=path.relative_to(MOD).as_posix(), color=color, length=length,
        segments=segments, clock='flight')
    before = copy.deepcopy((weapon['projectile'], weapon.get('nativePayload')))
    weapon['projectile']['sequence'] = sequence
    if carrier and carrier.get('ProjectileSpeed', 0) > 0:
        # Previous imports flattened both spawn resources and kept the helper's
        # 0.75/1.0 frame-rate value instead of the 55/75 damage-carrier speed.
        speed = carrier['ProjectileSpeed']
        weapon.setdefault('nativePayload', {})['ProjectileSpeed'] = speed
        weapon['projectile']['speed'] = speed
        weapon['projectile']['nativeSpeed'] = speed
    return before != (weapon['projectile'], weapon.get('nativePayload'))
