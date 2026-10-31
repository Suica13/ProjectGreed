"""Unit size and family-specific targeting policies for current and future imports."""

def apply(prefab):
    if "MA" in prefab.get("unitTags", []):
        prefab["unitTags"] = [tag for tag in prefab["unitTags"]
                              if tag not in ("SmallUnit", "MediumUnit", "LargeUnit")] + ["LargeUnit"]
    if prefab["id"] == "MA_05" or prefab["id"].startswith("MA_05_"):
        for weapon in prefab["weapons"].values():
            if weapon.get("type") == "beam" and weapon.get("category") == "cannon":
                medium = weapon.setdefault("antiSize", {}).setdefault("medium", {"damage": 1})
                medium["accuracy"] = 0.75
    return prefab
