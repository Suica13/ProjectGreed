"""GP03 container launchers and GP02 nuclear weapon adaptation, from read-only MOD."""
import json
import shutil
from mod_source import ROOT, MAIN, ASSETS, load, section, resolve
from native_combat import payload


def copy_art(source):
    target = ASSETS / 'projectiles' / source.name
    if not target.exists() or target.read_bytes() != source.read_bytes():
        shutil.copyfile(source, target)
    return '../../projectiles/' + source.name


def container_weapon(kind):
    key = 'EF_GP_03D_MSL_' + kind
    wrapper = ROOT / ('Units/BattleUnits/Weapon/Shell/' + key + '.gw')
    native_path = ROOT / ('Units/BattleUnits/Weapon/Shell/Unit/' + key + '.ini')
    data, native = load(wrapper), load(native_path)
    queue = native['hiddenAction_Shoot']['alsoQueueAction'].replace(',', ' ').split()
    missiles_per_container = sum(1 + len(native['hiddenAction_' + action].get('alsoTriggerAction', '').split(',')) for action in queue)
    nuclear = kind == 'ASP'
    count = 3 if nuclear else missiles_per_container * 2
    body = [copy_art(resolve(native['decal_Body_' + str(i)]['image'], root=ROOT)) for i in (0,1)]
    projectile_path = next((MAIN / 'Units/BattleUnits/Weapon').rglob('Projectile_MS.ini'))
    missile = section(load(projectile_path), 'decal_Projectile_Image')
    texture = '../../projectiles/Missile_Nuke_1.png' if nuclear else copy_art(resolve(missile['image'], root=MAIN))
    # Base payload enters the existing global conversion once: 900->450 and
    # 20000->10000. Native damage remains available separately for audit.
    damage = 20000 if nuclear else 900
    hit = 70 if nuclear else 85
    name = '\u6838\u5f39\u5934\u5bfc\u5f39\u8d27\u67dc' if nuclear else '\u5bfc\u5f39\u8d27\u67dc'
    localized = ('Nuclear Missile Container', '\u6838\u30df\u30b5\u30a4\u30eb\u30b3\u30f3\u30c6\u30ca') if nuclear else ('Missile Container', '\u30df\u30b5\u30a4\u30eb\u30b3\u30f3\u30c6\u30ca')
    steps = []
    for index in range(count):
        at = 0.95 + (index * 0.4 if nuclear else (index // 4) * 0.15)
        previous = 0.95 + ((index - 1) * 0.4 if nuclear else ((index - 1) // 4) * 0.15) if index else 0
        steps.append(dict(delay=round(at-previous,6), shots=1, muzzleIndex=0 if nuclear else index % 2))
    barrels = [dict(id=key, x=35 if kind=='AMS' else 40, y=25)]
    if not nuclear: barrels.append(dict(id=key+'_L', x=-35, y=25))
    weapon = dict(name=name, type='shell', category='nuke' if nuclear else 'missile',
        sourceName=key, level=1, levelSource=wrapper.relative_to(ROOT).as_posix(), source=dict(file=wrapper.relative_to(ROOT).as_posix(), barrels=barrels),
        slot='skill' if nuclear else 'primary', clip=None, min=3 if nuclear else 1, max=15,
        hit=hit, sourceHit=hit, baseHitOverride=hit, actionCost=5 if nuclear else 3, en=250, attackRounds=1, maxUsesPerTurn=1,
        damagePerShot=damage, damageComponents=dict(shell=damage), hitsPerShot=1, partBreakModifier=1,
        attack=dict(steps=steps, startAnimation=None), requiredParts=[], changeHeldWeapon=False,
        muzzle=dict(mounts=[dict(bone='Body',offset=dict(x=b['x'],y=b['y'])) for b in barrels]),
        projectile=dict(texture=texture,scale=0.25 if nuclear else float(missile.get('imageScale',0.35)),
            speed=25, nativeSpeed=25, forwardOffset=-5, rotation=0,
            container=dict(count=1 if nuclear else 2, closedTexture=body[0], openTexture=body[1],
                scale=1,deploySeconds=0.8,curve=0.65,
                thrustTexture=copy_art(resolve(native['decal_Boost']['image'],root=ROOT)),
                thrustFrames=int(native['decal_Boost']['total_frames']))),
        hitEffect='Nuke_Hit_1' if nuclear else 'Explosion_Hit_1',
        sound=dict(file='../../sounds/Missile_1.ogg',volume=0.3),
        nativePayload=payload(native['projectile_MSL_Projectile']['spawnUnit']),
        nativeTiming=dict(source=wrapper.relative_to(ROOT).as_posix(), containerSource=native_path.relative_to(ROOT).as_posix(),
            containers=2, missilesPerContainer=missiles_per_container, projectiles=missiles_per_container*2, energy=250,
            cooldown=90, firstShot=1.15, lastShot=round(1+len(queue)*0.15+(0.05 if nuclear else 0),6), duration=10),
        tacticalPattern=dict(type='container_salvo', projectiles=count, firstShot=0.95,lastShot=at,duration=at+0.3),
        localization={lang:dict(name=value) for lang,value in [('zh',name),('en',localized[0]),('ja',localized[1])]})
    if nuclear:
        weapon.update(noCounter=True, cooldownTurns=3, special=dict(type='nuke',radius=1,shape='square',emptyCells=True,perProjectileBlast=True,affectsAir=True))
        weapon['description']='\u6bcf3\u4e2a\u5df1\u65b9\u56de\u5408\u4e00\u6b21\uff1b\u8d27\u67dc\u5411\u76ee\u6807\u540e\u65b9\u63a8\u8fdb\u540e\u53d1\u5c04\u4e09\u53d1\u6838\u5f39\uff0c\u653b\u51fb3\u00d73\u533a\u57df\uff0c\u6bcf\u53d1\u57fa\u7840\u4f24\u5bb310000\u3001\u547d\u4e2d60%\u3002'
    else:
        weapon['description']='\u6bcf\u56de\u5408\u4e00\u6b21\uff1b\u53cc\u8d27\u67dc\u63a8\u8fdb\u5230\u76ee\u6807\u540e\u65b9\u540e\u5f00\u8231\uff0c\u5171\u53d1\u5c04'+str(count)+'\u53d1\u5bfc\u5f39\uff0c\u6bcf\u53d1\u57fa\u7840\u4f24\u5bb3450\u3001\u547d\u4e2d75%\uff0c\u968f\u673a\u653b\u51fb\u76ee\u6807\u683c\u4e2d\u7684\u654c\u519b\u3002'
    weapon['localization']['en']['description'] = (
        'Once every 3 own turns. Deploys a container behind the target and launches three staggered nuclear missiles at a 3x3 area; base damage 10000 and base accuracy 60% per missile.' if nuclear else
        'Once per turn. Two containers deploy behind the target and launch 144 curved missiles. Each selects a living enemy in the target cell; base damage 450 and base accuracy 75%.')
    weapon['localization']['ja']['description'] = (
        '3\u81ea\u8ecd\u30bf\u30fc\u30f3\u306b1\u56de\u3002\u76ee\u6a19\u306e\u5f8c\u65b9\u306b\u30b3\u30f3\u30c6\u30ca\u3092\u5c55\u958b\u3057\u3001\u6838\u30df\u30b5\u30a4\u30eb3\u767a\u30673x3\u30de\u30b9\u3092\u653b\u6483\u3002\u5404\u767a\u306e\u57fa\u790e\u30c0\u30e1\u30fc\u30b810000\u3001\u57fa\u790e\u547d\u4e2d\u738760%\u3002' if nuclear else
        '\u6bce\u30bf\u30fc\u30f31\u56de\u3002\u76ee\u6a19\u306e\u5f8c\u65b9\u306b2\u57fa\u3092\u5c55\u958b\u3057144\u767a\u306e\u8a98\u5c0e\u5f3e\u3092\u767a\u5c04\u3002\u5404\u767a\u306f\u76ee\u6a19\u30de\u30b9\u306e\u6575\u3092\u30e9\u30f3\u30c0\u30e0\u306b\u9078\u629e\u3002\u57fa\u790e\u30c0\u30e1\u30fc\u30b8450\u3001\u57fa\u790e\u547d\u4e2d\u738775%\u3002')
    return key, weapon


def apply(prefab):
    if prefab['id'] == 'RX_78GP03D':
        for kind in ('AMS','ASP'):
            key, weapon = container_weapon(kind)
            prefab['weapons'][key] = weapon
            for kit in prefab['weaponKits']:
                if key not in kit['weapons']: kit['weapons'].append(key)
    if prefab['id'] == 'RX_78GP02A':
        key = 'EF_RX_78GP02A_Bombing_Nuke'
        weapon = prefab['weapons'].get(key)
        if weapon:
            from weapon_policy import configure_nuke
            configure_nuke(weapon)
            weapon['category'] = 'nuke'
            weapon.update(min=3, max=8)
            weapon['description']='\u6838\u5f39\u8f70\u70b8\uff1a\u6307\u5b9a\u76ee\u6807\u683c\uff0c\u653b\u51fb\u534a\u5f843\u683c\u7684\u5706\u5f62\u533a\u57df\uff0c\u6bcf\u6761\u547d\u9650\u75281\u6b21\uff0c\u4e0d\u80fd\u53cd\u51fb\u3002'
            weapon['localization']['en']['description']='Nuclear bombardment: targets a circular area with a radius of 3 cells. One use per life; cannot counterattack.'
            weapon['localization']['ja']['description']='\u6838\u7206\u6483\uff1a\u6307\u5b9a\u30de\u30b9\u3092\u4e2d\u5fc3\u306b\u534a\u5f843\u30de\u30b9\u3092\u653b\u6483\u30021\u56de\u306e\u51fa\u6483\u306b\u3064\u304d1\u56de\u3002\u53cd\u6483\u4e0d\u53ef\u3002'
            if weapon.get('availability',{}).get('reasons') == ['energy_capacity_review']:
                weapon.pop('availability',None)
            for kit in prefab['weaponKits']:
                if key not in kit['weapons']: kit['weapons'].append(key)
            prefab['mechanics'] = [m for m in prefab.get('mechanics',[]) if m['id'] != 'energy_capacity_'+key]
    return prefab


def refresh():
    from weapon_store import loads, dumps
    report=[]
    for unit in ('RX_78GP03D','RX_78GP02A'):
        path = ASSETS/'units'/unit/'unit.json'
        prefab = apply(loads(path.read_text(encoding='utf-8')))
        path.write_text(dumps(prefab,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        for key,w in prefab['weapons'].items():
            if w.get('projectile',{}).get('container') or key.endswith('Bombing_Nuke'):
                report.append(dict(unit=unit,weapon=key,source=w['source'],nativeTiming=w.get('nativeTiming')))
    (ASSETS.parent/'docs/imports/gp-containers.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__ == '__main__':
    refresh()
