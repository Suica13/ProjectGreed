"""Refresh only unit identification and hangar metadata; never reimport artwork or weapons."""
import json
from mod_source import ROOT, ASSETS, load
from native_hangars import correct

def refresh():
    units = carriers = 0
    updates = []
    for path in sorted((ASSETS / "units").glob("*/unit.json")):
        prefab = json.loads(path.read_text(encoding="utf-8"))
        correct(prefab, load(ROOT / prefab["source"].split("/", 1)[1]))
        updates.append((path, json.dumps(prefab, ensure_ascii=False, indent=2) + "\n"))
        units += 1
        carriers += bool(prefab["hangars"])
    for path, text in updates:
        path.write_text(text, encoding="utf-8")
    print(f"Updated {units} unit definitions; {carriers} carriers with native hangars.")

if __name__ == "__main__": refresh()
