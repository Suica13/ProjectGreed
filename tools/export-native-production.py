"""Read native factory batch sizes; never write original MOD files."""
import importlib.util,json,sys
from pathlib import Path
from mod_source import MOD,load,section
from weapon_store import loads
root=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("production_import",root/"tools/import-production.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
offers={}
for dlc in sorted(MOD.glob("GW_BattleUniverse_DLC_*")):
    if not (dlc/"Units/Buildings/Factory/UnitList/Mod/UnitTemplate.ini").exists():continue
    for key,rows in module.factory_offers(dlc).items():offers.setdefault(key,[]).extend(rows)
result={}
for ref in json.loads((root/"assets/unit-catalog.json").read_text(encoding="utf8"))["units"]:
    p=loads((root/"assets"/ref).read_text(encoding="utf8"))
    native=load(MOD/p["source"])
    native_id=section(native,"core").get("name",p["id"])
    rows=offers.get((p["id"],0),[]) or offers.get((native_id,0),[])
    if not rows:rows=[r for (unit,index),values in offers.items() if unit in (p["id"],native_id) for r in values]
    normal=[r for r in rows if "Fast" not in r["source"]["file"] and "_Fast" not in r["source"]["action"]]
    rows=normal or rows
    def quantity(row):return sum(o["quantity"] for o in row["source"]["outputs"] if o["unitId"] in (p["id"],native_id))
    if rows:
        row=max(rows,key=quantity)
        if quantity(row)>0:result[p["id"]]={"quantity":quantity(row),"source":row["source"]["file"],"action":row["source"]["action"]}
(root/"shared/native-production.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf8")
print("Native production metadata:",len(result),"units; single output:",sum(r["quantity"]==1 for r in result.values()))
