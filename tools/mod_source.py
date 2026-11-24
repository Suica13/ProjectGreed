"""Read-only MOD parser. Importing this module never writes assets or executes legacy importers."""
import os
import functools
import re
from pathlib import Path

MOD = Path(r"E:/RustedWarfare_Reunion/mods/units")
PACKAGE = os.environ.get("PROJECTGREED_MOD_DLC", "GW_BattleUniverse_DLC_0079")
# Some checkouts keep a DLC alongside mods/units instead of inside it.
_default_root = MOD / PACKAGE
ROOT = Path(os.environ.get("PROJECTGREED_MOD_DLC_ROOT", str(
    _default_root if _default_root.exists() else MOD.parent / PACKAGE
)))
MAIN = MOD / "GW_BattleUniverse_Main"
ASSETS = Path(__file__).resolve().parents[1] / "assets"
EXTERNAL_PACKAGES = {"GundamWars_Duel_A0": Path(r"H:/RW_Modding/Locker/A/GundamWars/duel/GundamWars_Duel_A0")}

def package_root(name):
    """Resolve a read-only package without assuming every DLC lives in mods/units."""
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", name) or name in (".", ".."):
        raise ValueError("Invalid MOD package: " + name)
    if name == ROOT.name:
        return ROOT
    if name in EXTERNAL_PACKAGES:
        return EXTERNAL_PACKAGES[name]
    original = MOD / name
    sibling = MOD.parent / name
    return original if original.exists() or not sibling.exists() else sibling

def source_path(reference):
    relative = Path(reference)
    if relative.is_absolute() or ".." in relative.parts or len(relative.parts) < 2:
        raise ValueError("Invalid MOD source reference: " + str(reference))
    return package_root(relative.parts[0]).joinpath(*relative.parts[1:])

def parse(file):
    sections, current = {}, None
    lines = iter(Path(file).read_text(encoding="utf-8-sig").splitlines())
    for line in lines:
        line = line.strip()
        if line.startswith("[") and line.endswith("]"):
            current = sections.setdefault(line[1:-1], {})
        elif current is not None and ":" in line and not line.startswith("#"):
            key, value = line.split(":", 1)
            if value.strip() == '"""':
                parts = []
                for part in lines:
                    if part.strip() == '"""':
                        break
                    parts.append(part.strip())
                value = " ".join(parts)
            current[key.strip()] = value.strip()
    return sections

def source_root(path):
    path = Path(path).resolve()
    if path.is_relative_to(ROOT.resolve()):
        return ROOT
    if path.is_relative_to(MOD.parent.resolve()) and path.parts[len(MOD.parent.resolve().parts)] == "GundamWars_BattleOperation2_V5":
        return MOD.parent / "GundamWars_BattleOperation2_V5"
    for external in EXTERNAL_PACKAGES.values():
        if path.is_relative_to(external.resolve()):
            return external
    relative = path.relative_to(MOD.resolve())
    return MOD / relative.parts[0]

def resolve(reference, base=ROOT, root=None):
    root = Path(root) if root is not None else source_root(base)
    reference = reference.strip().replace("\\", "/")
    path = root / reference[5:].lstrip("/") if reference.startswith("ROOT:") else base / reference
    path = path.resolve()
    if not any(path.is_relative_to(base.resolve()) for base in (MOD, ROOT, MOD.parent / "GundamWars_BattleOperation2_V5", *EXTERNAL_PACKAGES.values())):
        raise ValueError("Source outside MOD checkout: " + str(path))
    return path

@functools.lru_cache(None)
def load(file, root=None, stack=()):
    file = Path(file)
    root = Path(root) if root is not None else source_root(file)
    if file in stack:
        raise ValueError("Cyclic copyFrom: " + str(file))
    own, result = parse(file), {}
    for reference in own.get("core", {}).get("copyFrom", "").split(","):
        if reference.strip():
            for key, value in load(resolve(reference, file.parent, root), root, (*stack, file)).items():
                result.setdefault(key, {}).update(value)
    for key, value in own.items():
        result.setdefault(key, {}).update(value)
    return result

def section(data, name, stack=()):
    if name in stack:
        raise ValueError("Cyclic section: " + name)
    value = data[name].copy()
    parent = value.pop("@copyFromSection", None)
    return {**section(data, parent, (*stack, name)), **value} if parent else value

def number(value, data=None):
    value = str(value).strip().removesuffix("s")
    match = re.fullmatch(r"\$\{([^.]+)\.(\w+)\}", value)
    if match and data:
        value = section(data, match[1])[match[2]].removesuffix("s")
    return float(value)

def stat(data, name, default=0):
    text = " ".join(value for section in data.values() for value in section.values())
    match = re.search(r"\b" + name + r"\s*=\s*(-?[\d.]+)", text)
    return float(match[1]) if match else default
