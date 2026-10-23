"""Copy the MOD's hit/death sprite sheets and sound variants into project-local JSON."""
import json
import shutil


def import_effects(root, dest, parse):
    files = {
        'MG_Hit_1': 'Weapon/Shell/Common/MG_Hit_1.gw',
        'MG_Hit_1_S': 'Weapon/Shell/Common/MG_Hit_1.gw',
        'Explosion_Hit_1': 'Weapon/Shell/Common/Explosion_Hit_1.gw',
        'Beam_Hit_1_S_Pink': 'Weapon/Beam/Common/Beam_Hit_1_Pink.gw',
        'Cqb_Hit_1': 'Weapon/Cqb/Common/Cqb_Hit_1.gw',
        'Explosion_Ground_1': 'Common/Common_Explosion_1.gw',
    }
    def copy(reference, folder):
        source=root/reference.replace('\\','/')[5:].lstrip('/')
        target=dest/folder/source.name
        target.parent.mkdir(parents=True,exist_ok=True)
        shutil.copyfile(source,target)
        return (folder+'/'+source.name)
    effects={}
    for name, reference in files.items():
        sections=parse(root/'Resource/Image/Fx'/reference)
        def section(name):
            value=sections[name].copy()
            parent=value.pop('@copyFromSection',None)
            return {**section(parent),**value} if parent else value
        effect=section('effect_'+name)
        texture=copy(effect['image'],'effects/textures').removeprefix('effects/')
        sounds=[]
        for sound in effect.get('alsoPlaySound','').split(','):
            if not sound.strip(): continue
            filename,volume=sound.strip().rsplit(':',1)
            sounds.append(dict(file='../'+copy(filename,'sounds'),volume=float(volume)))
        effects[name]=dict(texture=texture,frames=int(effect.get('total_frames',1)),
            startFrame=int(effect.get('animateFrameStart',0)),endFrame=int(effect.get('animateFrameEnd',0)),
            fps=float(effect.get('animateFrameSpeed',1))*60,scaleFrom=float(effect.get('scaleFrom',1)),
            scaleTo=float(effect.get('scaleTo',1)),alpha=float(effect.get('alpha',1)),
            rotation=float(effect.get('dirOffset',0)),offset=dict(x=float(effect.get('xOffsetRelative',0)),y=float(effect.get('yOffsetRelative',0))),
            drift=float(effect.get('ySpeedRelative',0))*60,sounds=sounds,source='Resource/Image/Fx/'+reference)
    (dest/'effects/effects.json').write_text(json.dumps(effects,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    presentation=dest/'presentation.json'
    if not presentation.exists():
        presentation.write_text(json.dumps(dict(projectileSpeed=0.5,animationSpeed=0.85,dodgeDistance=18,dodgeOut=0.18,dodgeHold=0.12,dodgeReturn=0.25),indent=2)+'\n',encoding='utf-8')
