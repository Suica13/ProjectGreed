"""Import the original 0079 Page 00 tech nodes into a portable JSON catalog.

Usage: python tools/import-0079-tech.py PATH_TO_GW_BattleUniverse_DLC_0079
The generated JSON is checked in; normal builds do not need the MOD checkout.
"""
import json
import re
import shutil
import sys
from pathlib import Path

def read(path):
    return path.read_text(encoding="utf-8")

def find(pattern, source, context):
    match = re.search(pattern, source, re.MULTILINE | re.DOTALL)
    if not match:
        raise ValueError(f"Missing {context}")
    return match.group(1).strip()

def import_faction(root, faction, page_number=0):
    tree = root / "Units" / "TechTree"
    page = read(tree / "Core" / "Faction" / f"{faction}_0079" /
                f"TechTree_UI_Page_{faction}_0079_{page_number:02d}.ini")
    tech_list = read(tree / "Tech" / "Faction" / f"{faction}_0079" /
                     f"TechList_{faction}_0079.ini")
    marker_dir = tree / "Tech" / "Faction" / f"{faction}_0079" / "Common"
    slots = re.findall(
        r"\[attachment_Tech_(Mid|Top|Bot)_(\d+)\]"
        r"(?:(?!\[attachment_Tech_)[\s\S])*?onCreateSpawnUnitOf:(Tech_\w+)\*1",
        page,
    )
    if not slots:
        raise ValueError(f"No {faction} Page 00 tech slots found")
    nodes = []
    for row, column, tech_id in slots:
        marker = marker_dir / f"{tech_id}.ini"
        if not marker.exists():
            marker = marker_dir / f"{tech_id}.ini.ini"  # Original ZEON filename typo.
        info = read(marker)
        icon_source = root / find(r"^@global IconImage=ROOT:([^\r\n]+)", info, f"{tech_id} icon")
        icon_target = Path(__file__).resolve().parents[1] / "assets" / "tech-icons" / f"{tech_id}.png"
        icon_target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(icon_source, icon_target)
        awake = find(
            rf"\[hiddenAction_{re.escape(tech_id)}_Awake\]([\s\S]*?)(?=\[hiddenAction_|\Z)",
            tech_list,
            f"{tech_id} cost section",
        )
        unlocked = find(r"^@global Unlocked=([^\r\n]+)", info, f"{tech_id} prerequisite")
        requires = list(dict.fromkeys(re.findall(r"Tech_\w+", unlocked)))
        nodes.append({
            "id": tech_id,
            "name": find(r"^displayText_zh:([^\r\n]+)", info, f"{tech_id} name"),
            "description": find(r"^displayDescription_zh:([^\r\n]+)", info, f"{tech_id} description"),
            "icon": f"assets/tech-icons/{tech_id}.png",
            "row": row.lower(),
            "column": int(column),
            "money": int(find(r"_Money=(\d+)", awake, f"{tech_id} money")) * 2,
            "supplies": int(find(r"_Resource=(\d+)", awake, f"{tech_id} supplies")) * 2,
            "sourceCosts": {
                "money": int(find(r"_Money=(\d+)", awake, f"{tech_id} money")),
                "supplies": int(find(r"_Resource=(\d+)", awake, f"{tech_id} supplies")),
                "points": int(find(r"_TechPoint=(\d+)", awake, f"{tech_id} points")),
                "researchSeconds": int(find(r"_Time=(\d+)", awake, f"{tech_id} time")),
            },
            "points": int(find(r"_TechPoint=(\d+)", awake, f"{tech_id} tech points")),
            "requires": [item for item in requires if "_Start" not in item],
            "unlocks": list(dict.fromkeys(re.findall(r"@define UnitID=(\w+)", info))),
        })
    for node in nodes:
        node["page"] = page_number
        node["era"] = "0079E" if page_number == 0 else "0083" if node["id"].endswith(("_GPProject", "_OperationStardust")) else "0079L"
    return nodes

def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1])
    output = Path(__file__).resolve().parents[1] / "shared" / "development-tree.json"
    result = json.loads(output.read_text(encoding="utf-8")) if output.exists() else {"EFSF":[],"ZEON":[]}
    for faction in ("EFSF","ZEON"):
        existing = {node["id"]:node for node in result[faction]}
        for page_number in (0,1):
            for node in import_faction(root,faction,page_number):
                if node["id"] in existing:
                    existing[node["id"]].update(page=page_number,era=node["era"])
                else:
                    result[faction].append(node)
                    existing[node["id"]]=node
        for node in result[faction]:
            unknown=[ident for ident in node["requires"] if ident not in existing]
            if unknown: raise ValueError("Missing technology prerequisite: "+str(unknown))
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}: " + ", ".join(f"{key} {len(value)} nodes" for key, value in result.items()))

if __name__ == "__main__":
    main()


