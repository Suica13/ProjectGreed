"""Translate the source MOD once. No MOD expression language is used at runtime."""
import json
import math
import re
import shutil


def normalize(prefab, root, dest, parse):
    prefab['schemaVersion'] = 2
    prefab['presentation']['deathEffect']='Explosion_Ground_1'
    prefab['presentation']['dodge']='Common_Dodge_L'
    for bone in prefab['skeleton'].values():
        for key, value in list(bone.items()):
            bone[key] = float(value)
    weapon_names = {'EF_BeamSprayGun': ('beam_spray', 'bsg'),
                    'EF_90mmMG': ('machine_gun', 'mg'),
                    'EF_HypeBazooka': ('bazooka', 'bz')}
    layers = []
    for old in prefab['layers']:
        layer = dict(name=old['name'], texture=old['texture'],
                     bone=old['basePositionFromLegEnd'], order=float(old.get('order', 0)))
        numeric = {'imageScale':'scale','imageScaleX':'scaleX','imageScaleY':'scaleY',
                   'dirOffset':'rotation','pivotOffset':'pivot','hOffset':'height',
                   'total_frames':'frames','frame_width':'frameWidth','frame_height':'frameHeight',
                   'frame':'frame','alpha':'alpha'}
        for source, target in numeric.items():
            if source in old: layer[target] = float(old[source])
        layer['offset'] = dict(x=float(old.get('xOffsetRelative',0)),y=float(old.get('yOffsetRelative',0)))
        layer['worldOffset'] = dict(x=float(old.get('xOffsetAbsolute',0)),y=float(old.get('yOffsetAbsolute',0)))
        name = layer['name']
        for prefix, (kit, weapon) in weapon_names.items():
            if name.startswith(prefix):
                layer['visibleWhen'] = dict(kit=kit, heldWeapon={'not':weapon} if name.endswith('_NotUsing') else weapon)
        if name == 'EF_BeamSaber_A': layer['visibleWhen'] = dict(heldWeapon='bs')
        if name == 'Body_BeamSaberL': layer['visibleWhen'] = dict(heldWeapon={'not':'bs'})
        if name == 'Shield': layer['visibleWhen'] = dict(shieldVisible=True)
        if name in ('Head', 'Head_Close'): layer['visibleWhen'] = dict(visorClosed=name.endswith('_Close'))
        if not any(layer['worldOffset'].values()): layer.pop('worldOffset')
        if not any(layer['offset'].values()): layer.pop('offset')
        layers.append(layer)
    prefab['layers'] = layers
    prefab.pop('secondaryWeapons')
    for kit in prefab['weaponKits']:
        kit['weapons'] = [kit.pop('primary'), 'bs', 'vulcan']
        kit.pop('equipmentIndex')

    sources = dict(bsg='Beam/EF_BeamSprayGun.gw', mg='Shell/EF_90mmMG.gw',
                   bz='Shell/EF_HypeBazooka.gw', bs='Cqb/EF_BeamSaber_A.gw',
                   vulcan='Shell/Common_DoubleVulcan_MS.gw')
    prefixes = dict(bsg='EF_BeamSprayGun',mg='EF_90mmMG',bz='EF_HypeBazooka',bs='EF_BeamSaber_A',vulcan='Common_DoubleVulcan_MS')
    main = root.parent / 'GW_BattleUniverse_Main'
    for key, weapon in prefab['weapons'].items():
        weapon.pop('hold',None)
        weapon.pop('damage',None)
        weapon['slot'] = 'primary' if key in ('bsg','mg','bz') else 'secondary'
        prefix = prefixes[key]
        sections = parse(root / 'Units/BattleUnits/Weapon' / sources[key])
        turret = sections['turret_' + prefix]
        weapon['sourceName']=prefix
        weapon['hitEffect']={'bsg':'Beam_Hit_1_S_Pink','mg':'MG_Hit_1','bz':'Explosion_Hit_1','bs':'Cqb_Hit_1','vulcan':'MG_Hit_1_S'}[key]
        if key=='vulcan': weapon['name']='头部火神炮'
        sound_reference=turret['shoot_sound'].replace('\\','/')[5:].lstrip('/')
        sound_file=root/sound_reference
        sound_target=dest/'sounds'/sound_file.name
        sound_target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(sound_file,sound_target)
        weapon['sound']=dict(file='../../sounds/'+sound_file.name,volume=float(turret['shoot_sound_vol']))
        # Inline section inheritance (Step_3 inherits the fire instruction from Step_2).
        def section(name):
            value = sections[name].copy()
            parent = value.pop('@copyFromSection',None)
            return {**section(parent), **value} if parent else value
        steps = []
        if key == 'vulcan':
            source_text=(root / 'Units/BattleUnits/Weapon' / sources[key]).read_text(encoding='utf-8-sig')
            count = int(re.search(r'@global Common_DoubleVulcan_MS_Shoot=(\d+)',source_text)[1])
            steps = [dict(delay=0,shots=1),dict(delay=float(turret['delay'][:-1]),shots=1,repeat=count-1)]
        else:
            queue = next(v['alsoQueueAction'] for n,v in sections.items() if n.startswith('hiddenAction_') and 'alsoQueueAction' in v)
            for action in queue.split(','):
                action = action.strip()
                value = section('hiddenAction_'+action)
                delay = value.get('buildSpeed','0s')
                if delay.startswith('${'): delay = turret['delay']
                step = dict(delay=float(delay.removesuffix('s')))
                if 'fireTurretXAtGround' in value: step['shots']=1
                if key=='mg' and step.get('shots'):
                    step['animation']='Common_Shoot_A_FA' if action.endswith('_3') else 'Common_Shoot_A'
                # Collapse consecutive repeated Steps without losing their frequency.
                if steps and {k:v for k,v in steps[-1].items() if k!='repeat'} == step:
                    steps[-1]['repeat']=steps[-1].get('repeat',1)+1
                else: steps.append(step)
        projectile_source=sections['projectile_'+prefix+'_Projectile']['spawnUnit']
        damages = re.findall(r'(?:BeamDamage|ShellDamage|CqbDamage|CqbBeamDamage)[:=]([\d.]+)',projectile_source)
        weapon['damagePerShot']=sum(float(d) for d in damages)
        hits = re.search(r'ProjectileAttackTimes[:=]([\d.]+)',projectile_source)
        weapon['hitsPerShot']=int(float(hits[1])) if hits else 1
        weapon['attack']=dict(steps=steps)
        if key=='bs': weapon['attack']['hitInterval']=0.125
        if key=='mg': weapon['attack']['startAnimation']=None
        weapon['source']=dict(file='Units/BattleUnits/Weapon/'+sources[key], barrelX=float(turret.get('barrelX',0)),barrelY=float(turret.get('barrelY',0)))
        if key=='bs': continue
        if key=='vulcan':
            weapon['muzzle']=dict(bone='arm19',offset=dict(x=float(turret['barrelX']),y=float(turret['barrelY'])), alternatingOffsetX=float(turret['barrelOffsetX_onOddShots']))
            weapon['clip']=None
            weapon['changeHeldWeapon']=False
        else:
            layer=next(l for l in layers if l['name']==prefix)
            bone=prefab['skeleton'][layer['bone']]
            # Convert original unit-space barrelX/Y into the weapon PNG's pixel space.
            # That point then follows the same animated transform as the visible weapon.
            local_x=float(turret['barrelX'])-bone['x']-layer['offset']['x']
            local_y=float(turret['barrelY'])-bone['y']-layer['offset']['y']
            weapon['muzzle']=dict(layer=prefix,point=dict(x=local_x/layer.get('scale',1),y=-local_y/layer.get('scale',1)))
        projectile_name=projectile_source.split('*')[0].strip()
        category='Beam' if key=='bsg' else 'Shell'
        projectile_file=main / 'Units/BattleUnits/Weapon' / category / 'Projectile' / (projectile_name+'.ini')
        decal=parse(projectile_file)['decal_Projectile_Image']
        image=decal['image'].replace('\\','/')[5:].lstrip('/')
        texture=main/image
        target=dest/'projectiles'/texture.name
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(texture,target)
        speed=float(re.search(r'ProjectileSpeed[:=]([\d.]+)',projectile_source)[1])
        weapon['projectile']=dict(texture='../../projectiles/'+texture.name,scale=float(decal.get('imageScale',1)),speed=speed,
                                  forwardOffset=float(decal.get('yOffsetRelative',0)),rotation=float(decal.get('dirOffset',0)))
    # Display names stay Chinese; canonical IDs are the original MOD weapon names.
    prefab['weapons']={prefixes[key]:weapon for key,weapon in prefab['weapons'].items()}
    for kit in prefab['weaponKits']:
        kit['weapons']=[prefixes[key] for key in kit['weapons']]
    for layer in prefab['layers']:
        condition=layer.get('visibleWhen',{})
        if 'heldWeapon' in condition:
            value=condition['heldWeapon']
            condition['heldWeapon']={'not':prefixes[value['not']]} if isinstance(value,dict) else prefixes[value]
    return prefab
