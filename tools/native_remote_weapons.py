"""Compile native remote launch actions into one authoritative beam weapon.
Remote units are presentation objects, never extra simulation/network entities.
"""
import json
import re
import shutil
from mod_source import ASSETS, MOD, ROOT, load, parse, section, resolve

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

def compile_launcher(prefab, path, root=ROOT, copy_assets=True):
    data = load(path, root)
    key = path.stem
    action = data['action_' + key + '_Trigger']
    children = launches(data, key + '_Trigger')
    if not children or len(children) > 16:
        raise ValueError('Invalid native remote count: ' + key)
    values = globals_in(path)
    units, mounts = [], []
    control = None
    payloads = []
    color = "Yellow"
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
        projectile = next(v for k,v in child.items() if k.startswith('projectile_') and 'BeamDamage' in v.get('spawnUnit',''))
        payloads.append({name:float(value) for name,value in re.findall(r'(\w+)\s*[=:]\s*([-\d.]+)',projectile['spawnUnit'])})
        if not units:
            color = next((name for name in ('Yellow','Pink','Blue') if name in projectile['spawnUnit']), 'Yellow')
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
    events=sorted((round(.7+cycle*1.2+index*.13,4),index) for cycle in range(2) for index in range(len(units)))
    for at,index in events:
        steps.append(dict(delay=round(at-previous,4),shots=1,muzzleIndex=index,
                          requiredParts=units[index]['requiredParts']))
        previous=at
    weapon = dict(sourceName=key, name=names[0], localization={lang: {'name': name} for lang,name in zip(('zh','en','ja'),names)},
        type='beam', category='remote', slot='secondary', min=1, max=6 if control=='funnel' else 4,
        hit=payloads[0].get('WeaponAccuracy',85), en=values[key + '_EN'], actionCost=3, damagePerShot=1000, damageComponents={'beam':1000},
        hitsPerShot=1, clip=None, changeHeldWeapon=False, requiredParts=[],
        attack={'startAnimation':None,'steps':steps}, muzzle={'mounts':mounts},
        projectile={'texture':f'../../projectiles/Beam_2_{color}.png','scale':.65,'speed':85,
                    'forwardOffset':0,'rotation':0,'visibleInFog':False},
        hitEffect='Beam_Hit_2_'+color, nativePayload=payloads[0], sound={'file':'../../sounds/BeamGun_3.ogg','volume':.45},
        source={'file':str(path.relative_to(root)).replace('\\','/'),'root':root.name},
        remote={'kind':control,'units':units,'shotsPerUnit':2,'moveSeconds':.6,'settleSeconds':.1,
                'waitSeconds':.5,'staggerSeconds':.13,'returnSeconds':.65,'awakeningScale':0 if control=='incom' else .0025},
        nativeRemote={'count':len(units),'cooldownSeconds':values.get(key+'_CD'),
                      'awakeningMinimum':awakening,'entry':key+'_Trigger','unitSources':children,'unitPayloads':payloads},
        description=f'{names[0]}：{len(units)}个单元，每单元2发，基础伤害1000/发。消耗3 AP。')
    for lang, description in {
        'zh': f'{len(units)}个单元，每单元2发，基础伤害1000/发；消耗3 AP。',
        'en': f'{len(units)} remote units, 2 shots each, 1000 base damage per shot; costs 3 AP.',
        'ja': f'{len(units)}基が各2発射撃。1発の基本ダメージ1000、消費3 AP。'
    }.items():
        weapon['localization'][lang]['description']=description
    weapon['sourceHit'] = weapon['hit']
    weapon['nativeTiming'] = dict(source=weapon['source']['file'], entry=key+'_Trigger',
        cooldown=values.get(key+'_CD',0), duration=previous, firstShot=.7,lastShot=previous,
        firingEvents=len(units)*2,projectiles=len(units)*2,declaredEnergy=weapon['en'],energyMode='perVolley',
        energyPerEmission=0,energy=weapon['en'],adaptation='remote_two_shots_per_unit')
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
        key,weapon=compile_launcher(prefab,path,root)
        prefab['weapons'][key]=weapon
        for kit in prefab['weaponKits']:
            if key not in kit['weapons']:kit['weapons'].append(key)
        for mechanic in prefab.get('mechanics',[]):
            if mechanic['id']=='remote_weapon_'+key:
                mechanic.update(status='adapted',name=weapon['name']+'：逐发判定、错峰飞行与回收')
    return prefab

def connect_prototype_technology():
    path=ASSETS.parent/'shared/development-tree.json'
    tree=json.loads(path.read_text(encoding='utf-8'))
    node=next(n for n in tree['ZEON'] if n['id']=='Tech_ZEON_0079_T2_ZeongDevelopmentPlan')
    for ident in ('MS_06Z','MSN_01'):
        if (ASSETS/f'units/{ident}/unit.json').exists() and ident not in node['unlocks']:
            node['unlocks'].append(ident)
    path.write_text(json.dumps(tree,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__ == '__main__':
    connect_prototype_technology()
    for ident in CARRIERS:
        path=ASSETS/f'units/{ident}/unit.json'
        prefab=json.loads(path.read_text(encoding='utf-8'))
        apply(prefab)
        path.write_text(json.dumps(prefab,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        for w in prefab['weapons'].values():
            if w.get('remote'):print(ident,w['remote']['kind'],len(w['remote']['units']))
