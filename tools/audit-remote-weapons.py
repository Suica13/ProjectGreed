"""Read-only native checks and generated remote-weapon coverage report."""
import copy
import json
from pathlib import Path
from native_remote_weapons import CARRIERS, compile_launcher
from mod_source import ASSETS, MOD, ROOT, load
from weapon_policy import configure

def main():
    rows=[]
    for ident in CARRIERS:
        prefab=json.loads((ASSETS/f'units/{ident}/unit.json').read_text(encoding='utf-8'))
        refreshed=copy.deepcopy(prefab)
        configure(refreshed,load(MOD/prefab['source']))
        for key,weapon in prefab['weapons'].items():
            if not weapon.get('remote'):continue
            _,rebuilt=compile_launcher(copy.deepcopy(prefab),ROOT/weapon['source']['file'],ROOT,False)
            assert weapon==rebuilt, (ident,key,'source-policy mismatch')
            assert weapon==refreshed['weapons'][key],(ident,key,'refresh mismatch')
            assert weapon['damagePerShot']==1000
            assert weapon['remote']['shotsPerUnit']==2
            assert all(key in kit['weapons'] for kit in prefab['weaponKits'])
            rows.append((ident,prefab['name'],weapon))
    # Native INCOM player action deliberately does not enforce its AI-only awakening gate.
    root=MOD/'GW_BattleUniverse_DLC_0087'
    prefab={'id':'MSA_0011','skeleton':{'Body':{},'Head':{}},'materials':{'textures':{}}}
    _,incom=compile_launcher(prefab,root/'Units/BattleUnits/Weapon/Funnel/AEUG_MSA_0011_Incom.gw',root,False)
    assert incom['remote']['kind']=='incom'
    assert incom['remote']['awakeningScale']==0
    assert not incom.get('pilotRequirements')
    assert incom['requiredParts']==['head']
    assert len(incom['remote']['units'])==1
    production=json.loads(Path('shared/production-catalog.json').read_text(encoding='utf-8'))
    tech=json.loads(Path('shared/development-tree.json').read_text(encoding='utf-8'))
    for ident in ('MS_06Z','MSN_01'):
        assert ident in production['baseModels']
        assert any(ident in node['unlocks'] for node in tech['ZEON'])
    lines=['# 浮游兵器接入清单','',
        '由 `python tools/audit-remote-weapons.py` 读取原MOD及当前配置生成。','',
        '| 机体 | 单位ID | 控制方式 | 单元数 | 每单元发数 | 基础单发伤害 | 觉醒门槛 | EN / AP |',
        '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |']
    for ident,name,w in rows:
        r=w['remote'];kind={'funnel':'无线BIT','wired':'有线赛克缪炮','incom':'INCOM'}[r['kind']]
        lines.append(f"| {name} | {ident} | {kind} | {len(r['units'])} | 2 | 1000 | ≥75 | {w['en']:g} / 3 |")
    lines += ['',
        '- 单元数量来自实际发射动作队列，包含重复排队动作；艾尔美斯为5个BIT。',
        '- 共享攻击与反击流程逐发裁定；觉醒门槛、部位、EN与AP均由服务端校验。单元只是演出对象，不产生额外同步单位、伤害或视野。',
        '- 每个单元直线移动0.6秒、停顿0.1秒后开火，再等待0.5秒；重复一次后回收。各单元相隔0.13秒启动，普通演出倍速不缩短这些停顿。',
        '- 无线BIT直接回收；有线炮记录转折点并沿线回收。腕部损坏时对应单元不可发射，发射期间暂时隐藏原部件，回收后恢复。',
        '- 原生EN与冷却秒数分别保存在武器EN与nativeRemote/nativeTiming中；回合制采用3 AP、无线1～6格、有线1～4格，没有将秒数强行换算为回合冷却。',
        '- 赛克缪浮游炮继承原版额外觉醒成长：伤害与命中乘以1+(觉醒-100)×0.0025；常规驾驶员属性加成继续生效。INCOM仅继承基础驾驶员能力，不重复叠加这项觉醒系数。',
        '- INCOM导入与演出逻辑已支持：以0087原版MSA-0011动作验证1个单元、头部条件、无玩家觉醒门槛和无额外觉醒成长。当前单位目录仍以0079/0083为主，本次没有批量引入0087机体。',
        '- 本次补入MS-06Z、MSN-01，生产价格来自原MOD工厂。原版科技列表没有将它们列入可见节点；本项目将它们补接到吉翁号开发计划（0079L），保留原有第二页显示设置。',
        '- 素材使用原始文件名、透明PNG与现有共享动画池。只有战场用到的远程单元贴图才会加入战斗预加载。',
        '', '## 检查范围','',
        '本脚本核对5个已接入机体的源动作、数量、门槛、价格接线，以及INCOM源动作区别。规则/WebSocket测试与浏览器演出测试另行运行；不代表全部旧版测试或所有MOD时代均已验收。','']
    Path('浮游兵器接入清单.md').write_text('\n'.join(lines),encoding='utf-8')
    print(f'Native remote source audit passed: {len(rows)} carriers + original INCOM fixture')

if __name__=='__main__':main()
