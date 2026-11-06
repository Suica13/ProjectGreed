"""Technology-page era classification shared by imports and refreshes."""
from weapon_store import loads as load_source_json
import functools
import json
import re
from pathlib import Path

ERA_TAG = re.compile(r"\d{4}(?:[EL]|T[12])?")

@functools.lru_cache(None)
def eras():
    result = {}
    for page, name in [(0, "0079-page-one-manifest.json"), (1, "0079-page-two-manifest.json")]:
        path = Path(__file__).with_name(name)
        if path.exists():
            for row in load_source_json(path.read_text(encoding="utf-8")):
                stardust = any(tech.endswith(("_OperationStardust", "_GPProject")) for tech in row.get("tech", []))
                result.setdefault(row["id"], "0079T1" if page == 0 else "0083" if stardust else "0079T2")
    tree = Path(__file__).resolve().parents[1] / "shared/development-tree.json"
    for nodes in json.loads(tree.read_text(encoding="utf-8")).values():
        for node in nodes:
            if not node["id"].startswith(("Tech_AEUG_0087_", "Tech_TITANS_0087_", "Tech_NEO_ZEON_0087_")):
                continue
            era = "0087T2" if node.get("page") else "0087T1"
            for ident in node.get("unlocks", []):
                result[ident] = min(result.get(ident, era), era)
    return result

def apply(prefab):
    page_two = Path(__file__).with_name("0079-page-two-manifest.json")
    rows = load_source_json(page_two.read_text(encoding="utf-8")) if page_two.exists() else []
    row = next((row for row in rows if row["id"] == prefab["id"]), None)
    if row:
        factions = sorted({tech.split("_")[1] for tech in row.get("tech", [])})
        if len(factions) > 1:
            prefab["availableFactions"] = sorted(set(factions + prefab.get("availableFactions", [])))
    mapping = eras()
    era = "0079T2" if prefab["id"] in ("MS_06Z", "MSN_01") else mapping.get(prefab["id"])
    tags = prefab.get("tags", [])
    if era and era.startswith("0087") and not prefab.get("source", "").startswith("GW_BattleUniverse_DLC_0087/"):
        era = next(({"0079E": "0079T1", "0079L": "0079T2"}.get(tag, tag) for tag in tags if tag in ["0079E", "0079L", "0079T1", "0079T2", "0083"]), era)
    if not era:
        parents = sorted(mapping, key=len, reverse=True)
        era = next((mapping[parent] for parent in parents if prefab["id"].startswith(parent + "_")), None)
    if not era and any(tag in ["0079", "0079E", "0079L", "0079T1", "0079T2"] for tag in tags):
        era = "0079T1"
    if era:
        prefab["tags"] = [tag for tag in tags if not ERA_TAG.fullmatch(tag)] + [era]
        prefab.setdefault("sourceStats", {})["technologyEra"] = era
    return prefab
