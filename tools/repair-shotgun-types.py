"""Repair scatter classification from native damage carriers, without changing payloads."""
import json, re, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from mod_source import ASSETS, MOD, load, section
from weapon_store import loads, dumps
from native_combat import damage_spawn
from native_weapon_names import label, apply as apply_names

def scatter_projectile(prefab, weapon):
    ident=weapon.get('sourceName','')
    if weapon.get('type') not in ('beam','shell') or re.search(r'Bazooka|(?:^|_)BZ(?:_|$)',ident,re.I):return None
    ref=weapon.get('source',{}).get('file')
    if not ref:return None
    source=MOD/prefab['source'].split('/')[0]/ref
    if not source.exists():return None
    data=load(source)
    for barrel in weapon['source'].get('barrels',[]):
        turret='turret_'+barrel['id']
        if turret not in data:continue
        projectile='projectile_'+section(data,turret).get('projectile','')
        if projectile not in data:continue
        carrier=damage_spawn(section(data,projectile).get('spawnUnit',''))
        match=re.match(r'\s*(Projectile_(Beam|Shell)ShotGun\w*)',carrier)
        if match:return match[1]
    return None

def mark(weapon, projectile):
    kind='beam_shotgun' if projectile.startswith('Projectile_BeamShotGun') else 'shell_shotgun'
    weapon.update(nativeProjectile=projectile,weaponClass=kind,category=kind)
    names=label(weapon.get('sourceName',''),weapon)
    weapon['name']=names[0]
    for lang,name in zip(('zh','en','ja'),names):weapon.setdefault('localization',{}).setdefault(lang,{})['name']=name

def main():
    registry=json.loads((ASSETS/'unit-catalog.json').read_text(encoding='utf8'))
    prefabs=[];families={}
    for ref in registry['units']:
        path=ASSETS/ref;raw=path.read_text(encoding='utf8');prefab=loads(raw);selected={}
        for key,weapon in prefab['weapons'].items():
            projectile=scatter_projectile(prefab,weapon)
            if not projectile:continue
            families[weapon.get('sourceName',key)]=projectile
            # Rename generated kit labels from their old weapon label as well.
            previous=weapon['name'];weapon.update(nativeProjectile=projectile,weaponClass='beam_shotgun' if projectile.startswith('Projectile_BeamShotGun') else 'shell_shotgun')
            selected[key]=weapon
        if selected:
            all_weapons=prefab['weapons'];prefab['weapons']=selected;apply_names(prefab);prefab['weapons']=all_weapons
            for weapon in selected.values():mark(weapon,weapon['nativeProjectile'])
            prefabs.append((path,raw,prefab))
    library=ASSETS/'weapons.json';data=json.loads(library.read_text(encoding='utf8'));definitions=[]
    for key,weapon in data['definitions'].items():
        projectile=families.get(weapon.get('sourceName',key))
        if projectile:mark(weapon,projectile);definitions.append(key)
    if '--apply' in sys.argv:
        library.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
        changed=[]
        for path,raw,prefab in prefabs:
            output=dumps(prefab,ensure_ascii=False,indent=2)+'\n'
            if json.loads(output)!=json.loads(raw):path.write_text(output,encoding='utf8');changed.append(prefab['id'])
        print(json.dumps({'families':families,'definitions':definitions,'units':changed},ensure_ascii=True,indent=2))
    else:print(json.dumps({'families':families,'definitions':definitions,'units':[p['id'] for _,_,p in prefabs]},ensure_ascii=True,indent=2))
if __name__=='__main__':main()
