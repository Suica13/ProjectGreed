"""Stable technology-page era classification, shared by imports and refreshes."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import functools,json
from pathlib import Path

@functools.lru_cache(None)
def eras():
    result={}
    for page,name in [(0,"0079-page-one-manifest.json"),(1,"0079-page-two-manifest.json")]:
        path=Path(__file__).with_name(name)
        if path.exists():
            for row in load_source_json(path.read_text(encoding="utf-8")):
                stardust = any(tech.endswith(("_OperationStardust", "_GPProject")) for tech in row.get("tech", []))
                result.setdefault(row["id"], "0079E" if page == 0 else "0083" if stardust else "0079L")
    return result

def apply(prefab):
    page_two=Path(__file__).with_name("0079-page-two-manifest.json")
    rows=load_source_json(page_two.read_text(encoding="utf-8")) if page_two.exists() else []
    row=next((row for row in rows if row["id"]==prefab["id"]),None)
    if row:
        factions=sorted({tech.split("_")[1] for tech in row.get("tech",[])})
        if len(factions)>1: prefab["availableFactions"]=factions
    mapping=eras(); era="0079L" if prefab["id"] in ("MS_06Z","MSN_01") else mapping.get(prefab["id"])
    if not era:
        parents=sorted(mapping,key=len,reverse=True)
        era=next((mapping[parent] for parent in parents if prefab["id"].startswith(parent+"_")),None)
    if not era and any(tag in ["0079","0079E","0079L"] for tag in prefab["tags"]): era="0079E"
    if era:
        prefab["tags"]=[tag for tag in prefab["tags"] if tag not in ["0079","0079E","0079L","0083"]]+[era]
        prefab.setdefault("sourceStats",{})["technologyEra"]=era
    return prefab
