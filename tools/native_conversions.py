"""Plain conversion configuration shared by importers and unit refresh."""
import json
from mod_source import ASSETS

# source -> (kind, target, HP/EN recovery percent, fully repair parts)
PURGES = {
    "RX_78NT_1_FA": ("armor_purge", "RX_78NT_1", 35, False),
    "FA_78_1": ("armor_purge", "FA_78_1_NA", 35, False),
    "FF_X7Bst": ("armor_purge", "FF_X7", 100, False),
    "RX_79_G_Ez8_WithBackpack": ("armor_purge", "RX_79_G_Ez8", 0, False),
    "RX_79_G_WithBackpack": ("armor_purge", "RX_79_G", 0, False),
}

def result(unit_id, prefab, recovery=0, repair=False, inherit=True):
    path=ASSETS / "units" / unit_id / "unit.json"
    if not path.exists(): return None
    target=json.loads(path.read_text(encoding="utf-8"))
    kits={k["id"]:max(target["weaponKits"],key=lambda t:len(set(k["weapons"])&set(t["weapons"])))["id"] for k in prefab["weaponKits"]}
    return dict(unitId=unit_id,kitId=target["weaponKits"][0]["id"],kitMap=kits,
        inheritResources=inherit,hpRecoveryPercent=recovery,enRecoveryPercent=recovery,
        shieldRecoveryPercent=0,repairAllParts=repair)

def attach(prefab,native):
    ident=prefab["id"]
    for skill in prefab.get("skills",[]):
        if skill["type"]=="escape":skill.update(range=1,minRange=1)
    kind=target=None
    if ident in PURGES:kind,target,recovery,repair=PURGES[ident]
    elif ident in ["YMT_05","YMT_05_ModeB"]:
        kind="transform";target="YMT_05_ModeB" if ident=="YMT_05" else "YMT_05";recovery=0;repair=False
    elif ident=="FA_78_1_NA":kind="escape";target="FF_X7";recovery=100;repair=True
    elif ident=="MTank":kind="escape";target="MTank_Top";recovery=100;repair=True
    if not kind and not any(s.get('type') in ('escape', 'armor_purge') for s in prefab.get('skills', [])):
        import re
        action = native.get('action_ExitUnit', {})
        step = native.get('hiddenAction_ExitUnit_Step2', {})
        spawn = re.fullmatch(r'(\w+)\*1(?:\(.*\))?', action.get('spawnUnits', ''))
        if spawn and step.get('deleteSelf', '').lower() == 'true':
            kind, target, recovery, repair = 'escape', spawn[1], 100, True
        elif step.get('convertTo') and (ASSETS / 'units' / step['convertTo'] / 'unit.json').exists():
            kind, target, repair = 'armor_purge', step['convertTo'], False
            message = native.get('hiddenAction_Send_TryTransform_ExitUnit', {}).get('sendMessageWithData', '')
            match = re.search(r'RecoverHpPer=([0-9.]+)', message)
            recovery = float(match[1]) * 100 if match else 0
    if not kind:return
    config=result(target,prefab,recovery,repair,kind!="escape")
    if config is None:return
    name={"transform":"变形","armor_purge":"爆甲","escape":"脱出"}[kind]
    skill=dict(id="Transform" if kind=="transform" else "ExitUnit",type=kind,name=name,
        localization={"zh":{"name":name},"en":{"name":{"transform":"Transform","armor_purge":"Armor Purge","escape":"Eject"}[kind]},"ja":{"name":{"transform":"変形","armor_purge":"装甲パージ","escape":"脱出"}[kind]}},
        range=1 if kind=="escape" else 0,minRange=1 if kind=="escape" else 0,
        maxUses=99 if kind=="transform" else 1,consumeAction=kind=="transform",
        **({"actionCost":1} if kind!="transform" else {}),
        effect="Light_75_NotAttached",sound={"file":"../../sounds/Transform_4.ogg","volume":.6},
        nativeAction="action_Transform_LandLand_TankB" if ident=="YMT_05" else "action_Transform_LandLand_TankA" if ident=="YMT_05_ModeB" else "action_ExitUnit")
    if kind=="escape":
        skill.update(source={"mode":"remove"},spawn=config)
        if ident=="MTank":
            chassis=result("MTank_Chassis",prefab,100,True,False)
            if chassis is None:return
            skill["source"]={"mode":"transform",**chassis}
    else:skill["source"]={"mode":"transform",**config}
    prefab["skills"]=[s for s in prefab.get("skills",[]) if s["id"]!=skill["id"]]+[skill]
    for mechanic in prefab.get("mechanics",[]):
        if "ExitUnit" in mechanic["id"] or "Transform_LandLand_Tank" in mechanic["id"]:
            mechanic.update(status="adapted",name=name+"：原生形态转换，资源与部位规则使用显式配置")


def apply_action_cost(prefab):
    """Ejection and armor purge spend one AP and retain the remaining turn."""
    for skill in prefab.get("skills", []):
        if skill.get("type") in ("escape", "armor_purge"):
            skill.update(actionCost=1, consumeAction=False)
    return prefab
