"""Import Page_00 named pilot profiles and icons; MOD files are read-only."""

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


def main():
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
            "shooting": [94, 114], "melee": [94, 114],
            "defense": [94, 114], "speed": [94, 114],
            "accuracy": [94, 114], "reaction": [94, 114],
            "leadership": [58, 70], "awakening": [0, 0],
        },
        "commanderRanges": {
            "shooting": [45, 55], "melee": [45, 55],
            "defense": [45, 55], "speed": [45, 55],
            "accuracy": [45, 55], "reaction": [45, 55],
            "leadership": [96, 118], "awakening": [0, 0],
        },
        "namedVariation": 5,
        "named": pilots,
    }
    (PROJECT / "shared/pilots.json").write_text(
        json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Imported {len(pilots)} pilot profiles")


if __name__ == "__main__":
    main()
