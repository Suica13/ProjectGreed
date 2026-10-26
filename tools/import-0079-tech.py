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

def import_faction(root, faction):
    tree = root / "Units" / "TechTree"
    page = read(tree / "Core" / "Faction" / f"{faction}_0079" /
                f"TechTree_UI_Page_{faction}_0079_00.ini")
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
            "points": int(find(r"_TechPoint=(\d+)", awake, f"{tech_id} tech points")),
            "requires": [item for item in requires if "_Start" not in item],
            "unlocks": list(dict.fromkeys(re.findall(r"@define UnitID=(\w+)", info))),
        })
    ids = {node["id"] for node in nodes}
    for node in nodes:
        node["requires"] = [item for item in node["requires"] if item in ids]
    return nodes

def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    root = Path(sys.argv[1])
    result = {faction: import_faction(root, faction) for faction in ("EFSF", "ZEON")}
    output = Path(__file__).resolve().parents[1] / "shared" / "development-tree.json"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {output}: " + ", ".join(f"{key} {len(value)} nodes" for key, value in result.items()))

if __name__ == "__main__":
    main()


