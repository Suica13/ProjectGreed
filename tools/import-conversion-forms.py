"""Import required playable armor variants and non-selectable conversion results."""
import importlib.util,json
from pathlib import Path
from mod_source import ROOT,ASSETS,load
spec=importlib.util.spec_from_file_location("bulk",Path(__file__).with_name("import-0079-page-one.py"))
bulk=importlib.util.module_from_spec(spec);spec.loader.exec_module(bulk)
UNITS={"MTank_Top":("马哲兰顶部战斗机","ZEON",True),"MTank_Chassis":("马哲兰底盘","ZEON",True),
 "YMT_05_ModeB":("斗狼［形态B］","ZEON",True),"RX_78NT_1":("高达NT-1","EFSF",False),
 "RX_78NT_1_FA":("高达NT-1［全装甲］","EFSF",False),"FA_78_1":("全装甲高达","EFSF",False),"FA_78_1_NA":("全装甲高达［去甲］","EFSF",True)}

def main():
 catalog=bulk.read(ASSETS/"unit-catalog.json");effects=bulk.read(ASSETS/"effects/effects.json")
 for ident,(name,faction,form) in UNITS.items():
  source=bulk.INDEX[ident];data=load(source);tags=data["core"].get("tags","")
  if "AirUnit" in tags:tags+=",Aircraft"
  row={"id":ident,"name":name,"faction":faction,"tags":tags,"source":source.relative_to(ROOT).as_posix()}
  unit=bulk.build(row,effects)
  if form:unit.update(formOnly=True)
  bulk.write(ASSETS/f"units/{ident}/unit.json",unit)
  ref=f"units/{ident}/unit.json"
  if ref not in catalog["units"]:catalog["units"].append(ref)
  print("Imported",ident,"formOnly",form)
 bulk.write(ASSETS/"effects/effects.json",effects);bulk.write(ASSETS/"unit-catalog.json",catalog)
 from refresh_weapon_skills import refresh
 refresh()
if __name__=="__main__":main()
