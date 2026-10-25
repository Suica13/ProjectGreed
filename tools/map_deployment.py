"""Reserve ship-sized deployment strips while preserving the original battlefield.
Used by both generators and the migration command. Existing expanded maps are not widened twice.
Run: python tools/map_deployment.py
"""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"



def trim_deployment_areas(data):
    """Use 90% of each side strip, rounded to whole tiles, without resizing terrain.
    Recompute from the original expansion widths so repeated reloads never shrink again.
    """
    expansion = data["deploymentExpansion"]
    for seat, (area, spawn) in enumerate(zip(data["deploymentAreas"], data["spawns"])):
        strip = expansion["addedLeft" if seat % 2 == 0 else "addedRight"]
        width = max(1, math.floor(strip * 0.9 + 0.5))
        area.update(x=0 if seat % 2 == 0 else data["width"] - width, width=width)
        spawn["x"] = area["x"] + width // 2
    return data


def widen_map(data):
    previous = data.get("deploymentExpansion", {})
    if previous.get("version") == 2:
        return trim_deployment_areas(data)
    original_width = previous.get("baseWidth", data["width"])
    original_height = previous.get("baseHeight", data["height"])
    old_left = previous.get("addedLeft", 0)
    old_top = previous.get("addedTop", 0)
    battlefield = [row[old_left:old_left + original_width] for row in data["tiles"][old_top:old_top + original_height]]
    height = max(original_height, data["playersPerTeam"] * 18)
    top = (height - original_height) // 2
    left = right = 14
    tiles = [["plain"] * (original_width + left + right) for _ in range(height)]
    for y, row in enumerate(battlefield):
        tiles[y + top][left:left + original_width] = row
    # Coastal strips retain water berths instead of turning into impassable land.
    if data["id"] == "coastal_supply_2v2":
        for y, row in enumerate(tiles):
            terrain = "water" if (y % 18) < 8 else "plain"
            row[:left] = [terrain] * left
            row[left + original_width:] = [terrain] * right
    data["tiles"] = tiles
    data["width"] = original_width + left + right
    data["height"] = height
    data["deploymentExpansion"] = dict(version=2, baseWidth=original_width, baseHeight=original_height,
        addedLeft=left, addedRight=right, addedTop=top, addedBottom=height-original_height-top)

    data["deploymentAreas"] = []
    players = data["playersPerTeam"]
    height = data["height"]
    for seat, spawn in enumerate(data["spawns"]):
        team = seat % 2
        position = seat // 2
        top = position * height // players
        bottom = (position + 1) * height // players
        area = dict(x=0 if team == 0 else left + original_width,
                    y=top, width=left if team == 0 else right, height=bottom - top)
        data["deploymentAreas"].append(area)
        spawn["x"] = area["x"] + area["width"] // 2
        spawn["y"] = (top + bottom) // 2
    return trim_deployment_areas(data)


def sync_default(catalog):
    default = next(json.loads((ASSETS / ref).read_text(encoding="utf-8"))
                   for ref in catalog["maps"]
                   if Path(ref).stem == catalog["defaultMap"])
    catalog["map"] = dict(width=default["width"], height=default["height"])
    catalog["deployment"]["spawns"] = [dict(x=s["x"], y=s["y"]) for s in default["spawns"]]


def main():
    path = ASSETS / "unit-catalog.json"
    catalog = json.loads(path.read_text(encoding="utf-8"))
    for ref in catalog["maps"]:
        file = ASSETS / ref
        data = widen_map(json.loads(file.read_text(encoding="utf-8")))
        file.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(data["id"], data["deploymentExpansion"]["baseWidth"], "->", data["width"])
    sync_default(catalog)
    path.write_text(json.dumps(catalog, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
