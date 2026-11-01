"""Read-only MOD parser. Importing this module never writes assets or executes legacy importers."""
import os
import functools
import re
from pathlib import Path

MOD = Path(r"E:/RustedWarfare_Reunion/mods/units")
ROOT = MOD / os.environ.get("PROJECTGREED_MOD_DLC", "GW_BattleUniverse_DLC_0079")
MAIN = MOD / "GW_BattleUniverse_Main"
ASSETS = Path(__file__).resolve().parents[1] / "assets"

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
    relative = path.relative_to(MOD.resolve())
    return MOD / relative.parts[0]

def resolve(reference, base=ROOT, root=None):
    root = Path(root) if root is not None else source_root(base)
    reference = reference.strip().replace("\\", "/")
    path = root / reference[5:].lstrip("/") if reference.startswith("ROOT:") else base / reference
    path = path.resolve()
    if not path.is_relative_to(MOD.resolve()):
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
