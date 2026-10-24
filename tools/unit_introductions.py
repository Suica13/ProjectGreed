"""Use the first non-empty native description line; do not import perks or quotes."""
import re


def first_line(text):
    return next((line.strip() for line in re.split(r"\\n|\r?\n", text) if line.strip()), "")


def apply_introduction(prefab, data):
    core = data.get("core", {})
    descriptions = {}
    for language, key in [("zh", "displayDescription_zh"), ("en", "displayDescription"), ("ja", "displayDescription_ja")]:
        line = first_line(core.get(key, ""))
        entry = prefab.setdefault("localization", {}).setdefault(language, {})
        if line:
            descriptions[language] = line
            entry["description"] = line
        else:
            # Missing native translations use the existing English fallback.
            entry.pop("description", None)
    prefab["description"] = descriptions.get("zh", descriptions.get("en", ""))
    if not prefab["description"]:
        raise ValueError("Missing native introduction: " + prefab["id"])
    return prefab
