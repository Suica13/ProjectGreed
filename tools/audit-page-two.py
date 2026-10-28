"""Read-only source checks for newly imported Page_01 combat prefabs."""
import copy
import json
from pathlib import Path
from mod_source import ASSETS, ROOT, load, stat
from native_combat import native_weapon
from unit_energy import capacity_for
from v17_balance import rounded_hp


def main():
    rows=json.loads(Path("tools/0079-page-two-manifest.json").read_text(encoding="utf-8"))
    units=weapons=0
    errors=[]
    for row in rows:
        prefab=json.loads((ASSETS/f"units/{row['id']}/unit.json").read_text(encoding="utf-8"))
        if prefab.get("sourceStats",{}).get("importedTechPage") != 1:
            continue  # Existing prefabs retain the user's previous edits.
        native=load(ROOT/row["source"])
        units+=1
        expected=[rounded_hp(float(native["core"]["maxHp"])*1.25),capacity_for(prefab["id"],stat(native,"enMax")),float(native["core"].get("maxShield",0))]
        actual=[prefab["stats"]["hp"],prefab["stats"]["en"],prefab["shield"]["hp"]]
        if actual!=expected:errors.append([prefab["id"],"resources",actual,expected])
        for key,weapon in prefab["weapons"].items():
            rebuilt=native_weapon(prefab,copy.deepcopy(weapon),native)
            fields=["sourceHit","en","nativeTiming","nativePayload","damageComponents"]
            for field in fields:
                if rebuilt.get(field)!=weapon.get(field):errors.append([prefab["id"],key,field])
            expected_hit=rebuilt["hit"]*(0.9 if prefab["stats"].get("ship") else 1)
            if abs(weapon["hit"]-expected_hit)>0.00001:errors.append([prefab["id"],key,"hit"])
            weapons+=1
    result={"units":units,"weapons":weapons,"errors":errors}
    Path("tools/0079-page-two-audit.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Source audit:", units, "units,", weapons, "weapons,", len(errors), "mismatches")
    if errors:raise SystemExit(1)


if __name__=="__main__":main()
