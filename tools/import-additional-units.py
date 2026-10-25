"""Import selected native MOD units without overwriting existing project prefabs by default.

python tools/import-additional-units.py
The MOD is read only. Runtime receives ordinary JSON, PNG and OGG assets.
"""
import argparse
import copy
import json
import math
import re
import shutil
from pathlib import Path
from mod_source import ROOT, MAIN, ASSETS, load, section, resolve, number, stat
from unit_visuals import normalize_visuals
from unit_movement import configure_movement
from unit_introductions import apply_introduction
from unit_parts import apply_parts
from unit_muzzle_effects import apply_muzzle_effects
from unit_skills import import_tackle_assets

def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))

def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

def asset(source, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists() and target.read_bytes() != source.read_bytes():
        raise ValueError("Refusing to replace an existing shared asset: " + str(target))
    if not target.exists():
        shutil.copyfile(source, target)
    return source.name

def localized(zh, en, ja, description=None):
    result = {lang: {"name": value} for lang, value in [("zh", zh), ("en", en), ("ja", ja)]}
    if description:
        for lang, value in zip(("zh", "en", "ja"), description):
            result[lang]["description"] = value
    return result

# IDs are native weapon IDs; the two-handed wrapper still uses ZN_120mmMG.
WEAPONS = {
 "ZN_120mmMG_AntiAir": ("120mm对空机枪","120mm Anti-Air Machine Gun","120mm対空マシンガン","shell",2,4,90,10),
 "ZN_Panzerfaust": ("铁拳火箭弹","Panzerfaust","シュツルム・ファウスト","shell",2,3,80,10),
 "ZN_MS_14_BR": ("格鲁古古光束步枪","Gelgoog Beam Rifle","ゲルググ用ビーム・ライフル","beam",2,5,89,14),
 "ZN_MMP80MG": ("MMP-80机枪","MMP-80 Machine Gun","MMP-80マシンガン","shell",2,4,90,10),
 "ZN_TwinBeamSword_A": ("双刃光束剑","Twin Beam Sword","ビーム・ナギナタ","melee",1,1,95,8),
 "Common_SingleVulcan_RX_79_G": ("胸部火神炮","Chest Vulcan","胸部バルカン砲","shell",1,2,95,5),
 "ZN_120mmMG": ("120mm机枪","120mm Machine Gun","120mmマシンガン","shell",2,4,89,10),
 "ZN_270mmBazooka": ("270mm火箭筒","270mm Bazooka","270mmバズーカ","shell",3,5,72,18),
 "ZN_360mmBazooka": ("360mm火箭筒","360mm Bazooka","360mmバズーカ","shell",3,5,72,20),
 "ZN_HeatHawk_A": ("热能斧","Heat Hawk","ヒート・ホーク","melee",1,1,95,8),
 "ZN_HeatSaber_A": ("热能军刀","Heat Saber","ヒート・サーベル","melee",1,1,95,8),
 "ZN_MS_09_ChestBeam": ("胸部扩散光束炮","Chest Diffusion Beam","胸部拡散ビーム砲","beam",1,1,95,8),
 "EF_100mmMG": ("100mm机枪","100mm Machine Gun","100mmマシンガン","shell",2,4,89,10),
 "EF_GroundTypeBazooka": ("陆战型火箭筒","Ground Type Bazooka","陸戦型バズーカ","shell",3,5,72,18),
 "EF_GroundTypeBeamRifle": ("陆战型光束步枪","Ground Type Beam Rifle","陸戦型ビーム・ライフル","beam",2,5,88,12),
 "EF_180mmCannon": ("180mm加农炮","180mm Cannon","180mmキャノン","shell",3,6,74,20),
 "EF_GroundTypeMissileLauncher": ("陆战型导弹发射器","Ground Type Missile Launcher","陸戦型ミサイル・ランチャー","shell",3,5,82,18),
 "EF_BeamSaber_A": ("光束军刀","Beam Saber","ビーム・サーベル","melee",1,1,95,8),
 "ZN_MagellaCannon": ("马哲拉顶炮","Magella Top Cannon","マゼラ・トップ砲","shell",3,6,74,18),
 "ZN_MS_06J_LegMS": ("腿部导弹发射器","Leg Missile Launchers","脚部ミサイル・ポッド","shell",2,4,82,8),
 "ZN_MS_06K_BigGun": ("双联装大枪","Twin Big Guns","ビッグ・ガン","shell",2,5,82,12),
 "Common_Cannon_AntiAir": ("肩部防空加农炮","Shoulder AA Cannon","肩部対空キャノン","shell",3,6,74,12),
 "Common_Cqb_A": ("格斗","Melee","格闘","melee",1,1,95,6),
}
UNITS = [
 ("MS_06F2","扎古II F2后期型","Zaku II F2 Late Type","ザクII F2後期型",
  ("后期改修型：强化装甲与推进器，性能对标吉姆；实弹主武器、铁拳火箭弹与热能斧，不搭载光束武器。",
   "Late upgrade comparable to the GM, with improved armor and thrusters, ballistic weapons, Panzerfaust and Heat Hawk; no beam weapons.",
   "装甲と推進器を強化したジム相当の後期改修型。実弾主武装、シュツルム・ファウスト、ヒート・ホークを装備。"),
  [("machine_gun","ZN_120mmMG"),("bazooka","ZN_360mmBazooka"),("anti_air","ZN_120mmMG_AntiAir")], ["ZN_Panzerfaust","ZN_HeatHawk_A"]),
 ("MS_06F","扎古II F型","Zaku II F Type","ザクII F型",
  ("泛用型：无独立盾牌，配备120mm机枪或270mm火箭筒及热能斧。",
   "General-purpose unit without a shield; machine gun or bazooka with a Heat Hawk.",
   "独立した盾を持たない汎用機。マシンガンまたはバズーカとヒート・ホークを装備。"),
  [("machine_gun","ZN_120mmMG"),("bazooka","ZN_270mmBazooka")], ["ZN_HeatHawk_A"]),
 ("MS_09R","力克大魔","Rick Dom","リック・ドム",
  ("大魔的宇宙战式样，机动性略有提升。", "Space combat variant of the Dom with improved mobility.", "ドムの宇宙戦仕様。機動性を向上。"),
  [("bazooka","ZN_360mmBazooka"),("machine_gun","ZN_120mmMG")], ["ZN_HeatSaber_A","ZN_MS_09_ChestBeam"]),
 ("MS_09","大魔","Dom","ドム",
  ("重装气垫型：高速移动、实弹防护较强，配备胸部扩散光束炮和热能军刀。",
   "Fast hovering heavy unit with strong ballistic protection, chest beam and Heat Saber.",
   "高速ホバー移動と実弾防御に優れる重装機。胸部ビームとヒート・サーベルを装備。"),
  [("bazooka","ZN_360mmBazooka"),("machine_gun","ZN_120mmMG")], ["ZN_HeatSaber_A","ZN_MS_09_ChestBeam"]),
 ("RGM_79_G","陆战型吉姆","GM Ground Type","陸戦型ジム",
  ("陆战重装型：实弹防护优秀，五种主武器套件；不包含货柜版本。",
   "Armored ground unit with five primary weapon kits; container version excluded.",
   "実弾防御に優れる陸戦機。主武装は5種類。コンテナ装備型は含まれません。"),
  [("machine_gun","EF_100mmMG"),("bazooka","EF_GroundTypeBazooka"),("beam_rifle","EF_GroundTypeBeamRifle"),
   ("cannon","EF_180mmCannon"),("missile_launcher","EF_GroundTypeMissileLauncher")], ["EF_BeamSaber_A"]),
 ("MS_06J","扎古II J型","Zaku II J Type","ザクII J型",
  ("陆战型：机动稍低，三种主武器套件，固定腿部导弹与热能斧。",
   "Ground variant with lower mobility, three primary kits, leg missiles and Heat Hawk.",
   "機動性を抑えた陸戦型。主武装3種類に脚部ミサイルとヒート・ホークを装備。"),
  [("machine_gun","ZN_120mmMG"),("bazooka","ZN_270mmBazooka"),("magella_cannon","ZN_MagellaCannon")], ["ZN_HeatHawk_A","ZN_MS_06J_LegMS"]),
 ("MS_06K","扎古加农","Zaku Cannon","ザク・キャノン",
  ("炮击支援型：机动性低，固定肩部防空加农炮，机枪或双联装大枪套件。",
   "Low-mobility support unit with a fixed shoulder cannon and machine gun or twin Big Guns.",
   "機動性の低い支援機。固定の肩部キャノンにマシンガンまたはビッグ・ガンを装備。"),
  [("machine_gun","ZN_120mmMG"),("big_gun","ZN_MS_06K_BigGun")], ["Common_Cannon_AntiAir","Common_Cqb_A"]),
 ("MS_14A","格鲁古古","Gelgoog","ゲルググ",
  ("高性能泛用型：光束步枪、火箭筒或机枪套件，固定双刃光束剑与盾牌。",
   "High-performance general-purpose unit with a beam rifle, bazooka or machine gun, twin beam sword and shield.",
   "ビーム・ライフル、バズーカ、マシンガンを選択できる高性能汎用機。ビーム・ナギナタと盾を装備。"),
  [("beam_rifle","ZN_MS_14_BR"),("bazooka","ZN_360mmBazooka"),("machine_gun","ZN_MMP80MG")], ["ZN_TwinBeamSword_A"]),
 ("RX_79_G","陆战型高达","Gundam Ground Type","陸戦型ガンダム",
  ("高性能陆战型：重装甲、五种主武器套件，固定光束军刀与胸部火神炮。",
   "High-performance armored ground unit with five primary kits, beam saber and chest vulcan.",
   "重装甲と5種類の主武装を備える高性能陸戦機。ビーム・サーベルと胸部バルカン砲を装備。"),
  [("machine_gun","EF_100mmMG"),("bazooka","EF_GroundTypeBazooka"),("beam_rifle","EF_GroundTypeBeamRifle"),
   ("cannon","EF_180mmCannon"),("missile_launcher","EF_GroundTypeMissileLauncher")], ["EF_BeamSaber_A","Common_SingleVulcan_RX_79_G"]),
]

def animation_clip(hooks, animations):
    for match in re.finditer(r"Play(\w+?)_Step_?1\b", hooks):
        if match[1] in animations:
            return match[1]
    return None

def unit_source(unit_id):
    folder = "MS_09" if unit_id == "MS_09R" else unit_id
    return ROOT / f"Units/BattleUnits/{folder}/{unit_id}.ini"

def visuals(unit_id, data):
    display_code = {"RGM_79_G":"RGM-79[G]", "RX_79_G":"RX-79[G]", "RGM_79_G_WithBackpack":"RGM-79[G][WR]", "RX_79_G_WithBackpack":"RX-79[G][WR]"}.get(unit_id, unit_id.replace("_","-"))
    prefab = dict(schemaVersion=2,id=unit_id,code=display_code,
        source=str(unit_source(unit_id).relative_to(ROOT.parent)).replace("\\","/"),
        materials={"textures":{}},skeleton={},layers=[],animations={})
    for name in data:
        value = section(data,name)
        if re.fullmatch(r"(arm|leg)_\d+", name):
            prefab["skeleton"][name.replace("_","")] = {key:number(v) for key,v in value.items()
                if key in ("x","y","endDirOffset","drawDirOffset")}
        elif name.startswith("decal_") and value.get("image","").startswith("ROOT:") and value.get("basePositionFromLegEnd"):
            if value.get("onlyOnNonPreview") == "true" or any(s in name for s in ("Boost","Stun","LowHp","Hover")):
                continue
            source = resolve(value["image"])
            texture = asset(source,ASSETS/f"units/{unit_id}/textures"/source.name)
            prefab["materials"]["textures"][texture] = "textures/"+texture
            layer = dict(name=name[6:],texture=texture,bone=value["basePositionFromLegEnd"],order=number(value.get("order",0)))
            for key,target in dict(imageScale="scale",imageScaleX="scaleX",imageScaleY="scaleY",dirOffset="rotation",
                pivotOffset="pivot",hOffset="height",total_frames="frames",frame_width="frameWidth",frame_height="frameHeight",frame="frame",alpha="alpha").items():
                if key in value:
                    layer[target] = number(value[key])
            layer["offset"] = {k:number(value.get(src,0)) for k,src in [("x","xOffsetRelative"),("y","yOffsetRelative")]}
            if "Shield" == layer["name"]:
                layer["visibleWhen"] = {"shieldVisible":True}
            if layer["name"] in ("Head","Head_Close"):
                layer["visibleWhen"] = {"visorClosed":layer["name"].endswith("_Close")}
            if layer["name"] == "Eye":
                layer["visibleWhen"] = {"visorClosed":False}
            layer["_visibility"] = value.get("isVisible","")
            prefab["layers"].append(layer)
        elif name.startswith("animation_"):
            curves,scale = {},number(value.get("KeyframeTimeScale",1))
            for key,point in value.items():
                match = re.fullmatch(r"(arm\d+|leg\d+)_([\d.]+)s",key)
                if match:
                    for field,numeric in re.findall(r"(\w+)\s*:\s*(-?[\d.]+)",point):
                        curves.setdefault(match[1],{}).setdefault(field,[]).append([float(match[2])*scale,float(numeric)])
            if curves:
                for fields in curves.values():
                    for points in fields.values():
                        points.sort()
                clip=name[10:]
                filename=unit_id+"__"+clip+".json"
                write(ASSETS/"animations"/filename,{"duration":max(p[-1][0] for f in curves.values() for p in f.values()),"curves":curves})
                prefab["animations"][clip]="../../animations/"+filename
    source=resolve(data["graphics"]["icon_build"])
    icon=asset(source,ASSETS/f"units/{unit_id}/textures"/source.name)
    prefab["materials"]["icon"]=icon
    prefab["materials"]["textures"][icon]="textures/"+icon
    prefab["layers"].sort(key=lambda layer:layer["order"])
    hp=number(data["core"]["maxHp"])/2
    shield_hp=number(data["core"].get("maxShield",0))/2
    boost,turn,reaction = stat(data,"boostMoveSpeed"),stat(data,"baseTurnSpeed"),stat(data,"baseReactionLevel")
    # Native reaction controls evasion; boost speed controls movement independently.
    mobility=reaction
    prefab["stats"]=dict(hp=hp,en=100,move=max(3,min(9,round(5*boost/1.4))),mobility=mobility,cost=300,counterLimit=1)
    prefab["attackBonuses"]=dict(melee=max(0,stat(data,"baseCqbLevel",100)-100),
        shooting=max(0,stat(data,"baseShootLevel",100)-100),beam=0,shell=0)
    channels=dict(beam="Beam",shell="Shell",melee="Cqb",dp="Dp",sp="Sp")
    prefab["defenses"]={key:dict(percent=stat(data,"base"+channel+"Def"),flat=stat(data,"base"+channel+"DefPlus")) for key,channel in channels.items()}
    prefab["shield"]=dict(hp=shield_hp,blockChance=stat(data,"finalShieldBlockPR") if shield_hp else 0,
        coverage=stat(data,"finalShieldSize") if shield_hp else 0,
        defenses={key:dict(percent=stat(data,"shield"+channel+"Def"),flat=stat(data,"shield"+channel+"DefPlus")) for key,channel in channels.items() if key!="sp"})
    prefab["sourceStats"]=dict(hp=number(data["core"]["maxHp"]),walkSpeed=stat(data,"baseMoveSpeed"),boostSpeed=boost,turnSpeed=turn,reaction=reaction,
        shooting=stat(data,"baseShootLevel"),melee=stat(data,"baseCqbLevel"))
    prefab["presentation"]=dict(shield=shield_hp>0,mapScale=1,battleScale=1,idle="Common_Idle",
        move="OnMoving" if unit_id in ("MS_09", "MS_09R") else "OnMovingWalk",stagger="Common_Stagger",dodge="Common_Dodge_L",deathEffect="Explosion_Ground_1")
    return configure_movement(prefab, data)

def mount(prefab, turret, layer_name=None, bone="arm2"):
    x,y=number(turret.get("barrelY",0)),number(turret.get("barrelX",0))
    if not layer_name:
        joint=prefab["skeleton"][bone]
        return dict(bone=bone,offset={"x":y-joint["x"],"y":x-joint["y"]})
    layer=next(layer for layer in prefab["layers"] if layer["name"]==layer_name)
    joint=prefab["skeleton"][layer["bone"]]
    facing=joint.get("endDirOffset",0)+joint.get("drawDirOffset",0)
    phi=math.radians(facing+layer.get("pivot",0))
    tx=joint["y"]+math.cos(phi)*layer["offset"]["y"]-math.sin(phi)*layer["offset"]["x"]
    ty=joint["x"]+math.sin(phi)*layer["offset"]["y"]+math.cos(phi)*layer["offset"]["x"]-layer.get("height",0)
    rotation=math.radians(facing+90+layer.get("rotation",0))
    dx,dy=x-tx,y-ty
    return dict(layer=layer_name,point={"x":(dx*math.cos(rotation)+dy*math.sin(rotation))/(layer.get("scale",1)*layer.get("scaleX",1)),
        "y":(-dx*math.sin(rotation)+dy*math.cos(rotation))/(layer.get("scale",1)*layer.get("scaleY",1))})

def import_effect(projectile, effects):
    name=projectile["hiddenAction_SpawnHitEffect"]["spawnEffects"].split(",")[0].strip()
    if name in effects:
        return name
    value=section(projectile,"effect_"+name)
    source=resolve(value["image"],root=MAIN)
    filename=asset(source,ASSETS/"effects/textures"/source.name)
    sounds=[]
    for sound in value.get("alsoPlaySound","").split(","):
        if sound.strip():
            reference,volume=sound.rsplit(":",1)
            source=resolve(reference,root=MAIN)
            file=asset(source,ASSETS/"sounds"/source.name)
            sounds.append(dict(file="../sounds/"+file,volume=float(volume)))
    effects[name]=dict(texture="textures/"+filename,frames=int(number(value.get("total_frames",1))),
        startFrame=int(number(value.get("animateFrameStart",0))),endFrame=int(number(value.get("animateFrameEnd",0))),
        fps=number(value.get("animateFrameSpeed",1))*60,scaleFrom=number(value.get("scaleFrom",1)),scaleTo=number(value.get("scaleTo",1)),
        alpha=number(value.get("alpha",1)),rotation=number(value.get("dirOffset",0)),
        offset={"x":number(value.get("xOffsetRelative",0)),"y":number(value.get("yOffsetRelative",0))},
        drift=number(value.get("ySpeedRelative",0))*60,sounds=sounds,source="MOD native "+name)
    return name

def import_weapon(prefab, reference, effects):
    data=load(ROOT/reference)
    turret_names=[name for name in data if name.startswith("turret_")]
    key=turret_names[0][7:]
    if key not in WEAPONS:
        raise ValueError("Unknown weapon "+key)
    zh,en,ja,kind,minimum,maximum,hit,energy=WEAPONS[key]
    if key=="EF_BeamSaber_A":
        result=copy.deepcopy(read(ASSETS/"units/RGM_79/unit.json")["weapons"][key])
        for clip in ("Common_Melee_A","Common_Melee_F"):
            prefab["animations"].setdefault(clip,"../../animations/"+clip+".json")
        return key,result
    turret=section(data,turret_names[0])
    spawn=section(data,"projectile_"+turret["projectile"])["spawnUnit"]
    components={channel:float(match[1]) for original,channel in dict(BeamDamage="beam",ShellDamage="shell",CqbDamage="melee",CqbBeamDamage="meleeBeam",CqbShellDamage="meleeShell").items()
        if (match:=re.search(r"\b"+original+r"[:=]([\d.]+)",spawn))}
    raw_components=components.copy()
    # Apply the current bazooka damage reduction; use the current multi-shot cadence below.
    if "Bazooka" in key:
        components={k:v*.8 for k,v in components.items()}
    source_hit=float(re.search(r"\bWeaponAccuracy[:=]([\d.]+)",spawn)[1])
    projectile_count=int(re.search(r"\*(\d+)",spawn)[1])
    if key=="Common_SingleVulcan_RX_79_G":
        initial_clip=None
        steps=[dict(delay=.1,shots=1,repeat=14)]
    else:
        fire=section(data,"hiddenAction_"+key+"_Fire")
        initial_clip=animation_clip(fire.get("alsoTriggerAction",""),prefab["animations"])
        queue=next(value["alsoQueueAction"] for name,value in data.items() if name.startswith("hiddenAction_") and "alsoQueueAction" in value)
        steps=[]
        for name in queue.split(","):
            value=section(data,"hiddenAction_"+name.strip())
            step=dict(delay=number(value.get("buildSpeed",0),data))
            if "fireTurretXAtGround" in value:
                step["shots"]=projectile_count
                step["muzzleIndex"]=turret_names.index("turret_"+value["fireTurretXAtGround"])
            clip=animation_clip(value.get("alsoTriggerAction",""),prefab["animations"])
            if clip:
                step["animation"]=clip
            if steps and {k:v for k,v in steps[-1].items() if k!="repeat"}==step:
                steps[-1]["repeat"]=steps[-1].get("repeat",1)+1
            else:
                steps.append(step)
    clip=initial_clip or next((step["animation"] for step in steps if "animation" in step),None)
    count=2 if "Bazooka" in key or key in ("EF_GroundTypeBeamRifle", "ZN_MS_14_BR") else 3 if "Cannon" in key else None
    if count:
        fire=next(i for i,step in enumerate(steps) if step.get("shots"))
        cycle=copy.deepcopy(steps[:fire+1])
        cycle[0]["animation"]=clip
        steps=[step for _ in range(count) for step in copy.deepcopy(cycle)]+steps[fire+1:]

    if count:
        components={k:v*.7 for k,v in components.items()}
    multiplier=.85 if kind=="melee" else .65 if hit<=74 else .75 if "MG" in key else .8
    sound=resolve(turret["shoot_sound"])
    file=asset(sound,ASSETS/"sounds"/sound.name)
    w=dict(name=zh,localization=localized(zh,en,ja),type=kind,min=minimum,max=maximum,hit=hit,en=energy*1.25,clip=clip,
        slot="primary",sourceName=key,sourceHit=source_hit,hitMultiplier=multiplier,hitBonus=hit-int(math.floor(source_hit*multiplier+.5)),
        damagePerShot=sum(components.values()),damageComponents=components,hitsPerShot=1,
        attack=dict(steps=steps,startAnimation=initial_clip),sound=dict(file="../../sounds/"+file,volume=number(turret.get("shoot_sound_vol",1))),
        source=dict(file=reference,barrelX=number(turret.get("barrelX",0)),barrelY=number(turret.get("barrelY",0)),
            damageComponents=raw_components,projectileCount=projectile_count,
            barrels=[{"id":n[7:],"x":number(section(data,n).get("barrelX",0)),"y":number(section(data,n).get("barrelY",0))} for n in turret_names]),
        hitEffect="Cqb_Hit_1")
    if key=="Common_SingleVulcan_RX_79_G":
        w["clip"]=None
        w["attack"].pop("startAnimation",None)
        for step in w["attack"]["steps"]: step.pop("animation",None)
    if key == "ZN_TwinBeamSword_A":
        w["damagePerShot"] = 10000
        w["damageComponents"] = {"melee": 5000, "meleeBeam": 5000}
    if kind=="melee":
        if key!="Common_Cqb_A":
            color="Pink" if key.startswith("EF_") else "Yellow"
            w["swingEffects"]=[f"Cqb_Fire_1_{color}_R",f"Cqb_Fire_1_{color}_L"]
        return key,w
    projectile_id=spawn.split("*")[0].strip()
    category="Beam" if kind=="beam" else "Shell"
    projectile=load(MAIN/f"Units/BattleUnits/Weapon/{category}/Projectile/{projectile_id}.ini",MAIN)
    decal=section(projectile,"decal_Projectile_Image")
    image=resolve(decal["image"],root=MAIN)
    texture=asset(image,ASSETS/"projectiles"/image.name)
    speed=float(re.search(r"\bProjectileSpeed[:=]([\d.]+)",spawn)[1])
    if "Bazooka" in key or "Cannon" in key:
        speed*=.5
    w["projectile"]=dict(texture="../../projectiles/"+texture,scale=number(decal.get("imageScale",1)),speed=speed,
        forwardOffset=number(decal.get("yOffsetRelative",0)),rotation=number(decal.get("dirOffset",0)))
    w["hitEffect"]=import_effect(projectile,effects)
    mounts=[]
    for index,name in enumerate(turret_names):
        layer_name=key
        if key=="ZN_MS_06K_BigGun":
            layer_name=key+("_L" if index else "_R")
        if key=="Common_Cannon_AntiAir":
            layer_name="MS_06K_Cannon"
        if key in ("ZN_MS_09_ChestBeam","ZN_MS_06J_LegMS","Common_SingleVulcan_RX_79_G"):
            layer_name=None
        mounts.append(mount(prefab,section(data,name),layer_name,bone="arm1" if key=="ZN_MS_06J_LegMS" else "arm2"))
    w["muzzle"]=mounts[0] if len(mounts)==1 else dict(mounts=mounts)
    return key,w

def build(unit, effects):
    unit_id,zh,en,ja,descriptions,kits,secondary=unit
    data=load(unit_source(unit_id))
    prefab=visuals(unit_id,data)
    prefab.update(name=zh,description=descriptions[0],localization=localized(zh,en,ja,descriptions))
    prefab["weapons"]={}
    wanted={weapon for _,weapon in kits}|set(secondary)
    own=load(unit_source(unit_id))
    references=read_source_weapons(unit_id)
    for reference in references:
        key=next((name[7:] for name in load(ROOT/reference) if name.startswith("turret_")),None)
        if key in wanted:
            key,value=import_weapon(prefab,reference,effects);prefab["weapons"][key]=value
    if set(prefab["weapons"])!=wanted:
        raise ValueError("Missing weapons: "+str(wanted-set(prefab["weapons"])))
    fixed={"Common_SingleVulcan_RX_79_G","ZN_MS_09_ChestBeam","ZN_MS_06J_LegMS","Common_Cannon_AntiAir"}
    for key,value in prefab["weapons"].items():
        if key in secondary:
            value["slot"]="fixed" if key in fixed else "secondary"
        if key in fixed:
            value["changeHeldWeapon"]=False
    prefab["weaponKits"]=[]
    for kit_id,key in kits:
        names=WEAPONS[key]
        prefab["weaponKits"].append(dict(id=kit_id,name=names[0]+"套件",cost=0,weapons=[key,*secondary],
            localization=localized(names[0]+"套件",names[1]+" Kit",names[2]+"装備")))
    # Translate only understood visibility conditions into ordinary named data.
    for layer in list(prefab["layers"]):
        condition=layer.pop("_visibility", "")
        equipment=re.search(r"EquipmentIndex\s*==\s*(\d+)",condition)
        if equipment:
            original_index=int(equipment[1])
            # Native equipment index mapping differs from kit presentation order.
            native = (["ZN_360mmBazooka","ZN_120mmMG"] if unit_id in ("MS_09", "MS_09R") else
                ["EF_100mmMG","EF_GroundTypeBazooka","EF_GroundTypeBeamRifle","EF_180mmCannon","EF_GroundTypeMissileLauncher"] if unit_id in ("RGM_79_G","RX_79_G") else
                ["ZN_MS_14_BR","ZN_360mmBazooka","ZN_MMP80MG"] if unit_id=="MS_14A" else
                ["ZN_120mmMG","ZN_270mmBazooka","ZN_MagellaCannon"] if unit_id=="MS_06J" else
                ["ZN_120mmMG","ZN_360mmBazooka","ZN_120mmMG_AntiAir"] if unit_id=="MS_06F2" else
                ["ZN_120mmMG","ZN_MS_06K_BigGun"] if unit_id=="MS_06K" else
                ["ZN_120mmMG","ZN_270mmBazooka"])
            if original_index>=len(native):
                prefab["layers"].remove(layer)
                continue
            key=native[original_index]
            kit=next(kit_id for kit_id,weapon_id in kits if weapon_id==key)
            layer["visibleWhen"]=dict(kit=kit,heldWeapon={"not":key} if "nowWeaponIndex!=" in condition else key)
        elif "Panzerfaust" in layer["name"]:
            layer["visibleWhen"]=dict(heldWeapon={"not":"ZN_Panzerfaust"} if "NotUsing" in layer["name"] else "ZN_Panzerfaust")
            if layer["name"].endswith("Used") or layer["name"].endswith("Step2"):
                prefab["layers"].remove(layer)
        elif layer["name"] in ("ZN_HeatHawk_A", "ZN_HeatHawk_A_Step2"):
            # 同一斧头的两种握持方向，挥下时切换，收招后恢复；不能同时显影。
            layer["visibleWhen"] = dict(heldWeapon="ZN_HeatHawk_A")
            layer["animationVisibility"] = dict(clip="Common_Melee_A", start=0.6, end=2,
                visibleInside=layer["name"].endswith("_Step2"))
        elif "nowWeaponIndex==11" in condition:
            prefab["layers"].remove(layer)
        elif "nowWeaponIndex==1" in condition:
            melee=next(key for key in secondary if prefab["weapons"][key]["type"]=="melee")
            layer["visibleWhen"]=dict(heldWeapon=melee)
        elif layer["name"].endswith("BeamSaberL") or layer["name"].endswith("HeatSaber"):
            melee=next(key for key in secondary if prefab["weapons"][key]["type"]=="melee")
            layer["visibleWhen"]=dict(heldWeapon={"not":melee})
    # Reject unhandled source expressions instead of embedding them in runtime JSON.
    if re.search(r"memory\.|self\.resource|\$\{",json.dumps(prefab)):
        raise ValueError("Untranslated MOD expression: "+unit_id)
    if unit_id == "RX_79_G":
        prefab["stats"]["cost"] = 750
    if unit_id == "MS_14A":
        prefab["stats"]["hp"] = 24000
        prefab["stats"]["cost"] = 750
    if unit_id == "MS_06F2":
        prefab["code"] = "MS-06F2"
        prefab["stats"].update(hp=18000, move=5, cost=350)
        prefab["attackBonuses"].update(melee=5, shooting=15)
        # Keep native weapons, timing and mounts, with damage in the GM tier.
        for key, value in prefab["weapons"].items():
            if "MG" in key:
                value["damagePerShot"] = 725
                value["damageComponents"] = {"shell": 725}
            elif key == "ZN_HeatHawk_A":
                value["damagePerShot"] = 4200
                value["damageComponents"] = {"meleeShell": 4200}
            elif key == "ZN_Panzerfaust":
                value["damagePerShot"] = 6562.5
                value["damageComponents"] = {"shell": 6562.5}
    if "Common_Cannon_AntiAir" in prefab["weapons"]:
        cannon = prefab["weapons"]["Common_Cannon_AntiAir"]
        cannon.update(damagePerShot=3600, damageComponents={"shell": 3600})
    for key, weapon in prefab["weapons"].items():
        if (unit_id, key) in (("MS_14A", "ZN_MMP80MG"), ("RX_79_G", "EF_100mmMG")):
            weapon["damageComponents"] = {channel: round(value * 1.1, 8) for channel, value in weapon["damageComponents"].items()}
            weapon["damagePerShot"] = sum(weapon["damageComponents"].values())
        weapon["hit"] = int(math.floor(weapon["hit"] / 5 + .5) * 5)
        weapon["hitBonus"] = weapon["hit"] - int(math.floor(weapon["sourceHit"] * weapon["hitMultiplier"] + .5))
    if unit_id in ("MS_14A", "RX_79_G"):
        mg = prefab["weapons"]["ZN_MMP80MG" if unit_id == "MS_14A" else "EF_100mmMG"]
        mg["attack"]["steps"][2]["repeat"] = 11
        beam = prefab["weapons"]["ZN_MS_14_BR" if unit_id == "MS_14A" else "EF_GroundTypeBeamRifle"]
        beam["damageComponents"] = {k: round(v * 1.1, 8) for k, v in beam["damageComponents"].items()}
        beam["damagePerShot"] = sum(beam["damageComponents"].values())
    kit_costs = read(ASSETS / "weapon-kit-costs.json")
    for kit in prefab["weaponKits"]:
        kit["cost"] = kit_costs[kit["id"]]
    apply_introduction(prefab, data)
    prefab = normalize_visuals(prefab, ASSETS / "units" / unit_id)
    if unit_id in ("MS_09", "MS_09R"):
        def correct(value):
            if isinstance(value, dict):
                return {key.replace("360mm", "380mm"): (item if key == "source" else correct(item)) for key, item in value.items()}
            if isinstance(value, list):
                return [correct(item) for item in value]
            return value.replace("360mm", "380mm") if isinstance(value, str) else value
        original = ASSETS / f"units/{unit_id}/textures/ZN_360mmBazooka.png"
        corrected = original.with_name("ZN_380mmBazooka.png")
        asset(original, corrected)
        original.unlink()
        prefab = correct(prefab)
    if unit_id == "MS_06F2":
        # Keep native weapon/asset IDs; correct the displayed calibre in every language.
        for entry in [prefab["weapons"]["ZN_360mmBazooka"], *prefab["weaponKits"]]:
            entry["name"] = entry["name"].replace("360mm", "380mm")
            for translation in entry.get("localization", {}).values():
                translation["name"] = translation["name"].replace("360mm", "380mm")
    if unit_id == "MS_09R":
        # Use the balanced Dom platform, retaining Rick Dom's native visuals and mounts.
        dom = read(ASSETS / "units/MS_09/unit.json")
        for key in ("stats", "attackBonuses", "defenses", "shield", "weaponKits"):
            prefab[key] = copy.deepcopy(dom[key])
        prefab["stats"].update(adaptability={"ground": 50, "space": 100},
                               partStructuralStrength=stat(data, "partStructuralStrength"))
        for key, baseline in dom["weapons"].items():
            native = prefab["weapons"].get(key)
            if native:
                prefab["weapons"][key] = copy.deepcopy(baseline)
                if "muzzle" in native:
                    prefab["weapons"][key]["muzzle"] = native["muzzle"]
    apply_muzzle_effects(prefab, data, effects)
    return apply_parts(prefab, data)

def read_source_weapons(unit_id):
    from mod_source import parse
    own=parse(unit_source(unit_id))
    return re.findall(r"ROOT:(Units/BattleUnits/Weapon/[^,\s]+)",own["core"]["copyFrom"])

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--overwrite",action="store_true",help="Replace only selected generated prefabs; never the original GM trio.")
    parser.add_argument("--units", nargs="+", choices=[unit[0] for unit in UNITS], help="Import only the named units; existing units are preserved.")
    options=parser.parse_args()
    selected=[unit for unit in UNITS if not options.units or unit[0] in options.units]
    for unit in selected:
        file=ASSETS/f"units/{unit[0]}/unit.json"
        if file.exists() and not options.overwrite:
            raise ValueError("Already exists, use --overwrite only if intentional: "+str(file))
    effects=read(ASSETS/"effects/effects.json")
    prefabs=[build(unit,effects) for unit in selected]
    for prefab in prefabs:
        write(ASSETS/f"units/{prefab['id']}/unit.json",prefab)
        print(prefab["id"],len(prefab["layers"]),"layers",len(prefab["weaponKits"]),"kits",prefab["stats"])
    catalog=read(ASSETS/"unit-catalog.json")
    for prefab in prefabs:
        reference=f"units/{prefab['id']}/unit.json"
        if reference not in catalog["units"]:
            catalog["units"].append(reference)
    write(ASSETS/"effects/effects.json",effects)
    import_tackle_assets()
    write(ASSETS/"unit-catalog.json",catalog)
if __name__=="__main__":
    main()
