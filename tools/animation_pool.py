"""Store identical converted clips once; retain unit-local clip names and bindings."""
import json
from pathlib import Path
from mod_source import ASSETS


_clips = {}


def share(prefab):
    base = ASSETS / "units" / prefab["id"]
    folder = ASSETS / "animations"
    for clip, reference in prefab["animations"].items():
        animation = json.loads((base / reference).read_text(encoding="utf-8"))
        encoded = json.dumps(animation, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
        if clip not in _clips:
            _clips[clip] = {}
            for existing in sorted(folder.glob(clip + "*.json")):
                if existing.stem == clip or existing.stem.startswith(clip + "__"):
                    content = json.loads(existing.read_text(encoding="utf-8"))
                    key = json.dumps(content, sort_keys=True, ensure_ascii=False, separators=(",", ":"))
                    _clips[clip].setdefault(key, existing)
        target = _clips[clip].get(encoded)
        if target is None:
            target = folder / (clip + ".json")
            if target.exists():
                target = folder / (clip + "__" + prefab["id"] + ".json")
            if target.exists():
                raise ValueError("Conflicting animation variant: " + str(target))
            target.write_text(json.dumps(animation, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
            _clips[clip][encoded] = target
        prefab["animations"][clip] = "../../animations/" + target.name
    return prefab


def refresh():
    references = set()
    for file in (ASSETS / "units").glob("*/unit.json"):
        prefab = share(json.loads(file.read_text(encoding="utf-8")))
        file.write_text(json.dumps(prefab, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        references.update((file.parent / ref).resolve() for ref in prefab["animations"].values())
    folder = (ASSETS / "animations").resolve()
    removed = 0
    for file in folder.glob("*.json"):
        # Remove only unused per-unit/generated shared clips, never hand-authored templates.
        if ("__" in file.name or file.name.startswith("shared_")) and file.resolve() not in references:
            assert file.resolve().parent == folder
            file.unlink()
            removed += 1
    print("Shared animation files:", len(references), "unused copies removed:", removed)


if __name__ == "__main__":
    refresh()
