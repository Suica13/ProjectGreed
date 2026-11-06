"""Native EquipmentIndex zero is the default, independently from license pricing."""
import json, re
from weapon_store import loads
from mod_source import ASSETS, MOD, load
from native_weapon_layout import conditions

def collect():
 result={}
 for reference in json.loads((ASSETS/"unit-catalog.json").read_text(encoding="utf-8"))["units"]:
  p=loads((ASSETS/reference).read_text(encoding="utf-8"))
  root=MOD/p["source"].split("/",1)[0]
  native=load(MOD/p["source"],root=root)
  indices={}
  for key,weapon in p["weapons"].items():
   values={int(m[1]) for c in conditions(native,weapon) for m in re.finditer(r"\bEquipmentIndex\s*==\s*(\d+)",c)}
   if len(values)==1:indices[key]=next(iter(values))
  kits=[k for k in p["weaponKits"] if {indices[w] for w in k["weapons"] if w in indices}=={0}]
  result[p["id"]]=(kits or p["weaponKits"])[0]["id"]
 return result

if __name__=="__main__":
 file=ASSETS.parent/"shared/production-catalog.json"
 data=json.loads(file.read_text(encoding="utf-8"));data["defaultKits"]=collect();data["equipmentPolicy"]="counted-chassis-and-kits"
 file.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8",newline="\n")
 print("Updated native default equipment:",len(data["defaultKits"]))
