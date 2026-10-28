"""Import RX-78-1 and its FF-X7 escape craft without rewriting other units.
Run: python tools/import-rx78.py
Native expressions are resolved here; the game consumes ordinary JSON only.
"""
import copy, importlib.util, json, math, re, shutil
from pathlib import Path
from mod_source import ROOT, MAIN, ASSETS, load, parse, section, resolve, stat, number
from unit_visuals import normalize_visuals
from unit_introductions import apply_introduction
from unit_muzzle_effects import apply_muzzle_effects
from unit_parts import apply_parts
from unit_movement import configure_movement

spec=importlib.util.spec_from_file_location("unit_importer", Path(__file__).with_name("import-additional-units.py"))
base=importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
read,write,asset,localized=base.read,base.write,base.asset,base.localized

# Native weapon IDs are retained, including the first-stage suffix of melee weapons.
WEAPONS={
 "EF_100mmMG":("100mm机枪","100mm Machine Gun","100mmマシンガン","shell",1,3,90,12.5),
 "EF_HypeBazooka":("超级火箭筒","Hyper Bazooka","ハイパー・バズーカ","shell",2,4,80,22.5),
 "EF_RX_78_1_BR":("试作型光束步枪","Prototype Beam Rifle","試作型ビーム・ライフル","beam",1,4,90,17.5),
 "EF_BeamSaber_AF_Fast_A":("光束军刀","Beam Saber","ビーム・サーベル","melee",1,1,95,10),
 "EF_BeamSaber_Double_AALDF":("双光束军刀","Twin Beam Sabers","二刀ビーム・サーベル","melee",1,1,95,17.5),
 "EF_BeamJavelin_BF_B":("光束标枪","Beam Javelin","ビーム・ジャベリン","melee",1,1,95,12.5),
 "Common_DoubleVulcan_MS":("头部火神炮","Head Vulcan","頭部バルカン砲","shell",1,2,95,7.5),
 "Common_DoubleVulcan_FF_X7":("双联装机炮","Twin Vulcans","連装バルカン砲","shell",1,3,90,10),
 "Common_DoubleMS_FF_X7":("双联装导弹","Twin Missiles","連装ミサイル","shell",1,4,85,15),
}
PARTS={"head":"head","backpack":"backpack","armL":"leftArm","armR":"rightArm","legL":"leftLeg","legR":"rightLeg"}
def dependencies(text):
 return list(dict.fromkeys(PARTS[k] for k in re.findall(r"memory\.(head|backpack|armL|armR|legL|legR)Breaked\s*==\s*false",text)))
def value(text,key,default=0):
 m=re.search(r"\b"+key+r"\s*[:=]\s*([\d.]+)",text);return float(m[1]) if m else default

def weapon(prefab,reference,effects):
 data=load(ROOT/reference)
 turrets=[name for name in data if name.startswith("turret_")]
 key=turrets[0][7:];t=section(data,turrets[0]);spawn=section(data,"projectile_"+t["projectile"])["spawnUnit"]
 zh,en,ja,kind,minimum,maximum,hit,energy=WEAPONS[key]
 channels={"BeamDamage":"beam","ShellDamage":"shell","CqbDamage":"melee","CqbBeamDamage":"meleeBeam","CqbShellDamage":"meleeShell"}
 components={channel:value(spawn,native) for native,channel in channels.items() if value(spawn,native)}
 fire=next((section(data,n) for n in data if n.endswith("_Fire") and "alsoTriggerAction" in data[n]),{})
 start=base.animation_clip(fire.get("alsoTriggerAction",""),prefab["animations"])
 queue=next((v["alsoQueueAction"] for n,v in data.items() if n.startswith("hiddenAction_") and "alsoQueueAction" in v),None)
 steps=[]
 if not queue: # Native head vulcan is an automatic alternating gun, without an attack animation.
  steps=[dict(delay=.1,shots=1,repeat=16)]
 else:
  for name in queue.split(","):
   s=section(data,"hiddenAction_"+name.strip());step=dict(delay=number(s.get("buildSpeed",0),data))
   if "fireTurretXAtGround" in s:
    ti=turrets.index("turret_"+s["fireTurretXAtGround"])
    projectile=s.get("fireTurretXAtGround_withProjectile",section(data,turrets[ti])["projectile"])
    shot=section(data,"projectile_"+projectile)["spawnUnit"]
    step.update(shots=int(re.search(r"\*(\d+)",shot)[1]),muzzleIndex=ti,partBreakModifier=value(shot,"PartBreakModifier",1))
    needed=dependencies(s.get("requireConditional",""))
    if needed:step["requiredParts"]=needed
   clip=base.animation_clip(s.get("alsoTriggerAction",""),prefab["animations"])
   if clip:step["animation"]=clip
   steps.append(step)
 if key in ("EF_HypeBazooka","EF_RX_78_1_BR"):
  index=next(i for i,s in enumerate(steps) if s.get("shots"))
  cycle=copy.deepcopy(steps[:index+1]);cycle[0]["animation"]=start
  steps=[s for _ in range(2) for s in copy.deepcopy(cycle)]+steps[index+1:]
  components={k:v*.7 for k,v in components.items()}
 if kind=="melee":
  # Keep all native follow-up animations, with the project's reduced follow-up damage.
  fired=False
  for step in steps:
   if step.get("shots"):
    if fired:step["damageMultiplier"]=.5
    fired=True
 sound=resolve(t["shoot_sound"]);name=asset(sound,ASSETS/"sounds"/sound.name)
 source_hit=value(spawn,"WeaponAccuracy",100);multiplier=.85 if kind=="melee" else .8
 result=dict(name=zh,localization=localized(zh,en,ja),type=kind,min=minimum,max=maximum,hit=hit,en=energy,
  sourceName=key,sourceHit=source_hit,hitMultiplier=multiplier,hitBonus=hit-math.floor(source_hit*multiplier+.5),
  clip=start,damagePerShot=sum(components.values()),damageComponents=components,hitsPerShot=1,
  attack=dict(steps=steps,startAnimation=start),sound=dict(file="../../sounds/"+name,volume=number(t.get("shoot_sound_vol",.5))),
  partBreakModifier=value(spawn,"PartBreakModifier",1),requiredParts=[],slot="secondary" if kind=="melee" else "primary",
  source=dict(file=reference,barrelX=number(t.get("barrelX",0)),barrelY=number(t.get("barrelY",0)),
   damageComponents={channel:value(spawn,native) for native,channel in channels.items() if value(spawn,native)},
   barrels=[dict(id=n[7:],x=number(section(data,n).get("barrelX",0)),y=number(section(data,n).get("barrelY",0))) for n in turrets]),hitEffect="Cqb_Hit_1")
 if kind=="melee":
  result["swingEffects"]=["Cqb_Fire_1_Pink_R","Cqb_Fire_1_Pink_L"]
 else:
  projectile_id=spawn.split("*")[0].strip();category="Beam" if kind=="beam" else "Shell"
  projectile=load(MAIN/f"Units/BattleUnits/Weapon/{category}/Projectile/{projectile_id}.ini",MAIN)
  decal=section(projectile,"decal_Projectile_Image");image=resolve(decal["image"],root=MAIN)
  texture=asset(image,ASSETS/"projectiles"/image.name)
  result["projectile"]=dict(texture="../../projectiles/"+texture,scale=number(decal.get("imageScale",1)),
   speed=value(spawn,"ProjectileSpeed",50)*(.5 if "Bazooka" in key else 1),
   forwardOffset=number(decal.get("yOffsetRelative",0)),rotation=number(decal.get("dirOffset",0)))
  if "hiddenAction_SpawnHitEffect" not in projectile:
   projectile={**projectile,"hiddenAction_SpawnHitEffect":projectile["hiddenAction_SpawnDeleteEffect"]}
  result["hitEffect"]=base.import_effect(projectile,effects)
  mounts=[base.mount(prefab,section(data,n),key if key in {l["name"] for l in prefab["layers"]} else None,
   bone="arm19" if key=="Common_DoubleVulcan_MS" else "arm2") for n in turrets]
  if key=="Common_DoubleVulcan_MS":mounts[0]["alternatingOffsetX"]=-6
  result["muzzle"]=mounts[0] if len(mounts)==1 else dict(mounts=mounts)
 if "Vulcan" in key:
  result["clip"]=None;result["attack"]["startAnimation"]=None;result["changeHeldWeapon"]=False
 return key,result

def build(unit_id,effects):
 data=load(ROOT/f"Units/BattleUnits/{unit_id}/{unit_id}.ini")
 aircraft=unit_id=="FF_X7"
 visual_data={k:v for k,v in data.items() if not k.startswith("animation_")} if aircraft else data
 p=base.visuals(unit_id,visual_data)
 p.update(name="核心战斗机" if aircraft else "试作型高达",faction="EFSF",tags=["EFSF","0079"],
  code="FF-X7" if aircraft else "RX-78-1",
  localization=localized("核心战斗机" if aircraft else "试作型高达","Core Fighter" if aircraft else "Prototype Gundam","コア・ファイター" if aircraft else "プロトタイプガンダム"))
 p["stats"].update(hp=8500 if aircraft else 35000,cost=300 if aircraft else 1000,move=9 if aircraft else 6,
  mobility=stat(data,"baseReactionLevel"),accuracy=stat(data,"baseAccuracyLevel"),partStructuralStrength=stat(data,"partStructuralStrength"),
  adaptability={"ground":100,"space":100},movementType="air" if aircraft else "ground",partsBreakable=not aircraft)
 p["sourceStats"].update(en=stat(data,"enMax"),accuracy=stat(data,"baseAccuracyLevel"),
  groundAdaptability=stat(data,"groundAdaptability"),skyAdaptability=stat(data,"skyAdaptability"))
 p["shield"]["hp"]=0 if aircraft else 6000
 p["weapons"]={}
 refs=base.read_source_weapons(unit_id)
 for ref in refs:
  if "/Sp/" in ref or "Common_Push" in ref:continue
  key,w=weapon(p,ref,effects);p["weapons"][key]=w
 melee=[k for k,w in p["weapons"].items() if w["type"]=="melee"]
 primary=[("standard","Common_DoubleVulcan_FF_X7")] if aircraft else [("machine_gun","EF_100mmMG"),("bazooka","EF_HypeBazooka"),("beam_rifle","EF_RX_78_1_BR")]
 fixed=["Common_DoubleMS_FF_X7"] if aircraft else [*melee,"Common_DoubleVulcan_MS"]
 kit_costs=read(ASSETS/"weapon-kit-costs.json")
 p["weaponKits"]=[dict(id=k,name="标准武装" if aircraft else WEAPONS[w][0]+"套件",cost=kit_costs[k],weapons=[w,*fixed],
  localization=localized("标准武装" if aircraft else WEAPONS[w][0]+"套件","Standard" if aircraft else WEAPONS[w][1]+" Kit","標準装備" if aircraft else WEAPONS[w][2]+"装備")) for k,w in primary]
 for key in fixed:
  p["weapons"][key]["slot"]="secondary" if key in melee else "fixed"
  if key not in melee:p["weapons"][key]["changeHeldWeapon"]=False
 # Convert native visibility into kit/held-weapon data; keep paired swords mutually exclusive.
 index_to_weapon={0:"EF_RX_78_1_BR",1:"EF_HypeBazooka",2:"EF_100mmMG"}
 for layer in p["layers"]:
  cond=layer.pop("_visibility","");name=layer["name"]
  eq=re.search(r"EquipmentIndex\s*==\s*(\d+)",cond)
  key=next((w for w in p["weapons"] if name==w or name==w+"_NotUsing"),None)
  if eq and int(eq[1]) in index_to_weapon:
   w=index_to_weapon[int(eq[1])];kit=next(k for k,weapon_id in primary if weapon_id==w)
   layer["visibleWhen"]=dict(kit=kit,heldWeapon={"not":w} if "nowWeaponIndex!=" in cond else w)
  elif key:layer["visibleWhen"]=dict(heldWeapon={"not":key} if "NotUsing" in name else key)
  elif "nowWeaponIndex" in cond:
   double="EF_BeamSaber_Double_AALDF";saber="EF_BeamSaber_AF_Fast_A";javelin="EF_BeamJavelin_BF_B"
   if "Javelin" in name:layer["visibleWhen"]=dict(heldWeapon=javelin)
   elif "Body_BeamSaberL" in name:layer["visibleWhen"]=dict(heldWeapon={"not":double})
   elif "Body_BeamSaberR" in name:layer["visibleWhen"]=dict(heldWeapon={"not":[saber,double]})
   elif "Double_AALDF" in name:layer["visibleWhen"]=dict(heldWeapon=double)
   elif "BeamSaber" in name:layer["visibleWhen"]=dict(heldWeapon=saber)
 if aircraft:
  # Aircraft has a rigid body, not animated MS limbs. Its movement still uses the native boost loop.
  p["skeleton"]={"Body":p["skeleton"]["arm2"]}
  p["animations"]["OnMoving"]="../../animations/AircraftIdle.json"
  configure_movement(p,data)
  p["layers"]=[l for l in p["layers"] if l["bone"] in ("arm2","Body")]
  write(ASSETS/"animations/AircraftIdle.json",dict(duration=1,curves={}))
  p["animations"]={"AircraftIdle":"../../animations/AircraftIdle.json"}
  p["presentation"].update(idle="AircraftIdle",move="AircraftIdle",walk="AircraftIdle",stagger="AircraftIdle",dodge="AircraftIdle",movement="boost",shield=False,mapScale=1,battleScale=1)
  for w in p["weapons"].values():w["requiredParts"]=[]
  for l in p["layers"]:l["bone"]="Body"
  for w in p["weapons"].values():
   for m in w["muzzle"].get("mounts",[w["muzzle"]]):m["bone"]="Body"
  p=normalize_visuals(p,ASSETS/f"units/{unit_id}")
 else:
  p=normalize_visuals(p,ASSETS/f"units/{unit_id}")
  native_twin_steps=copy.deepcopy(p["weapons"]["EF_BeamSaber_Double_AALDF"]["attack"]["steps"])
  p=apply_parts(p,data)
  twin=p["weapons"]["EF_BeamSaber_Double_AALDF"]
  twin["requiredParts"]=[];twin["anyParts"]=["leftArm","rightArm"]
  for step,native_step in zip(twin["attack"]["steps"],native_twin_steps):
   step["requiredParts"]=native_step.get("requiredParts",[])
  p["skills"]=[dict(id="ExitUnit",type="escape",name="脱出",localization=localized("脱出","Eject","脱出"),
   range=1,minRange=1,maxUses=1,consumeAction=False,actionCost=1,
   source=dict(mode="remove"),
   spawn=dict(unitId="FF_X7",kitId="standard",inheritResources=False,hpRecoveryPercent=100,enRecoveryPercent=100,shieldRecoveryPercent=0,repairAllParts=True),
   sound=dict(file="../../sounds/Transform_4.ogg",volume=.6),effect="Light_75_NotAttached")]
  transform=resolve("ROOT:Resource/Sound/SE/Action/Common/Transform_4.ogg")
  asset(transform,ASSETS/"sounds"/transform.name)
  # Import the source flash as an ordinary reusable effect.
  fx=section(data,"effect_Light_75_NotAttached");image=resolve(fx["image"])
  texture=asset(image,ASSETS/"effects/textures"/image.name)
  effects["Light_75_NotAttached"]=dict(texture="textures/"+texture,frames=int(number(fx.get("total_frames",1))),
   startFrame=0,endFrame=0,fps=2,scaleFrom=number(fx.get("scaleFrom",1)),scaleTo=number(fx.get("scaleTo",1)),
   alpha=number(fx.get("alpha",1)),rotation=0,offset=dict(x=0,y=0),drift=0,sounds=[],duration=.4)
 apply_introduction(p,data)
 apply_muzzle_effects(p,data,effects)
 return p

def main():
 effects=read(ASSETS/"effects/effects.json")
 for unit_id in ["RX_78_1","FF_X7"]:
  p=build(unit_id,effects);write(ASSETS/f"units/{unit_id}/unit.json",p)
  print(unit_id,len(p["layers"]),"layers",len(p["weapons"]),"weapons")
 catalog=read(ASSETS/"unit-catalog.json")
 for unit_id in ["RX_78_1","FF_X7"]:
  ref=f"units/{unit_id}/unit.json"
  if ref not in catalog["units"]:catalog["units"].append(ref)
 write(ASSETS/"unit-catalog.json",catalog);write(ASSETS/"effects/effects.json",effects)
if __name__=="__main__":main()
