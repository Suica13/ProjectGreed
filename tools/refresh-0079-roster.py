"""Refresh roster access, native refit/ACE forms and selected balance policies."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json
from pathlib import Path
from mod_source import ASSETS,MOD,load
from native_refits import apply as refits
from native_weapon_names import apply as names
from unit_ship_balance import apply_accuracy

def write(path,value):path.write_text(dump_source_json(value,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
def main():
    catalog=load_source_json((ASSETS/'unit-catalog.json').read_text(encoding='utf8'))
    roster={}
    for ref in catalog['units']:
        p=load_source_json((ASSETS/ref).read_text(encoding='utf8'));roster[p['id']]=p
        refits(p);names(p);apply_accuracy(p)
    for p in roster.values():
        p['pilotForms']=[]
        for r in p.get('refits',[]):
            target=roster.get(r['unitId'])
            if r.get('pilotId') and target and target['id'] != p['id']:
                kits={k['id']:max(target['weaponKits'],key=lambda t:len(set(t['weapons'])&set(k['weapons'])))['id'] for k in p['weaponKits']}
                target['requiredPilotId']=r['pilotId']
                p['pilotForms'].append(dict(pilotId=r['pilotId'],unitId=r['unitId'],kitMap=kits))
    # Ez8 discards its backpack into the matching native no-backpack state.
    from native_conversions import PURGES,attach
    PURGES['RX_79_G_Ez8_WithBackpack']=('armor_purge','RX_79_G_Ez8',0,False)
    for p in roster.values():
        if p['id']=='RX_79_G_Ez8_WithBackpack':attach(p,load(MOD/p['source']))
        write(ASSETS/f"units/{p['id']}/unit.json",p)
    production=load_source_json(Path('shared/production-catalog.json').read_text(encoding='utf8'))
    rows=['# 0079非科技树单位与获取路线','','专用形态随ACE配属自动切换，库存仍归原始机体；取消配属恢复原机体。状态、炮塔与飞行辅助实体不作为独立库存。','','| 单位 | 阵营 | 获取方式 |','| --- | --- | --- |']
    tree=load_source_json(Path('shared/development-tree.json').read_text(encoding='utf8'))
    on_tree={i for nodes in tree.values() for n in nodes for i in n['unlocks']}
    for p in roster.values():
        sources=[s for s in roster.values() if s['id'] != p['id'] and any(r['unitId']==p['id'] for r in s.get('refits',[]))]
        direct=any(o['unitId']==p['id'] for o in production['offers'].values())
        production['baseModels'].setdefault(p['id'],p['id']+'__'+p['weaponKits'][0]['id'])
        p['production']={'enabled':direct and not p.get('formOnly',False) and not p.get('requiredPilotId'),'refitFrom':[s['id'] for s in sources]}
        if p['id'] not in on_tree and not p.get('formOnly'):
            route='原工厂生产（仍需开发或奖励解锁）' if p['production']['enabled'] else '改装来自：'+'、'.join(s['name'] for s in sources) if sources else '无法生产'
            rows.append(f"| {p['id']} · {p['name']} | {next(t for t in p['tags'] if t in ['EFSF','ZEON'])} | {route} |")
        write(ASSETS/f"units/{p['id']}/unit.json",p)
    write(Path('shared/production-catalog.json'),production)
    routes=['# 原MOD库存改装路线','','普通改装消费原机体与表列原生费用；驾驶员专用路线在配属对应ACE时自动转换，不扣费用、不产生目标库存，取消配属恢复原机体。自引用路线不展示。','','| 原机体 | 目标机体 | 原生资金 | 原生物资 | 条件 |','| --- | --- | ---: | ---: | --- |']
    pilots={p['id']:p['name'] for p in load_source_json(Path('shared/pilots.json').read_text(encoding='utf8'))['aces']}
    for p in roster.values():
        for option in p.get('refits',[]):
            if option['unitId']==p['id']:continue
            condition='配属'+pilots.get(option['pilotId'],option['pilotId'])+'时自动转换' if option.get('pilotId') else '未支持的原条件' if option['blocked'] else '目标未移植' if option['unitId'] not in roster else '、'.join(option['unlockUnits']) or '无额外开发条件'
            routes.append(f"| {p['id']} | {option['unitId']} | {option['money']} | {option['supplies']} | {condition} |")
    Path('单位改装路线.md').write_text('\n'.join(routes)+'\n',encoding='utf8')
    Path('0079额外单位与改装列表.md').write_text('\n'.join(rows)+'\n',encoding='utf8')
if __name__=='__main__':main()
