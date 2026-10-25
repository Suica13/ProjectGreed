"""Import environment-specific and large-unit death effects from the original MOD."""
import json, shutil
from mod_source import ROOT, ASSETS, load, section, resolve, number


def main():
    path = ASSETS / "effects/effects.json"
    effects = json.loads(path.read_text(encoding="utf-8"))
    sources = {
        "Explosion_Space_1": "Common_Explosion_1.gw",
        "Explosion_Water_1": "Common_Explosion_1.gw",
        "Common_Explosion_MA_Ground_1": "Common_Explosion_MA_1.gw",
        "Common_Explosion_MA_Space_1": "Common_Explosion_MA_1.gw",
        "LargeUnitDie_1": "Common_LargeUnitDie_1.gw",
    }
    for name, source in sources.items():
        native = section(load(ROOT / "Resource/Image/Fx/Common" / source), "effect_" + name)
        image = resolve(native["image"])
        shutil.copyfile(image, ASSETS / "effects/textures" / image.name)
        sounds = []
        for sound in native.get("alsoPlaySound", "").split(","):
            if not sound.strip(): continue
            reference, volume = sound.strip().rsplit(":", 1)
            sound_file = resolve(reference)
            shutil.copyfile(sound_file, ASSETS / "sounds" / sound_file.name)
            sounds.append(dict(file="../sounds/" + sound_file.name, volume=float(volume)))
        effects[name] = dict(texture="textures/" + image.name, frames=int(number(native.get("total_frames",1))),
            startFrame=int(number(native.get("animateFrameStart",0))), endFrame=int(number(native.get("animateFrameEnd",0))),
            fps=number(native.get("animateFrameSpeed",1))*60, scaleFrom=number(native.get("scaleFrom",1)),
            scaleTo=number(native.get("scaleTo",1)), alpha=number(native.get("alpha",1)), rotation=0,
            offset=dict(x=0,y=0), drift=0, sounds=sounds, source="Resource/Image/Fx/Common/" + source)
    # The source burst is ground-colored even on ships; use its space sheet for space-map bursts.
    effects["LargeUnitDie_1_Space"] = {**effects["LargeUnitDie_1"], "texture": effects["Explosion_Space_1"]["texture"]}
    path.write_text(json.dumps(effects,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    path = ASSETS / "presentation.json"
    presentation = json.loads(path.read_text(encoding="utf-8"))
    presentation["deathEffects"] = dict(
        standard=dict(ground="Explosion_Ground_1",space="Explosion_Space_1",water="Explosion_Water_1"),
        large=dict(ground="Common_Explosion_MA_Ground_1",space="Common_Explosion_MA_Space_1",water="Common_Explosion_MA_Ground_1"),
        largeBurst=dict(ground="LargeUnitDie_1",space="LargeUnitDie_1_Space",water="LargeUnitDie_1"),
        largeSequence=dict(count=10,interval=.2,finalDelay=2,spreadX=60,spreadY=100))
    path.write_text(json.dumps(presentation,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Imported space, water and large-unit death effects.")

if __name__ == "__main__": main()
