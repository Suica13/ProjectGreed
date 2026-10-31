"""User-confirmed names; Common is a shared weapon family, not part of its label."""
import re

EXACT = {
    "EF_BeamSprayGunB2": ("光束喷枪", "Beam Spray Gun", "ビーム・スプレーガン"),
    "EF_LongRifle": ("长距离步枪", "Long-Range Rifle", "ロング・ライフル"),
    "ZN_MSM_03_ChestBeam": ("胸部光束扩散炮", "Chest Diffusion Beam Cannon", "胸部拡散ビーム砲"),
    "ZN_Wappa_C4": ("投掷C4", "Throw C4", "C4投擲"),
    "Common_DoubleMS_ZN_APC": ("导弹发射器", "Missile Launcher", "ミサイルランチャー"),
    "EF_Railgun_79_D_RG": ("电磁炮", "Railgun", "レールガン"),
    "EF_FA_78_2_FrameLauncher_GL": ("下挂榴弹发射器", "Underbarrel Grenade Launcher", "アンダーバレル・グレネードランチャー"),
    "ZN_4XMSL": ("4X导弹货柜", "4X Missile Container", "4連装ミサイルコンテナ"),
}

def label(key, weapon, ship=False):
    # Strip physical left/right copies without treating MS model names as missiles.
    ident = re.sub(r"_(?:L|R)$", "", weapon.get("sourceName", key))
    if ident in EXACT:
        return EXACT[ident]
    if "BeamGun" in ident:
        if "ShieldBeamGun" in ident:
            return ("盾牌光束枪", "Shield Beam Gun", "シールド・ビームガン")
        if "BOWA" in ident:
            return ("BOWA光束枪", "BOWA Beam Gun", "BOWAビーム・ガン")
        return ("光束枪", "Beam Gun", "ビーム・ガン")
    if re.search(r"Turret_?AA(?:_|$)", ident):
        return ("对空机枪", "Anti-Air Machine Gun", "対空機銃")
    if re.search(r"Turret_?CN(?:_|$)", ident):
        return ("加农炮", "Cannon", "カノン砲")
    if re.search(r"(?:^|_)BG(?:_|$)", ident):
        return ("光束炮", "Beam Cannon", "ビーム砲")
    if ship and re.search(r"(?:^|_)AMS(?:_|$)", ident):
        return ("反MS导弹", "Anti-MS Missiles", "対MSミサイル")
    for token, names in {
        "DoubleMS": ("双重导弹发射器", "Double Missile Launcher", "二連装ミサイルランチャー"),
        "DoubleBR": ("双重光束枪", "Double Beam Gun", "二連装ビームガン"),
        "DoubleGL": ("双重榴弹", "Double Grenades", "二連装グレネード"),
        "LegMS": ("腿部导弹发射器", "Leg Missile Launcher", "脚部ミサイルランチャー"),
        "ArmGL": ("腕部榴弹发射器", "Wrist Grenade Launcher", "腕部グレネードランチャー"),
        "ArmBR": ("腕部光束枪", "Wrist Beam Gun", "腕部ビームガン"),
        "ArmMG": ("腕部机枪", "Wrist Machine Gun", "腕部機関銃"),
        "ArmMS": ("腕部导弹发射器", "Wrist Missile Launcher", "腕部ミサイルランチャー"),
    }.items():
        if re.search(token.replace("Arm", "Arm_?"), ident):
            return names
    if ident.startswith("Common_Grenade_"):
        return (("燃烧手雷", "Incendiary Grenade", "焼夷手榴弾") if "Burned" in ident
                else ("手雷", "Grenade", "手榴弾"))
    return None

def apply(prefab):
    for key, weapon in prefab.get("weapons", {}).items():
        names = label(key, weapon, prefab.get("stats", {}).get("ship", False))
        if not names:
            continue
        previous = weapon["name"]
        weapon["name"] = names[0]
        for lang, name in zip(("zh", "en", "ja"), names):
            weapon.setdefault("localization", {}).setdefault(lang, {})["name"] = name
        # Rename a generated kit label only when it is exactly its old weapon label.
        for kit in prefab.get("weaponKits", []):
            if kit.get("weapons", [None])[0] == key and kit.get("name") == previous + "套件":
                kit["name"] = names[0] + "套件"
                for lang, name, suffix in zip(("zh", "en", "ja"), names, ("套件", " Kit", "装備")):
                    kit.setdefault("localization", {}).setdefault(lang, {})["name"] = name + suffix
    return prefab
