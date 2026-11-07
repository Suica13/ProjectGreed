"""Compile native remote launch actions into one authoritative beam weapon.
Remote units are presentation objects, never extra simulation/network entities.
"""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json
import re
import shutil
from mod_source import ASSETS, MOD, ROOT, load, parse, section, resolve, source_root

CARRIERS = ('MAN_03', 'MAN_08', 'MSN_02', 'MS_06Z', 'MSN_01')

def globals_in(path):
    return {key: float(value) for key, value in re.findall(
        r'@global\s+(\w+)\s*=\s*([\d.]+)', path.read_text(encoding='utf-8-sig'))}

def launches(data, entry):
    """Follow both native queues in order, preserving repeated queued actions."""
    def walk(name, stack=()):
        if name in stack:
            raise ValueError('Cyclic remote action: ' + name)
        action = data.get('action_' + name, data.get('hiddenAction_' + name, {}))
        if action.get('fireTurretXAtGround'):
            turret = section(data, 'turret_' + action['fireTurretXAtGround'])
            projectile = section(data, 'projectile_' + turret['projectile'])
            yield projectile['spawnUnit'].split('*')[0].strip()
        for queue in ('alsoTriggerAction', 'alsoQueueAction'):
            for child in action.get(queue, '').split(','):
                if child.strip():
                    yield from walk(child.strip(), (*stack, name))
    return list(walk(entry))

def native_burst(prefab, path, child, root):
    """Follow the remote gun's actual firing chain, just like an ordinary weapon."""
    from native_combat import native_weapon
    barrels = [name[7:] for name in child if name.startswith('turret_')
        and 'BeamDamage' in section(child, 'projectile_' + section(child, name).get('projectile', '1')).get('spawnUnit', '')]
    if not barrels:
        raise ValueError('Unsupported remote payload (reflector or indirect control): ' + path.stem)
    gun = dict(sourceName=barrels[0], source={'file':path.relative_to(root).as_posix(),
        'barrels':[{'id':name} for name in barrels]}, projectile={})
    native_weapon(prefab, gun, child)
    return gun


def compile_launcher(prefab, path, root=ROOT, copy_assets=True):
    data = load(path, root)
    key = path.stem
    action = data['action_' + key + '_Trigger']
    children = launches(data, key + '_Trigger')
    if not children or len(children) > 16:
        raise ValueError('Invalid native remote count: ' + key)
    values = globals_in(path)
    units, mounts, bursts = [], [], []
    control = None
    payloads = []
    color = "Yellow"
    projectile_texture = None
    projectile_hit = None
    for ident in children:
        child_path = next(root.glob('Units/BattleUnits/*/' + ident + '.ini'), None)
        if child_path is None:
            raise ValueError('Missing native remote: ' + ident)
        child = load(child_path, root)
        def ancestry(file):
            refs = parse(file).get('core',{}).get('copyFrom','')
            return str(file) + refs + ''.join(ancestry(resolve(r, file.parent, root)) for r in refs.split(',') if r.strip())
        raw = ancestry(child_path)
        kind = 'incom' if 'Incom_Type' in raw else 'wired' if 'Funnel_TypeA_Line' in raw else 'funnel'
        if control and control != kind:
            raise ValueError('Mixed native remote controls: ' + key)
        control = kind
        projectile = next((v for k,v in child.items() if k.startswith('projectile_') and 'BeamDamage' in v.get('spawnUnit','')), None)
        if projectile is None:
            raise ValueError('Unsupported remote payload (reflector or indirect control): ' + ident)
        burst = native_burst(prefab, child_path, child, root)
        bursts.append(burst)
        payloads.append({name:float(value) for name,value in re.findall(r'(\w+)\s*[=:]\s*([-\d.]+)',projectile['spawnUnit'])})
        if not units:
            color = next((name for name in ('Yellow','Pink','Blue') if name in projectile['spawnUnit']), 'Yellow')
        # Resolve the actual child projectile, including the native short beam trail.
        projectile_id = projectile['spawnUnit'].split('*',1)[0].strip()
        projectile_path = root/'Units/BattleUnits/Weapon/Beam/Projectile'/(projectile_id+'.ini')
        if not projectile_path.exists(): projectile_path = MOD/'GW_BattleUniverse_Main/Units/BattleUnits/Weapon/Beam/Projectile'/(projectile_id+'.ini')
        projectile_data = load(projectile_path)
        if projectile_texture is None:
            projectile_texture = resolve(projectile_data['decal_Projectile_Image']['image'],projectile_path.parent,source_root(projectile_path)).name
            projectile_hit = projectile_data['hiddenAction_SpawnHitEffect']['spawnEffects']
        trail = next((section(projectile_data,key) for key in projectile_data if key.startswith('effect_Beam_TrailLine')), None)
        trail_config = None
        if trail:
            image_path = resolve(trail['image'],projectile_path.parent,source_root(projectile_path))
            # ROOT references in shared projectile files belong to the main package.
            destination = ASSETS/'projectiles'/image_path.name
            if copy_assets and not destination.exists(): shutil.copyfile(image_path,destination)
            trail_config = dict(texture='../../projectiles/'+image_path.name,alpha=float(trail.get('alpha',.35)),
                lifeSeconds=float(trail['life'])/60,intervalSeconds=.02 if '_S_' in image_path.name else .03,
                scaleFrom=float(trail.get('scaleFrom',1)),scaleTo=float(trail.get('scaleTo',1)))
        body = child['decal_Body']
        image = resolve(body['image'], child_path.parent, root)
        destination = ASSETS / 'units' / prefab['id'] / 'textures' / image.name
        if copy_assets and not destination.exists():
            shutil.copyfile(image, destination)
        prefab['materials']['textures'][image.name] = 'textures/' + image.name
        side = 'leftArm' if ident.endswith('_L') else 'rightArm' if ident.endswith('_R') else None
        bone = 'LeftArm' if side == 'leftArm' else 'RightArm' if side else 'Body'
        if bone not in prefab['skeleton']:
            bone = 'Body'
        candidates=[layer for layer in prefab.get('layers',[]) if layer.get('texture')==image.name]
        local_name=ident.removeprefix(prefab['id']+'_')
        mounted=next((layer for layer in candidates if layer['name']==local_name), candidates[0] if candidates else None)
        units.append(dict(texture=image.name, scale=float(body.get('imageScale', 1)),
                          burstShots=burst['nativeTiming']['projectiles'],trail=trail_config,
                          nativeUnit=ident, requiredParts=[side] if side else [],
                          hideLayers=[mounted['name']] if mounted else [],scaleX=mounted.get('scaleX',1) if mounted else 1))
        mounts.append(dict(layer=mounted['name'],point=dict(x=0,y=0)) if mounted else dict(bone=bone, offset=dict(x=0, y=0)))
    # Check the actual player lock, not unused globals or the AI-only lock.
    locked = ' '.join(v for k,v in action.items() if k.startswith('isLocked') and 'Message' not in k)
    awakening = values.get(key + '_PilotAwakeningSkill') if 'pilotAwakeningSkillFinal' in locked else None
    names = {'funnel': ('浮游炮', 'Funnels / BITs', 'ファンネル / ビット'),
             'wired': ('有线浮游炮', 'Wired Remote Cannons', '有線サイコミュ砲'),
             'incom': ('INCOM有线炮', 'INCOM', 'インコム')}[control]
    steps, previous = [], 0
    native_damage = payloads[0]["BeamDamage"]
    from native_combat import CHANNELS
    native_components = {channel: payloads[0][key] for key,channel in CHANNELS.items() if payloads[0].get(key,0)>0}
    native_total = sum(native_components.values())
    # Retain two tactical firing positions, each firing the full native burst.
    shot_damage = native_total
    components = dict(native_components)
    if control != 'incom': awakening = 75
    events = []
    for cycle in range(2):
        for index, burst in enumerate(bursts):
            at = 0
            first = burst['nativeTiming']['firstShot']
            for step in burst['attack']['steps']:
                for repeat in range(step.get('repeat', 1)):
                    at += step['delay']
                    if not step.get('shots'): continue
                    item = {k:v for k,v in step.items() if k not in ('delay','repeat','muzzleIndex','requiredParts','weaponDisplayIndex','animation')}
                    item.update(muzzleIndex=index, requiredParts=units[index]['requiredParts'])
                    channels = step.get('damageComponents', burst['damageComponents'])
                    if channels != components: item['damageComponents'] = channels
                    else: item.pop('damageComponents',None)
                    events.append((round(.7+cycle*1.2+index*.13+at-first,6),item))
    for at,item in sorted(events,key=lambda event:event[0]):
        steps.append(dict(item,delay=round(at-previous,6)))
        previous=at
    weapon = dict(sourceName=key, name=names[0], localization={lang: {'name': name} for lang,name in zip(('zh','en','ja'),names)},
        type='beam', category='remote', slot='secondary', min=1, max=6 if control=='funnel' else 4,
        hit=100 if control!='incom' else payloads[0].get('WeaponAccuracy',85), en=values[key + '_EN'], actionCost=3, damagePerShot=shot_damage, damageComponents=components,
        hitsPerShot=1, clip=None, changeHeldWeapon=False, requiredParts=[],
        attack={'startAnimation':None,'steps':steps}, muzzle={'mounts':mounts},
        projectile={'texture':'../../projectiles/'+projectile_texture,'scale':.65,'speed':85,
                    'forwardOffset':0,'rotation':0,'visibleInFog':False},
        hitEffect=projectile_hit, nativePayload=payloads[0], sound={'file':'../../sounds/BeamGun_3.ogg','volume':.45},
        source={'file':str(path.relative_to(root)).replace('\\','/'),'root':root.name},
        remote={'kind':control,'units':units,'shotsPerUnit':2,'moveSeconds':.6,'settleSeconds':.1,
                'waitSeconds':.5,'staggerSeconds':.13,'returnSeconds':.65,'awakeningScale':0 if control=='incom' else .04},
        nativeRemote={'count':len(units),'cooldownSeconds':values.get(key+'_CD'),
                      'awakeningMinimum':awakening,'entry':key+'_Trigger','unitSources':children,'unitPayloads':payloads,'unitBursts':[burst['nativeTiming'] for burst in bursts]},
        description='')
    burst_counts = '/'.join(str(unit['burstShots']) for unit in units)
    descriptions = {
        'zh': f'{len(units)}个单元，各射击2轮；每轮按原MOD动作链发射{burst_counts}发，独立逐发判定。原始载荷与连射间隔保留；伤害应用全局换算、人工差值及现有觉醒成长。',
        'en': f'{len(units)} remote units, 2 firing positions each. Native burst: {burst_counts} shots per position, resolved separately before global, editor and Awakening modifiers.',
        'ja': f'{len(units)}基が各2回射撃。各回の原作連射数は{burst_counts}発、1発ずつ判定。原作ダメージと間隔に全体換算・編集差分・覚醒補正を適用。',
    }
    weapon['description'] = descriptions['zh']
    for lang, text in descriptions.items(): weapon['localization'][lang]['description'] = text
    weapon['sourceHit'] = weapon['hit']
    weapon['nativeTiming'] = dict(source=weapon['source']['file'], entry=key+'_Trigger',
        cooldown=values.get(key+'_CD',0), duration=previous, firstShot=.7,lastShot=previous,
        firingEvents=len(events),projectiles=sum(step.get("shots",0) for step in steps),declaredEnergy=weapon['en'],energyMode='perVolley',
        energyPerEmission=0,energy=weapon['en'],adaptation='two_positions_with_native_bursts')
    if awakening is not None:
        weapon['pilotRequirements']=[dict(stat='awakening',operator='>=',value=awakening)]
    if any(u['requiredParts'] for u in units):
        weapon['anyParts']=['leftArm','rightArm']
    if control=='incom' and 'headBreaked' in locked:
        weapon['requiredParts']=['head']
    return key,weapon

def apply(prefab, native=None):
    native = native or load(MOD / prefab['source'])
    root = MOD / prefab['source'].split('/')[0]
    refs = [m['source'] for m in prefab.get('mechanics',[]) if m.get('id','').startswith('remote_weapon_')]
    refs += [r.strip().removeprefix('ROOT:') for r in native.get('core',{}).get('copyFrom','').split(',')
             if '/Weapon/Funnel/' in r and '/Mod/' not in r]
    for reference in dict.fromkeys(refs):
        path=root/reference
        try:
            key,weapon=compile_launcher(prefab,path,root)
        except ValueError as error:
            if not str(error).startswith('Unsupported remote payload'): raise
            prefab.setdefault('mechanics', []).append({'id':'remote_review_'+path.stem, 'name':str(error), 'source':reference, 'status':'review'})
            continue
        prefab['weapons'][key]=weapon
        for kit in prefab['weaponKits']:
            if key not in kit['weapons']:kit['weapons'].append(key)
        for mechanic in prefab.get('mechanics',[]):
            if mechanic['id']=='remote_weapon_'+key:
                mechanic.update(status='adapted',name=weapon['name']+'：逐发判定、错峰飞行与回收')
    return prefab

def connect_prototype_technology():
    path=ASSETS.parent/'shared/development-tree.json'
    tree=load_source_json(path.read_text(encoding='utf-8'))
    node=next(n for n in tree['ZEON'] if n['id']=='Tech_ZEON_0079_T2_ZeongDevelopmentPlan')
    for ident in ('MS_06Z','MSN_01'):
        if (ASSETS/f'units/{ident}/unit.json').exists() and ident not in node['unlocks']:
            node['unlocks'].append(ident)
    path.write_text(dump_source_json(tree,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__ == '__main__':
    connect_prototype_technology()
    for ident in CARRIERS:
        path=ASSETS/f'units/{ident}/unit.json'
        prefab=load_source_json(path.read_text(encoding='utf-8'))
        apply(prefab)
        path.write_text(dump_source_json(prefab,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        for w in prefab['weapons'].values():
            if w.get('remote'):print(ident,w['remote']['kind'],len(w['remote']['units']))
