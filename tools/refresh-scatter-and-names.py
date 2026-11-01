"""Refresh named weapon families and native scatter chains without reimporting unit art."""
import json, re, sys
from pathlib import Path
from mod_source import ASSETS, MOD, load
from weapon_store import loads, dumps
from native_weapon_names import apply as apply_names, label
from native_combat import native_weapon
from unit_ship_balance import apply_hull, apply_damage, apply_accuracy, apply_anti_air

def named(key, weapon):
    ident=weapon.get("sourceName",key)
    return bool(re.search(r"BeamRifle|(?:^|_)BR(?:_|$)|\d+mmMG|(?:Bazooka|BZ)_(?:SG|ShotgunMode)|Shotgun",ident,re.I)) and not re.search(r"(?:Arm|Double|Hand)_?BR",ident)
def scatter(weapon):
    return bool(re.search(r"Shotgun|(?:Bazooka|BZ)_SG",weapon.get("sourceName",""),re.I))
def main():
    sys.stdout.reconfigure(encoding="utf8")
    library=ASSETS/"weapons.json";data=json.loads(library.read_text(encoding="utf8"))
    for key,w in data["definitions"].items():
        names=label(key,w) if named(key,w) else None
        if names:
            w["name"]=names[0]
            for lang,name in zip(("zh","en","ja"),names):w.setdefault("localization",{}).setdefault(lang,{})["name"]=name
    library.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
    registry=json.loads((ASSETS/"unit-catalog.json").read_text(encoding="utf8"))
    changed=[];scatter_units=[];ships=[]
    for ref in registry["units"]:
        path=ASSETS/ref;before=path.read_text(encoding="utf8");p=loads(before)
        native=None
        for w in p["weapons"].values():
            if scatter(w):
                native=native or load(MOD/p["source"])
                native_weapon(p,w,native)
                scatter_units.append(p["id"]+"/"+w["sourceName"])
        weapons=p["weapons"]
        p["weapons"]={k:w for k,w in weapons.items() if named(k,w)}
        apply_names(p);p["weapons"]=weapons
        if p["source"].startswith("GW_BattleUniverse_DLC_0087/") and p["stats"].get("ship"):
            apply_hull(p,p["sourceStats"]["hp"]);apply_anti_air(p);apply_damage(p);apply_accuracy(p)
            ships.append(p["id"])
        after=dumps(p,ensure_ascii=False,indent=2)+"\n"
        if after!=before:path.write_text(after,encoding="utf8");changed.append(p["id"])
    print("Updated",len(changed),"units;",len(scatter_units),"scatter mounts;",len(ships),"0087 ships")
    print("Scatter:",", ".join(scatter_units))
if __name__=="__main__":main()
