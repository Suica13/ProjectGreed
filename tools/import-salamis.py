"""Import the original Salamis hull and sixteen independent weapon modules.
Runtime uses ordinary JSON; no RW expressions are evaluated by the game.
"""
import json, re, shutil
from mod_source import ROOT, MAIN, ASSETS, load, section, resolve, stat, number
from unit_introductions import apply_introduction
from unit_muzzle_effects import apply_muzzle_effects

BASE=ROOT/"Units/BattleUnits/SalamisClass"
ID="SalamisClass"

def read(path): return json.loads(path.read_text(encoding="utf-8-sig"))
def write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
def copy(source,folder):
    target=ASSETS/folder/source.name;target.parent.mkdir(parents=True,exist_ok=True)
    if target.exists() and target.read_bytes()!=source.read_bytes():raise ValueError("Conflicting asset: "+str(target))
    shutil.copyfile(source,target);return source.name

def main():
    data=load(BASE/(ID+".ini"))
    prefab=dict(schemaVersion=2,id=ID,code="Salamis",name="萨拉米斯级",source=str((BASE/(ID+".ini")).relative_to(ROOT.parent)).replace("\\","/"),
        faction="EFSF",tags=["EFSF","0079"],localization={"zh":{"name":"萨拉米斯级"},"en":{"name":"Salamis Class"},"ja":{"name":"サラミス級"}},
        materials={"textures":{}},skeleton={"Body":{"x":0,"y":0}},layers=[],animations={},weapons={},
        stats=dict(hp=60000,en=100,move=4,mobility=50,accuracy=105,cost=1250,counterLimit=1,partStructuralStrength=100,
                   adaptability={"ground":0,"space":100},autoRepair={"hpPercent":10,"enCost":10},ship=True,footprint={"width":3,"height":6},modules=[]),
        attackBonuses={"melee":0,"shooting":5,"beam":0,"shell":0},
        defenses={key:{"percent":stat(data,"base"+channel+"Def"),"flat":stat(data,"base"+channel+"DefPlus")} for key,channel in {"beam":"Beam","shell":"Shell","melee":"Cqb","dp":"Dp","sp":"Sp"}.items()},
        shield={"hp":0,"blockChance":0,"coverage":0,"requiredParts":[],"defenses":{k:{"percent":0,"flat":0} for k in ["beam","shell","melee","dp"]}},
        sourceStats=dict(hp=60000,en=4500,reaction=50,accuracy=105,partStructuralStrength=100,turnSpeed=.45,boostSpeed=1.15),
        presentation=dict(shield=False,mapScale=1,battleScale=.9,idle="ShipIdle",move="ShipIdle",walk="ShipIdle",movement="boost",stagger="ShipIdle",dodge="ShipIdle",deathEffect="Explosion_Ground_1"))
    prefab["stats"]["hullHitboxes"]=[{"id":name.removeprefix("attachment_"),"x":number(section(data,name)["x"]),"y":number(section(data,name)["y"])} for name in data if name.startswith("attachment_DamageCheckerCore")]
    def texture(source):
        name=copy(source,f"units/{ID}/textures");prefab["materials"]["textures"][name]="textures/"+name;return name
    prefab["materials"]["icon"]=texture(resolve(data["graphics"]["icon_build"]))
    body=section(data,"decal_Body")
    prefab["layers"].append(dict(name="Hull",bone="Body",texture=texture(resolve(body["image"])),order=2,scale=number(body.get("imageScale",1))))
    write(ASSETS/"animations/ShipIdle.json",{"duration":1,"curves":{}})
    prefab["animations"]["ShipIdle"]="../../animations/ShipIdle.json"
    boost=section(data,"decal_Boost")
    prefab["layers"].append(dict(name="BoostLoop",bone="Body",texture=texture(resolve(boost["image"])),order=0,
        frames=int(number(boost["total_frames"])),frameFps=12,scale=number(boost["imageScale"]),scaleX=number(boost["imageScaleX"]),
        offset={"x":number(boost["xOffsetRelative"]),"y":number(boost["yOffsetRelative"])},alpha=number(boost["alpha"]),visibleWhen={"moving":True}))
    groups={}
    labels={"BeamCannon":("舰载光束炮","Beam Cannon","艦載ビーム砲"),"MS":("舰载导弹","Missiles","ミサイル"),"AMS":("舰首鱼雷","Torpedoes","艦首魚雷"),"AA":("对空炮","Anti-Air Guns","対空砲"),"MG":("舰载机炮","Machine Guns","機関砲")}
    effects=read(ASSETS/"effects/effects.json")
    for name in data:
        if not name.startswith("attachment_"+ID+"_Turret_"):continue
        attachment=section(data,name);module_id=name[len("attachment_"):]
        spawn=section(data,"hiddenAction_"+name)["attachments_addNewUnits"]
        native=load(BASE/(spawn+".ini"));turret_name=next(n for n in native if n.startswith("turret_SalamisClass_Turret_"));turret=section(native,turret_name)
        kind=turret_name.split("_Turret_")[1];label=labels[kind]
        bone=module_id.removeprefix(ID+"_Turret_")
        prefab["skeleton"][bone]={"x":number(attachment["x"]),"y":number(attachment["y"]),"endDirOffset":number(attachment.get("idleDir",0))}
        module=dict(id=module_id,name=label[0]+" "+bone,hp=number(native["core"]["maxHp"]),bone=bone,
                    x=number(attachment["x"]),y=number(attachment["y"]),idleDir=number(attachment.get("idleDir",0)),arc=number(turret.get("limitingAngle",360)),damageToHull=1)
        prefab["stats"]["modules"].append(module)
        layer_name=turret_name.removeprefix("turret_")
        decal_name="decal_"+layer_name
        layer=dict(name=module_id,bone=bone,order=3 if not attachment.get("setDrawLayerOnBottom")=="true" else 1,offset={"x":0,"y":0},moduleId=module_id)
        if decal_name in native:
            decal=section(native,decal_name);layer.update(texture=texture(resolve(decal["image"])),scale=number(decal.get("imageScale",1)),rotation=number(decal.get("dirOffset",0)),scaleX=number(decal.get("imageScaleX",1)))
            prefab["layers"].append(layer)
        projectile=section(native,"projectile_"+turret["projectile"]);spawn_text=projectile["spawnUnit"]
        def value(key,default=0):
            match=re.search(r"\b"+key+r"[:=]([\d.]+)",spawn_text);return float(match[1]) if match else default
        key=layer_name
        group=groups.setdefault(kind,dict(native=native,weaponKey=key,turret=turret,spawn=spawn_text,modules=[],mounts=[],steps=[]))
        mount_index=len(group["modules"]);group["modules"].append(module_id)
        # Mounts live on the module bone, independently of hull rotation and damage.
        group["mounts"].append(dict(bone=bone,offset={"x":number(turret.get("barrelX",0)),"y":number(turret.get("barrelY",0))},alternatingOffsetX=number(turret.get("barrelOffsetX_onOddShots",0))))
        # Preserve the native salvo count and firing interval of each module.
        own_text=(BASE/("SalamisClass_Turret_"+kind+".ini")).read_text(encoding="utf-8-sig")
        match=re.search(r"@global\s+\w+_Shoot\s*=\s*(\d+)",own_text)
        count=int(match[1]) if match else 1
        interval=number(turret.get("delay",.2))
        for i in range(count):group["steps"].append({"at":round(.25+i*interval,6),"shots":1,"muzzleIndex":mount_index,"moduleId":module_id})
    for kind,group in groups.items():
        native,turret=group["native"],group["turret"];spawn_text=group["spawn"]
        def value(key,default=0):
            m=re.search(r"\b"+key+r"[:=]([\d.]+)",spawn_text);return float(m[1]) if m else default
        key=group["weaponKey"];beam=kind=="BeamCannon";category="Beam" if beam else "Shell"
        components={"beam" if beam else "shell":value("BeamDamage" if beam else "ShellDamage")}
        steps=[];at=0
        for shot in sorted(group["steps"],key=lambda s:(s["at"],s["muzzleIndex"])):
            steps.append({"delay":round(shot["at"]-at,6),**{k:v for k,v in shot.items() if k!="at"}});at=shot["at"]
        steps.append({"delay":.4})
        projectile_id=spawn_text.split("*")[0].strip();projectile=load(MAIN/f"Units/BattleUnits/Weapon/{category}/Projectile/{projectile_id}.ini",MAIN)
        decal=section(projectile,"decal_Projectile_Image");image=resolve(decal["image"],root=MAIN);filename=copy(image,"projectiles")
        hit_id=projectile["hiddenAction_SpawnHitEffect"]["spawnEffects"].split(",")[0].strip()
        if hit_id not in effects:
            import importlib.util
            spec=importlib.util.spec_from_file_location("additional",__file__.replace("import-salamis.py","import-additional-units.py"));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod);mod.import_effect(projectile,effects)
        sound=copy(resolve(turret["shoot_sound"]),"sounds")
        energy={"BeamCannon":25,"MS":20,"AMS":20,"AA":12.5,"MG":12.5}[kind]
        hit={"BeamCannon":75,"MS":100,"AMS":85,"AA":100,"MG":100}[kind]
        prefab["weapons"][key]=dict(name=labels[kind][0],localization={lang:{"name":text} for lang,text in zip(["zh","en","ja"],labels[kind])},type="beam" if beam else "shell",slot="primary" if beam else "fixed",
            min=2 if kind in ["BeamCannon","AMS"] else 1,max={"BeamCannon":8,"MS":6,"AMS":8,"AA":4,"MG":3}[kind],hit=hit,en=energy,clip=None,changeHeldWeapon=False,
            sourceName=key,sourceHit=value("WeaponAccuracy"),hitMultiplier=1,hitBonus=hit-value("WeaponAccuracy"),damagePerShot=sum(components.values()),damageComponents=components,hitsPerShot=1,
            requiredParts=[],partBreakModifier=value("PartBreakModifier",1),attack={"steps":steps,"startAnimation":None},
            muzzle={"mounts":group["mounts"]},moduleIds=group["modules"],
            projectile={"texture":"../../projectiles/"+filename,"scale":number(decal.get("imageScale",1)),"speed":value("ProjectileSpeed")*(.5 if kind in ["MS","AMS"] else 1),"forwardOffset":0,"rotation":number(decal.get("dirOffset",0))},
            hitEffect=hit_id,sound={"file":"../../sounds/"+sound,"volume":number(turret.get("shoot_sound_vol",1))},
            antiSize={"small":{"damage":value("AntiSizeSmallDamage",1),"accuracy":value("AntiSizeSmallAccuracy",1)},"large":{"damage":value("AntiSizeLargeDamage",1),"accuracy":value("AntiSizeLargeAccuracy",1)}},
            source={"file":str((BASE/("SalamisClass_Turret_"+kind+".ini")).relative_to(ROOT)).replace("\\","/"),"barrels":[{"id":key} for _ in group["modules"]]})
        # Effect IDs resolve from the turret's own native INI, once per physical module.
        wrapper={**native};apply_muzzle_effects({"id":ID,"weapons":{key:prefab["weapons"][key]}},wrapper,effects)
    prefab["layers"].sort(key=lambda layer:layer["order"])
    prefab["weaponKits"]=[dict(id="standard",name="标准舰装",cost=0,weapons=list(prefab["weapons"]),localization={"zh":{"name":"标准舰装"},"en":{"name":"Standard Armament"},"ja":{"name":"標準艦装"}})]
    apply_introduction(prefab,data)
    write(ASSETS/f"units/{ID}/unit.json",prefab);write(ASSETS/"effects/effects.json",effects)
    catalog=read(ASSETS/"unit-catalog.json");ref=f"units/{ID}/unit.json"
    if ref not in catalog["units"]:catalog["units"].append(ref)
    write(ASSETS/"unit-catalog.json",catalog)
    print("Imported Salamis: 16 independent modules, 5 weapon groups, 3x6 footprint.")

if __name__=="__main__":main()
