"""Native smoke equipment and I-field provenance, adapted to authoritative turns."""
import json,shutil
from mod_source import ASSETS,MOD,MAIN,load
from native_combat import globals_for

def apply(prefab,native=None):
    native=native or load(MOD/prefab['source'])
    if any(key.startswith('action_Common_SmokingLauncher') for key in native):
        skills=prefab.setdefault('skills',[]);skills[:]=[s for s in skills if s['id']!='SmokeGrenade']
        skills.append(dict(id='SmokeGrenade',type='smoke',name='烟雾弹',range=0,radius=2,
            effect='BZ_Fire_1_S',actionCost=2,enCost=100,cooldownTurns=3,durationRounds=2,maxUses=99,consumeAction=False,
            sound={'file':'../../sounds/Smoke_1.ogg','volume':.7},
            localization={'zh':{'name':'烟雾弹'},'en':{'name':'Smoke Grenade'},'ja':{'name':'煙幕弾'}},
            description='消耗2 AP与100 EN，在当前位置形成半径2格烟雾；区域内所有单位受到远程攻击时命中率降低25%，不叠加，持续至下次己方回合，冷却3个己方回合。'))
        for mechanic in prefab.get('mechanics',[]):
            if 'SmokingLauncher' in mechanic['id']:mechanic.update(status='adapted',name='烟雾弹：半径2格远程命中率×75%，2 AP、100 EN，冷却3回合')
    if any(m['id']=='I_Field' for m in prefab.get('mechanics',[])):
        values=globals_for(MOD/prefab['source'])
        prefab['stats']['iField']=dict(capacity=float(values['I_FieldHpMax']),reduction=float(values['I_FieldLevel']),
            piercingReduction=.5,recoveryPercent=10,nativeRecoverySpeed=float(values['I_FieldRecoverSpeed']),
            minimumRatio=-.25,effect='I_Field_2')
        for mechanic in prefab['mechanics']:
            if mechanic['id']=='I_Field':mechanic.update(status='adapted',name='I立场：独立耐久吸收远程光束，普通光束吸收95%、贯穿光束50%；耗尽失效，每个己方回合恢复10%最大立场耐久。')
    return prefab

if __name__=='__main__':
    for name,source in [('Smoke_1.ogg','Resource/Sound/SE/Weapon/Fire/Smoke_1.ogg')]:
        dest=ASSETS/'sounds'/name
        if not dest.exists():shutil.copyfile(MAIN/source,dest)
    shutil.copyfile(MAIN/'Resource/Image/Fx/Unit/Image/I_Field_2.png',ASSETS/'effects/textures/I_Field_2.png')
    path=ASSETS/'effects/effects.json';effects=json.loads(path.read_text(encoding='utf-8'))
    effects['I_Field_2']=dict(texture='textures/I_Field_2.png',frames=1,startFrame=0,endFrame=0,fps=1.2,
        scaleFrom=1,scaleTo=1,alpha=.8,rotation=0,offset={'x':0,'y':0},drift=0,sounds=[],source='MOD native Resource/Image/Fx/Unit/I_Field_2.gw')
    path.write_text(json.dumps(effects,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for path in (ASSETS/'units').glob('*/unit.json'):
        prefab=json.loads(path.read_text(encoding='utf-8'));before=json.dumps(prefab,ensure_ascii=False)
        apply(prefab)
        if before!=json.dumps(prefab,ensure_ascii=False):path.write_text(json.dumps(prefab,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');print(prefab['id'])
