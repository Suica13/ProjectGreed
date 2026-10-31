"""Refresh only environment compatibility; do not reimport artwork or weapons."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json
from mod_source import ROOT, ASSETS, load
from native_mobility import correct

def refresh():
    updates=[]
    for path in sorted((ASSETS / "units").glob("*/unit.json")):
        prefab=load_source_json(path.read_text(encoding="utf-8"))
        correct(prefab,load(ROOT / prefab["source"].split("/",1)[1]))
        updates.append((path,dump_source_json(prefab,ensure_ascii=False,indent=2)+"\n"))
    for path,text in updates: path.write_text(text,encoding="utf-8")
    print(f"Updated environment compatibility for {len(updates)} prefabs.")
if __name__ == "__main__": refresh()
