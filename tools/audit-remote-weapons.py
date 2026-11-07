"""Read-only native remote burst audit and generated coverage report."""
import copy
from mod_source import ASSETS, MOD
from weapon_store import loads
from native_remote_weapons import compile_launcher
from native_weapon_levels import apply as levels

def main():
    rows=[]
    for path in sorted((ASSETS/'units').glob('*/unit.json')):
        prefab=loads(path.read_text(encoding='utf-8'))
        root=MOD/prefab['source'].split('/')[0]
        for key,weapon in prefab['weapons'].items():
            if not weapon.get('remote'): continue
            clone=copy.deepcopy(prefab)
            _,rebuilt=compile_launcher(clone,root/weapon['source']['file'],root,False)
            clone['weapons'][key]=rebuilt
            levels(clone)
            assert weapon==clone['weapons'][key],(prefab['id'],key,'native source mismatch')
            count=sum(unit['burstShots'] for unit in weapon['remote']['units'])*2
            assert sum(step.get('shots',0)*step.get('repeat',1) for step in weapon['attack']['steps'])==count
            assert all(key in kit['weapons'] for kit in prefab['weaponKits'])
            assert weapon['nativeTiming']['projectiles']==count
            rows.append((prefab,weapon,count))
    lines=['# 浮游兵器接入清单','','由 `python tools/audit-remote-weapons.py` 读取原MOD继承和真实子单元开火队列生成。','',
        '| 机体 | ID | 单元数 | 每位置原生发数（按单元） | 总发数（两个位置） | 原始首发载荷 |',
        '| --- | --- | ---: | --- | ---: | --- |']
    for p,w,count in rows:
        units=w['remote']['units']
        bursts='/'.join(str(unit['burstShots']) for unit in units)
        payload=' + '.join(f'{key} {value:g}' for key,value in w['damageComponents'].items())
        lines.append(f"| {p['name']} | {p['id']} | {len(units)} | {bursts} | {count} | {payload} |")
    lines += ['',
        '- 基准载荷、炮口连射数量和间隔来自每个实际子单元，保存在nativeRemote.unitPayloads和unitBursts。布劳·布罗四个单元分别为2/2/1/1发；有线手炮每只手5发。',
        '- 保留既有两个战术射击位置，每个位置执行一次完整原生连射，不再把整轮伤害统一为4000。再按全局换算、人工差值、25点取整和现有驾驶员/觉醒成长处理。',
        '- 使用原生BeamGun/BeamRifle弹体、命中特效及短光束拖尾。当前已接入子单元未找到持续照射载荷；不能将普通拖尾误作多次伤害。',
        '- 每发由服务端独立裁定。远程单元只参与演出，不生成额外单位、视野或客户端伤害。断臂只禁用本侧所有连射，EN按整次攻击扣除一次。',
        '- 无线单元直接回收；有线单元沿转折路径回收。原MOD只读，此核对不代替浏览器视觉和联机回归。','']
    (ASSETS.parent/'docs/imports/remote-weapons.md').write_text('\n'.join(lines),encoding='utf-8')
    print(f'Native remote source audit passed: {len(rows)} carriers')

if __name__=='__main__':main()
