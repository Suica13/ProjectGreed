"""Import Page_00 named pilot profiles and icons; MOD files are read-only."""

import argparse
import hashlib
import json
import re
import shutil
from pathlib import Path

from mod_source import ROOT, parse

PROJECT = Path(__file__).resolve().parents[1]
MANIFEST = PROJECT / "tools/0079-page-one-manifest.json"
DEST = PROJECT / "assets/pilots"
STATS = {
    "shooting": "pilotShootSkill",
    "melee": "pilotCqbSkill",
    "defense": "pilotDefSkill",
    "speed": "pilotSpeedSkill",
    "accuracy": "pilotAccuracySkill",
    "reaction": "pilotReactionSkill",
    "leadership": "pilotLeadershipSkill",
    "awakening": "pilotAwakeningSkill",
}


def import_common_portraits():
    """Import the generic portrait icons, not ACE icons or tiny battlefield sprites."""
    DEST.mkdir(parents=True, exist_ok=True)
    portraits = []
    groups = [("Common", "普通驾驶员", 3), ("Ground", "地面驾驶员", 2),
              ("GroundArmy", "陆军驾驶员", 1), ("Officer", "军官", 2)]
    for faction, faction_name in [("EFSF", "联邦"), ("ZEON", "吉翁")]:
        for group, title, count in groups:
            for number in range(1, count + 1):
                ident = f"Pilot_{faction}_0079_{group}_{number}"
                reference = f"Resource/Image/Units/Icon/{ident}.png"
                source = ROOT / reference
                image = source.read_bytes()
                if not image.startswith(bytes.fromhex("89504e470d0a1a0a")):
                    raise ValueError("Invalid ordinary pilot portrait: " + str(source))
                shutil.copyfile(source, DEST / (ident + ".png"))
                portraits.append({"id": ident, "name": f"{faction_name}{title} {number}",
                    "faction": faction, "source": reference,
                    "sourceSha256": hashlib.sha256(image).hexdigest(),
                    "icon": "assets/pilots/" + ident + ".png"})
    return portraits


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portraits-only", action="store_true", help="Update only ordinary portrait candidates.")
    options = parser.parse_args()
    portraits = import_common_portraits()
    if options.portraits_only:
        target = PROJECT / "shared/pilots.json"
        data = json.loads(target.read_text(encoding="utf-8"))
        data["portraits"] = portraits
        target.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Imported {len(portraits)} ordinary portrait candidates")
        return
    DEST.mkdir(parents=True, exist_ok=True)
    pilots = []
    for row in json.loads(MANIFEST.read_text(encoding="utf-8")):
        if "Pilot" not in row.get("tags", "").split(","):
            continue
        source = ROOT / row["source"]
        data = parse(source)
        core = data.get("core", {})
        action = data.get("hiddenAction_InitializeStats_PilotSkills", {}).get("setUnitMemory", "")
        stats = {}
        for key, native in STATS.items():
            match = re.search(r"\b" + native + r"\s*=\s*(-?\d+(?:\.\d+)?)", action)
            if not match:
                if key == "awakening":
                    stats[key] = 0
                    continue
                raise ValueError(f"Missing {native} in {source}")
            stats[key] = int(float(match.group(1)))
        icon_ref = data.get("graphics", {}).get("icon_build", "")
        if not icon_ref.startswith("ROOT:"):
            raise ValueError(f"Missing pilot icon in {source}")
        icon_source = ROOT / icon_ref[5:]
        icon = DEST / (row["id"] + ".png")
        shutil.copyfile(icon_source, icon)
        pilots.append({
            "id": row["id"],
            "name": re.sub(r"\[[^]]+\]", "", core.get("displayText_zh", core.get("displayText", row["id"]))).strip(),
            "faction": row["tags"].split(",")[0],
            "source": row["source"],
            "icon": "assets/pilots/" + icon.name,
            "baseStats": stats,
            "commander": stats["leadership"] >= 100,
        })
    data = {
        "defaultRanges": {
            "shooting": [84, 104], "melee": [84, 104],
            "defense": [84, 104], "speed": [84, 104],
            "accuracy": [84, 104], "reaction": [84, 104],
            "leadership": [48, 60], "awakening": [0, 0],
        },
        "commanderRanges": {
            "shooting": [35, 45], "melee": [35, 45],
            "defense": [35, 45], "speed": [35, 45],
            "accuracy": [35, 45], "reaction": [35, 45],
            "leadership": [86, 108], "awakening": [0, 0],
        },
        "namedVariation": 5,
        "named": pilots,
        "portraits": portraits,
    }
    (PROJECT / "shared/pilots.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Imported {len(pilots)} pilot profiles")
    from importlib import import_module
    import_module("import-ace-pilots").main()


if __name__ == "__main__":
    main()
