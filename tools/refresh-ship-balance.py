"""Refresh only native ship stats and weapon policies; validate before writing."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import json
from mod_source import ASSETS, MOD, load
from weapon_policy import configure


def main():
    pending = []
    for path in sorted((ASSETS / "units").glob("*/unit.json")):
        prefab = load_source_json(path.read_text(encoding="utf8"))
        if not prefab["stats"].get("ship"):
            continue
        root_name, reference = prefab["source"].split("/", 1)
        root = MOD / root_name
        native = load(root / reference, root=root)
        configure(prefab, native)
        pending.append((path, prefab))
    for path, prefab in pending:
        path.write_text(dump_source_json(prefab, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
    print("Updated ship prefabs:", len(pending))


if __name__ == "__main__":
    main()
