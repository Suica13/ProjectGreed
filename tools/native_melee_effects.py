"""Restore native melee animation/effect events without rebaking combat damage."""
import copy
import json
import shutil
from mod_source import ASSETS, MOD, MAIN, load, section, resolve
from native_combat import native_weapon, source_for


def import_effect(name, data, effects):
    if name in effects:
        return
    value = section(data, "effect_" + name)
    image = resolve(value["image"], root=MAIN)
    dest = ASSETS / "effects/textures" / image.name
    if not dest.exists():
        shutil.copyfile(image, dest)
    sounds = []
    for sound in value.get("alsoPlaySound", "").split(","):
        if sound.strip():
            reference, volume = sound.rsplit(":", 1)
            source = resolve(reference, root=MAIN)
            dest = ASSETS / "sounds" / source.name
            if not dest.exists():
                shutil.copyfile(source, dest)
            sounds.append({"file": "../sounds/" + source.name, "volume": float(volume)})
    num = lambda key, default: float(value.get(key, default))
    effects[name] = dict(texture="textures/"+image.name, frames=int(num("total_frames",1)),
        startFrame=int(num("animateFrameStart",0)), endFrame=int(num("animateFrameEnd",0)),
        fps=num("animateFrameSpeed",1)*60, scaleFrom=num("scaleFrom",1), scaleTo=num("scaleTo",1),
        alpha=num("alpha",1), rotation=num("dirOffset",0),
        offset={"x":num("xOffsetRelative",0),"y":num("yOffsetRelative",0)},
        drift=num("ySpeedRelative",0)*60, sounds=sounds, source="MOD native melee action: "+name)


def apply(prefab, native, effects=None):
    own_effects = effects is None
    effects_file = ASSETS / "effects/effects.json"
    if own_effects:
        effects = json.loads(effects_file.read_text(encoding="utf-8"))
    size = len(effects)
    for weapon in prefab.get("weapons", {}).values():
        if weapon.get("type") != "melee" or not weapon.get("source", {}).get("file") or weapon.get("remote"):
            continue
        restored = native_weapon(prefab, copy.deepcopy(weapon), native)
        original = weapon.get("attack", {}).get("steps", [])
        firing = [step for step in original if step.get("shots")]
        native_firing = [step for step in restored["attack"]["steps"] if step.get("shots")]
        # Do not rewrite damage/energy or project-specific synthetic attacks.
        if [s["shots"] for s in firing] != [s["shots"] for s in native_firing]:
            continue
        data = load(source_for(weapon, prefab))
        for step, source in zip(firing, native_firing):
            step["swingEffects"] = source.get("swingEffects", [])
            for name in step["swingEffects"]:
                import_effect(name, data, effects)
        # A clip is an event on the native chain, not a single weapon-wide pose.
        elapsed = 0
        timeline = []
        for step in original:
            elapsed = round(elapsed + step["delay"], 6)
            item = {k:v for k,v in step.items() if k not in ("delay", "animation")}
            if item:
                timeline.append((elapsed, item))
        elapsed = 0
        for step in restored["attack"]["steps"]:
            elapsed = round(elapsed + step["delay"], 6)
            if step.get("animation"):
                timeline.append((elapsed, {"animation":step["animation"]}))
        # Animation changes precede simultaneous strikes.
        timeline.sort(key=lambda event:(event[0], 0 if "animation" in event[1] else 1))
        end = sum(step["delay"] for step in original)
        steps, at = [], 0
        for time, item in timeline:
            steps.append({**item,"delay":round(time-at,6)})
            at = time
        if end > at:
            steps.append({"delay":round(end-at,6)})
        weapon["attack"]["steps"] = steps
        weapon["clip"] = restored["clip"]
        weapon["attack"]["startAnimation"] = restored["clip"]
        weapon.pop("swingEffects", None)
    if own_effects and len(effects) != size:
        effects_file.write_text(json.dumps(effects,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    return prefab
