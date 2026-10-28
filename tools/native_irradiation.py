"""Native continuous beam payloads become one directional skill hit per hull."""
import copy,json
from mod_source import ASSETS,ROOT,MAIN,load
BEAMS={'ApsarasII':'ZN_ApsarasII_MegaBeamCannon','RX_78_4_Bst':'EF_RX_78_4_HighMegaLauncher',
       'Burstliner':'EF_Burstliner_BeamCannon','MA_08':'ZN_MA_08_MegaBeamCannon','AMX_002':'ZN_AMX_002_MegaBeamCannon','Skiure':'ZN_Skiure_BeamCannon'}

def apply(prefab,native=None):
    key=BEAMS.get(prefab['id'])
    if not key:return prefab
    weapon=prefab['weapons'][key]
    data=load(ROOT/weapon['source']['file'])
    color=next((s.get('sendMessageWithTags','')[9:] for s in data.values() if s.get('sendMessageWithTags','').startswith('SetColor_')),'Pink')
    payload=weapon.get('nativePayload',{})
    repeat=int(payload.get('ProjectileAttackTimes',1));decay=payload.get('ProjectileAttackTimesDamageModifier',1)
    repeat_multiplier=sum(decay**index for index in range(repeat))
    totals={}
    for step in weapon['attack']['steps']:
        for channel,damage in step.get('damageComponents',weapon['damageComponents']).items():
            totals[channel]=totals.get(channel,0)+damage*step.get('shots',0)*step.get('repeat',1)*step.get('damageMultiplier',1)*repeat_multiplier
    skill=dict(id='Irradiation',type='irradiation',name='光束照射',range=10,minRange=1,actionCost=5,enCostPercent=50,
        cooldownTurns=3,maxUses=99,consumeAction=True,baseHit=60,damageComponents={k:v/20 for k,v in totals.items()},
        nativeTotalDamage=sum(totals.values()),nativeRepeatMultiplier=repeat_multiplier,sourceWeapon=key,
        requiredParts=copy.deepcopy(weapon.get('requiredParts',[])),requiresSfsMS=prefab['id'] in ('Burstliner','Skiure'),
        chargeSeconds=round(max(1,weapon.get('nativeTiming',{}).get('firstShot',2)),3),fireSeconds=2,
        visualColor=color,muzzle=copy.deepcopy(weapon.get('muzzle',{})),weaponDisplayIndex=weapon.get('displayIndex',0),
        clip=next((step['animation'] for step in weapon['attack']['steps'] if step.get('animation')),None),
        effect='Irradiation_Charge_'+color,sound={'file':'../../sounds/BeamCharge_4.ogg','volume':.7},
        localization={'zh':{'name':'光束照射'},'en':{'name':'Irradiation Beam'},'ja':{'name':'照射ビーム'}},
        description='选择方向照射10格；消耗5 AP与50%最大EN，冷却3个己方回合。基础命中60%，对沿途每台单位（含友军）判定一次，基础伤害为原MOD完整伤害的1/20。')
    if 'BeamCharge_4.ogg' not in [p.name for p in (ASSETS/'sounds').glob('*.ogg')]:raise ValueError('Missing charge audio')
    skills=prefab.setdefault('skills',[]);skills[:]=[s for s in skills if s['id']!='Irradiation'];skills.append(skill)
    weapon['availability']={'hidden':True,'reasons':['converted_skill'],'convertedSkill':'Irradiation'}
    for kit in prefab['weaponKits']:kit['weapons']=[w for w in kit['weapons'] if w!=key]
    prefab['mechanics']=[m for m in prefab.get('mechanics',[]) if not (m.get('id','').startswith('energy_capacity_') and key in m['id'])]
    prefab['mechanics']=[m for m in prefab.get('mechanics',[]) if m['id']!='Irradiation']
    prefab['mechanics'].append(dict(id='Irradiation',status='adapted',name='光束照射：方向射线、蓄力、逐机命中与长度自适应贴图'))
    if prefab['id']=='ApsarasII':
        prefab['stats'].update(footprint={'width':3,'height':3},movementType='air')
        prefab['unitTags']=[tag for tag in prefab.get('unitTags',[]) if tag not in ('SmallUnit','MediumUnit','LargeUnit')]+['LargeUnit']
        skills[:]=[s for s in skills if s['id']!='EMP'];skills.append(dict(id='EMP',type='emp',name='EMP',range=0,radius=3,
            actionCost=2,enCost=80,cooldownTurns=2,maxUses=99,consumeAction=False,effect='Light_75_NotAttached',
            sound={'file':'../../sounds/Beam_Hit_3.ogg','volume':.7},description='消耗2 AP与80 EN，周围3格内所有敌人下回合AP减少1点，不叠加，冷却2个己方回合。'))
        for mechanic in prefab['mechanics']:
            if mechanic['id']=='special_Common_EMP_M':mechanic.update(status='adapted',name='EMP：周围3格敌人下回合AP减少1，2 AP，冷却2回合')
    return prefab

def import_effects():
    import shutil
    for folder,name in [("Fire","BeamCharge_4"),("Hit","Beam_Hit_3")]:
        destination=ASSETS/"sounds"/(name+".ogg")
        if not destination.exists():shutil.copyfile(MAIN/f"Resource/Sound/SE/Weapon/{folder}/{name}.ogg",destination)
    path=ASSETS/'effects/effects.json';effects=json.loads(path.read_text(encoding='utf-8'))
    for color in ('Pink','Blue','Yellow'):
        for part in ('Start','Mid','End','Charge'):
            frames=12 if part=='Charge' else 28
            effects[f'Irradiation_{part}_{color}']=dict(texture=f'textures/Irradiation_{part}_{color}.png',frames=frames,
                startFrame=0,endFrame=frames-1,fps=12 if part=='Charge' else 14,scaleFrom=1,scaleTo=1,alpha=1,
                rotation=0,offset={'x':0,'y':0},drift=0,sounds=[],source='MOD native HighMegaCannon/Beam_Charge split sheets, half resolution, original palette and alpha')
    path.write_text(json.dumps(effects,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

if __name__=='__main__':
    import_effects()
    for ident in BEAMS:
        path=ASSETS/f'units/{ident}/unit.json';prefab=json.loads(path.read_text(encoding='utf-8'));apply(prefab)
        path.write_text(json.dumps(prefab,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    path=ASSETS/'unit-wip.json';wip=json.loads(path.read_text(encoding='utf-8'));wip['units']=[name for name in wip['units'] if not name.startswith('Apsaras')];path.write_text(json.dumps(wip,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Converted',len(BEAMS),'native irradiation beams; Apsaras enabled')
