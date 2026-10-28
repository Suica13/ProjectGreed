"""Explicit turn-based area and on-hit policies; native payloads stay intact."""
def apply(prefab, native=None):
    for weapon in prefab['weapons'].values():
        if weapon.get('nativePayload', {}).get('StunDamage', 0) > 0 or 'HeatRod' in weapon.get('sourceName', ''):
            weapon['onHitAPLoss'] = 1
        if weapon.get('nativePayload', {}).get('BurnedDamage', 0) > 0 or 'Flamethrower' in weapon.get('sourceName', ''):
            weapon.update(actionCost=3, burn=dict(durationTurns=3, hpPercent=5))
    if prefab['id'] == 'PublicClass':
        weapon = prefab['weapons']['EF_PublicClass_BeamDiffusionMS']
        weapon['availability'] = dict(hidden=True, reasons=['converted_skill'], convertedSkill='BeamDiffusion')
        for kit in prefab['weaponKits']:
            kit['weapons'] = [key for key in kit['weapons'] if key != 'EF_PublicClass_BeamDiffusionMS']
        skills = prefab.setdefault('skills', [])
        skills[:] = [s for s in skills if s['id'] != 'BeamDiffusion']
        skills.append(dict(id='BeamDiffusion', type='beam_diffusion', name='光束扰乱膜',
            localization={'zh':{'name':'光束扰乱膜'},'en':{'name':'Beam Disruption Screen'},'ja':{'name':'ビーム撹乱膜'}},
            range=weapon['max'], minRange=0, radius=4, durationRounds=4, actionCost=4,
            enCostPercent=50, maxUses=99, consumeAction=False,
            effect=weapon['hitEffect'], sound=weapon.get('sound'),
            description='选择目标地格发射，消耗4 AP与50%最大EN；半径4格内持续2回合，穿过区域的光束弹伤害降低50%，同类区域不叠加。'))
        for mechanic in prefab.get('mechanics', []):
            if mechanic['id'] == 'BeamDiffusionArea':
                mechanic.update(status='adapted', name='光束扰乱膜：技能释放，穿过半径4格区域的光束弹伤害降低50%，持续2回合')
    return prefab
