"""Unit identification and hangar definitions read from native transport attachments."""
import functools
import re
from mod_source import ROOT, MAIN, load, section

LOAD_TAGS = {"CanLoadInto", "CanLoadIntoSpace", "CanLoadIntoAir", "Human"}

@functools.lru_cache(None)
def hangar_sources():
    result = {}
    for root, directory in [(MAIN, MAIN / "Units/CommonUnit/Hangar"), (ROOT, ROOT / "Units/BattleUnits/HimalayaClass")]:
        for path in sorted(directory.glob("*.ini")):
            native = load(path, root)
            result[native["core"]["name"]] = (path, native)
    return result

def correct(prefab, native):
    raw = {t.strip() for t in native["core"].get("tags", "").split(",") if t.strip()}
    movement = prefab["stats"].get("movementType", "ground")
    if "Army_Squad" in raw or "Human" in raw:
        kind = "Infantry"
    elif prefab["stats"].get("ship") or "Ship" in raw:
        kind = "Ship"
    elif "MS" in raw:
        kind = "MS"
    elif "MA" in raw:
        kind = "MA"
    elif "MP" in raw:
        kind = "MobilePod"
    elif "Heli" in prefab["id"]:
        kind = "Helicopter"
    elif "Aircraft" in raw or movement == "air":
        kind = "Aircraft"
    elif "Tank" in raw:
        kind = "Vehicle" if any(token in prefab["id"] for token in ["APC", "Truck", "Type74", "Wappa", "Cui", "MissileCar"]) else "Tank"
    else:
        kind = "Vehicle"
    tags = [kind]
    if kind in ["Tank", "Helicopter"]:
        tags.append("Vehicle" if kind == "Tank" else "Aircraft")
    if movement == "amphibious": tags.append("Amphibious")
    if movement == "hover": tags.append("Hover")
    if movement == "air" and "Aircraft" not in tags: tags.append("Aircraft")
    if prefab["stats"].get("supplyAura") or any(skill["type"] == "repair" for skill in prefab.get("skills", [])): tags.append("Support")
    if any(skill["type"] == "recon" for skill in prefab.get("skills", [])): tags.append("Recon")
    eligibility = set(raw & LOAD_TAGS)
    for values in native.values():
        eligibility.update(t.strip() for t in values.get("temporarilyAddTags", "").split(",") if t.strip() in LOAD_TAGS)
    if kind == "Infantry": eligibility.add("Human")
    prefab["unitTags"] = tags
    prefab["transport"] = {"slotCost": int(float(native["core"].get("transportSlotsNeeded", 1))), "loadTags": sorted(eligibility)}
    hangars = []
    for key in native:
        values = section(native, key)
        spawn = values.get("attachments_addNewUnits", "")
        if "Hangar" not in spawn: continue
        name = re.match(r"[A-Za-z0-9_]+", spawn)[0]
        if name not in hangar_sources(): raise ValueError("Unknown hangar: " + name)
        path, source = hangar_sources()[name]
        core = source["core"]
        attachment = values.get("attachments_onlyOnSlots", key.removeprefix("hiddenAction_attachment_"))
        hangars.append({"id": attachment, "name": "格纳库 " + str(len(hangars)+1),
            "capacity": int(core["maxTransportingUnits"]),
            "allowedTags": [t.strip() for t in core["transportUnitsRequireTag"].split(",") if t.strip()],
            "launchRange": 1, "emergencyRange": 3,
            "source": path.relative_to(MAIN if path.is_relative_to(MAIN) else ROOT).as_posix(), "sourceUnit": name})
    prefab["hangars"] = hangars
    if hangars and "Transport" not in tags: tags.append("Transport")
    for mechanic in prefab.get("mechanics", []):
        if mechanic["id"] == "LaunchAllUnits":
            mechanic.update(status="adapted", name="格纳库：搭载、逐台出击与舰毁紧急退出（整备和独立舱体损坏待接入）")
