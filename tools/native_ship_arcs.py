"""Read native module traverse limits and preserve attachment heading."""
import functools
from mod_source import ROOT, load, section

@functools.lru_cache(None)
def index():
    return {p.stem:p for p in (ROOT / "Units/BattleUnits").rglob("*.ini")}

def module_source(native, module):
    key = "attachment_" + module["id"]
    attachment = section(native, key)
    spawn = attachment.get("onCreateSpawnUnitOf") or native.get("hiddenAction_" + key, {}).get("attachments_addNewUnits", "")
    name = spawn.split("*")[0].split("(")[0].strip()
    path = index().get(name)
    if not path:
        raise ValueError("Missing native turret: " + module["id"])
    return attachment, load(path), path


def correct_arcs(prefab, native):
    for module in prefab["stats"].get("modules", []):
        attachment, data, path = module_source(native, module)
        name = path.stem
        turrets = [section(data,k) for k in data if k.startswith("turret_") and section(data,k).get("projectile") not in [None,"IGNORE"]]
        # Bridges and other passive modules never traverse.
        # A mortar marker can be inherited before the actual rotating cannon.
        # Prefer the module's own turret, never its targeting guide turret.
        own = "turret_" + data["core"].get("name", name)
        turret = section(data, own) if own in data else turrets[0] if turrets else {"limitingAngle": 0}
        module["idleDir"] = float(attachment.get("idleDir",0)) + float(turret.get("idleDir",0))
        limit = float(turret.get("limitingAngle",180))
        module["arc"] = 180 if limit < 0 else min(180,limit)
        prefab["skeleton"][module["bone"]]["endDirOffset"] = module["idleDir"]
