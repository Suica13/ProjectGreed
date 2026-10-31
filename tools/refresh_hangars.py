"""Refresh only unit identification and hangar metadata; never reimport artwork or weapons."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json
from mod_source import ROOT, ASSETS, load
from native_hangars import correct

def refresh():
    units = carriers = 0
    updates = []
    for path in sorted((ASSETS / "units").glob("*/unit.json")):
        prefab = load_source_json(path.read_text(encoding="utf-8"))
        correct(prefab, load(ROOT / prefab["source"].split("/", 1)[1]))
        updates.append((path, dump_source_json(prefab, ensure_ascii=False, indent=2) + "\n"))
        units += 1
        carriers += bool(prefab["hangars"])
    for path, text in updates:
        path.write_text(text, encoding="utf-8")
    print(f"Updated {units} unit definitions; {carriers} carriers with native hangars.")

if __name__ == "__main__": refresh()
