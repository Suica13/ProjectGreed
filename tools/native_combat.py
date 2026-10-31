"""从只读 MOD 配置恢复资源、武器面板与动作时间线；不执行 MOD 表达式。"""
import ast
import copy
import functools
import math
import re
from pathlib import Path
from mod_source import ROOT, MAIN, parse, load, section, resolve, stat

CHANNELS = {"BeamDamage": "beam", "ShellDamage": "shell", "CqbDamage": "melee", "CqbBeamDamage": "meleeBeam", "CqbShellDamage": "meleeShell", "BeamAPDamage": "beamAP", "ShellAPDamage": "shellAP", "CqbAPDamage": "meleeAP"}
PARTS = {"head": "head", "backpack": "backpack", "armL": "leftArm", "armR": "rightArm", "legL": "leftLeg", "legR": "rightLeg"}

@functools.lru_cache(None)
def globals_for(path):
    result = {}
    for reference in parse(path).get("core", {}).get("copyFrom", "").split(","):
        if reference.strip():
            result.update(globals_for(resolve(reference, path.parent)))
    for key, value in re.findall(r"^\s*@global\s+(\w+)\s*=([^\r\n#]+)", path.read_text(encoding="utf-8-sig"), re.M):
        result[key] = value.strip()
    return result


def numeric(value, data, variables, depth=0):
    if depth > 20:
        raise ValueError("Recursive native expression: " + str(value))
    text = str(value).strip().removesuffix("s")
    def replace(match):
        token = match[1]
        raw = section(data, token.rsplit(".", 1)[0])[token.rsplit(".", 1)[1]] if "." in token else variables[token]
        return str(numeric(raw, data, variables, depth + 1))
    text = re.sub(r"\$\{([^}]+)\}", replace, text)
    text = text.replace("memory.enMax", str(variables.get("enMax", 0)))
    operators = {ast.Add: lambda a,b:a+b, ast.Sub:lambda a,b:a-b, ast.Mult:lambda a,b:a*b, ast.Div:lambda a,b:a/b}
    def visit(node):
        if isinstance(node, ast.Constant) and isinstance(node.value, (int,float)):
            return float(node.value)
        if isinstance(node, ast.UnaryOp) and isinstance(node.op,(ast.USub,ast.UAdd)):
            return (-1 if isinstance(node.op,ast.USub) else 1)*visit(node.operand)
        if isinstance(node, ast.BinOp) and type(node.op) in operators:
            return operators[type(node.op)](visit(node.left),visit(node.right))
        if isinstance(node, ast.Call) and isinstance(node.func,ast.Name) and node.func.id in ["min","max","int","round"]:
            return {"min":min,"max":max,"int":int,"round":round}[node.func.id](*[visit(a) for a in node.args])
        raise ValueError("Not a constant numeric expression: " + text)
    return visit(ast.parse(text,mode="eval").body)


def payload(text):
    return {key:float(value) for key,value in re.findall(r"\b(\w+)\s*[:=]\s*(-?[\d.]+)",text)}


def source_for(weapon):
    return ROOT / weapon["source"]["file"]


def native_weapon(prefab, weapon, unit_data):
    if weapon.get('remote'):
        from native_remote_weapons import compile_launcher
        from mod_source import MOD
        root = MOD / prefab['source'].split('/')[0]
        return compile_launcher(prefab, root / weapon['source']['file'], root, False)[1]
    path = source_for(weapon)
    weapon_data = load(path)
    data = {key:{**weapon_data.get(key,{}),**unit_data.get(key,{})} for key in weapon_data.keys() | unit_data.keys()}
    variables = {**globals_for(path), "enMax": stat(unit_data,"enMax")}
    number = lambda value: numeric(value,data,variables)
    barrels = [b["id"] for b in weapon["source"].get("barrels",[])]
    barrels = [key for key in barrels if "turret_"+key in weapon_data]
    if not barrels:
        barrels = [key[7:] for key in weapon_data if key.startswith("turret_") and section(data,key).get("projectile") not in [None,"IGNORE"]]
    weapon["source"]["barrels"] = [{"id":key,"x":number(section(data,"turret_"+key).get("barrelX",0)),"y":number(section(data,"turret_"+key).get("barrelY",0))} for key in barrels]
    allowed = set(barrels)
    animations = prefab["animations"]
    events, visited_actions = [], []
    energy = 0
    duration = 0
    def clip_of(action):
        return next((clip for clip in sorted(animations,key=len,reverse=True) if action in ["Play"+clip+"_Step_1","Play"+clip+"_Step1"]),None)
    def emit(turret_id, at, action):
        turret = section(data,"turret_"+turret_id)
        projectile_id = action.get("fireTurretXAtGround_withProjectile",turret["projectile"])
        projectile = section(data,"projectile_"+projectile_id)
        raw = projectile.get("spawnUnit","")
        values = payload(raw)
        count = re.search(r"^\s*\w+\*(\d+)",raw)
        count = int(count[1]) if count else 1
        components = {channel:values[key] for key,channel in CHANNELS.items() if values.get(key,0)>0}
        if not components:
            return
        conditions = action.get("requireConditional","")
        required = [PARTS[name] for name in re.findall(r"memory\.(head|backpack|armL|armR|legL|legR)Breaked\s*==\s*false",conditions)]
        events.append({"at":at,"shots":count,"muzzleIndex":min(barrels.index(turret_id),len(weapon.get("muzzle",{}).get("mounts",[0]))-1),"nativeBarrel":turret_id,"damageComponents":components,"accuracy":values.get("WeaponAccuracy",100),"partBreakModifier":values.get("PartBreakModifier",1),"nativePayload":values,"requiredParts":required})
    def visit(name, at, stack=()):
        nonlocal energy,duration
        name=name.strip()
        clip=clip_of(name)
        if clip:
            events.append({"at":at,"animation":clip})
            return at
        key=name if name.startswith(("action_","hiddenAction_")) else "hiddenAction_"+name
        if key not in data or key in stack:
            return at
        action=section(data,key)
        visited_actions.append(key)
        display = re.search(r"\bnowWeaponIndex\s*=\s*(-?\d+)(?![\d.])", action.get("setUnitMemory", ""))
        if display:
            events.append({"at": at, "weaponDisplayIndex": int(display[1])})
        resources=action.get("addResources","")
        price=re.search(r"(?:^|[,| ])EN\s*[:=]\s*([^,|]+)",action.get("price",""),re.I)
        if price:
            energy += max(0,number(price[1]))
        cost=re.search(r"(?:^|[,| ])EN\s*[:=]\s*([^,|]+)",resources,re.I)
        if cost:
            energy += max(0,-number(cost[1]))
        fire=action.get("fireTurretXAtGround")
        if fire in allowed and action.get("fireTurretXAtGround_count", "1") != "0":
            emit(fire,at,action)
        end=at
        for child in action.get("alsoTriggerAction","").split(","):
            end=max(end,visit(child,at,(*stack,key)))
        clock=at
        for child in action.get("alsoQueueAction","").split(","):
            child=child.strip();child_key="hiddenAction_"+child
            if child_key not in data:
                continue
            queued=section(data,child_key)
            clock += number(queued.get("buildSpeed",0))
            clock=max(clock,visit(child,clock,(*stack,key)))
        duration=max(duration,end,clock)
        return max(end,clock)
    native_name = weapon.get("sourceName",barrels[0])
    stem=path.stem
    candidates=list(dict.fromkeys([native_name,re.sub(r"_(?:L|R|A|B)$","",native_name),stem,re.sub(r"_Lv\d+$","",stem)]))
    root=next(("hiddenAction_"+name+"_Fire" for name in candidates if "hiddenAction_"+name+"_Fire" in data),None)
    if not root:
        root=next(("action_"+name+"_Trigger" for name in candidates if "action_"+name+"_Trigger" in data),None)
    if not root and stem == "ZN_MA_08_AA_BeamCannon":
        root = "action_" + stem + "_B1_Trigger"
    if root:
        visit(root,0)
    if not any(e.get("shots") for e in events):
        # Automatic turret bursts have a magazine counter, not a hiddenAction queue.
        events=[];duration=0
        family = lambda name: re.sub(r"_(?:L|R)\d*$", "", name)
        automatic_barrels = [barrel for barrel in dict.fromkeys(barrels) if family(barrel) == family(native_name)]
        if not automatic_barrels:
            automatic_barrels = list(dict.fromkeys(barrels))
        for turret_id in automatic_barrels:
            turret=section(data,"turret_"+turret_id)
            count=variables.get(turret_id+"_Shoot",variables.get(stem+"_Shoot",1))
            count=int(number(count))
            interval=number(turret.get("delay",0))
            for index in range(count):
                emit(turret_id,index*interval,{})
            duration=max(duration,max(0,count-1)*interval)
        energy=0
    shots=[e for e in events if e.get("shots")]
    if not shots:
        raise ValueError("No native firing payload: "+prefab["id"]+"/"+native_name)
    per_shot = not root
    energy_unit = number(variables.get(stem+"_EN",variables.get(native_name+"_EN",0))) if per_shot else 0
    if per_shot:
        energy=energy_unit*len(shots)
    # A merged ship group fires one native flow per physical surviving module.
    modules=weapon.get("moduleIds",[])
    if modules:
        module_events=[]
        for index,module in enumerate(modules):
            for event in events:
                item=copy.deepcopy(event)
                if item.get("shots"):
                    item.update(moduleId=module,muzzleIndex=index)
                module_events.append(item)
        events=module_events
        energy*=len(modules)
    events.sort(key=lambda e:e["at"])
    first=next(e for e in events if e.get("shots"))
    weapon["damageComponents"]=copy.deepcopy(first["damageComponents"])
    weapon["damagePerShot"]=sum(first["damageComponents"].values())
    weapon.update(hit=first["accuracy"],sourceHit=first["accuracy"],hitMultiplier=1,hitBonus=0,en=energy,hitsPerShot=1)
    weapon["partBreakModifier"]=first["partBreakModifier"]
    weapon["nativePayload"]=copy.deepcopy(first["nativePayload"])
    if weapon.get("projectile") and first["nativePayload"].get("ProjectileSpeed",0)>0:
        weapon["projectile"]["speed"]=first["nativePayload"]["ProjectileSpeed"]
    weapon["antiSize"]={size:{"damage":first["nativePayload"].get("AntiSize"+native+"Damage",1),"accuracy":first["nativePayload"].get("AntiSize"+native+"Accuracy",1)} for size,native in [("small","Small"),("large","Large")]}
    weapon["targetModifiers"]={key:first["nativePayload"].get(native,1) for key,native in [("air","AntiAir"),("water","AntiAqua"),("ground","AntiLand"),("space","AntiSpace")]}
    display_events = [event for event in events if "weaponDisplayIndex" in event]
    if display_events:
        weapon["displayIndex"] = display_events[-1]["weaponDisplayIndex"]
    else:
        weapon.pop("displayIndex", None)
    steps=[];at=0
    for event in events:
        step={key:copy.deepcopy(value) for key,value in event.items() if key not in ["at","nativePayload","nativeBarrel"]}
        if step.get("damageComponents") == weapon["damageComponents"]:
            step.pop("damageComponents",None)
        if step.get("accuracy") == weapon["hit"]:
            step.pop("accuracy",None)
        step["delay"]=round(event["at"]-at,6);at=event["at"]
        steps.append(step)
    if duration>at:
        steps.append({"delay":round(duration-at,6)})
    weapon["attack"]={"steps":steps,"startAnimation":None}
    weapon["clip"]=next((e["animation"] for e in events if e.get("animation")),None)
    cd_key=next((name+"_CD" for name in candidates if name+"_CD" in variables),None)
    cooldown=number(variables[cd_key]) if cd_key else 0
    # Follow actual display-index writes, not mount/body-part heuristics or action names alone.
    weapon["changeHeldWeapon"] = any(re.search(r"\bnowWeaponIndex\s*=", section(data, action).get("setUnitMemory", ""))
        for action in visited_actions)
    weapon["nativeTiming"]={"source":path.relative_to(ROOT).as_posix(),"barrel":first["nativeBarrel"],"entry":root or "automatic_turret", "cooldown":cooldown,"duration":duration,"firstShot":min(e["at"] for e in events if e.get("shots")),"lastShot":max(e["at"] for e in events if e.get("shots")),"firingEvents":sum(1 for e in events if e.get("shots")),"projectiles":sum(e.get("shots",0) for e in events),"declaredEnergy":number(variables.get(native_name+"_EN",variables.get(stem+"_EN",0))),"energyMode":"perShot" if per_shot else "perVolley","energyPerEmission":energy_unit,"energy":energy,"actions":list(dict.fromkeys(visited_actions))}
    return weapon


def restore(prefab, native):
    prefab["stats"]["hp"]=float(native["core"]["maxHp"])
    from unit_energy import apply_capacity_policy
    apply_capacity_policy(prefab, stat(native,"enMax"))
    prefab["shield"]["hp"]=float(native["core"].get("maxShield",0))
    if prefab["stats"]["en"]<=0:
        raise ValueError("Missing native EN: "+prefab["id"])
    for weapon in prefab["weapons"].values():
        if not weapon.get("remote"):
            native_weapon(prefab,weapon,native)
    if prefab["stats"].get("ship"):
        for weapon in prefab["weapons"].values():
            for payload in [weapon, *weapon.get("attack", {}).get("steps", [])]:
                payload.pop("shipDamageBeforeReduction", None)
            weapon.pop("shipDamageMultiplier", None)
            weapon.pop("shipAntiAirBeforeReduction", None)
    prefab["nativeCombatRevision"]=1
    return prefab
