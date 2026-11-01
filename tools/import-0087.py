"""Portable 0087 import. Original MOD is read-only; existing unit edits are preserved."""
import os
os.environ["PROJECTGREED_MOD_DLC"] = "GW_BattleUniverse_DLC_0087"
import importlib.util, json, re, sys, traceback, subprocess, shutil
from pathlib import Path
from mod_source import ROOT, ASSETS, load, parse
from weapon_store import loads, dumps
PROJECT = ASSETS.parent
FACTIONS = ("AEUG", "TITANS", "NEO_ZEON")
def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf8")
def main():
    sys.stdout.reconfigure(encoding="utf8")
    tech = module("tech0087", "import-0079-tech.py")
    treefile = PROJECT / "shared/development-tree.json"
    tree = json.loads(treefile.read_text(encoding="utf8"))
    index = {}
    for path in (ROOT / "Units").rglob("*.ini"):
        index.setdefault(path.stem.removesuffix(".ini"), []).append(path)
    rows, excluded = {}, []
    for faction in FACTIONS:
        tree[faction] = []
        for page in (0, 1):
            nodes = tech.import_faction(ROOT, faction, page, "0087")
            if page == 1:
                first = nodes[0]
                first["temporaryPointOverride"] = {"nativePoints": first["points"], "reason": "0087 Page_01 temporary lock"}
                first["points"] = 999999
            tree[faction].extend(nodes)
            for node in nodes:
                for ident in node["unlocks"]:
                    candidates = [p for p in index.get(ident, []) if "/BattleUnits/" in p.as_posix()]
                    if not candidates:
                        excluded.append({"id": ident, "tech": node["id"], "reason": "建筑、驾驶员或非战斗对象"})
                        continue
                    source = candidates[0]; native = load(source); core = native["core"]
                    tags = core.get("tags", "")
                    if any(t.strip() in ("Building", "Turret", "Radar", "Pilot") for t in tags.split(",")):
                        excluded.append({"id": ident, "tech": node["id"], "reason": "建筑或驾驶员"}); continue
                    if ident not in rows:
                        refs = parse(source).get("core", {}).get("copyFrom", "")
                        rows[ident] = {"id": ident, "faction": faction, "factions": [], "name": core.get("displayText_zh", core.get("displayText", ident)), "source": source.relative_to(ROOT).as_posix(), "tags": tags, "tech": [], "nativeSkills": re.findall(r"(?:ROOT:)?(Template/Unit/Skill/[^,\s]+)", refs), "weapons": re.findall(r"(?:ROOT:)?(Units/BattleUnits/Weapon/[^,\s]+)", refs)}
                    row = rows[ident]
                    if faction not in row["factions"]: row["factions"].append(faction)
                    if node["id"] not in row["tech"]: row["tech"].append(node["id"])
    deferred = []
    for candidates in index.values():
        for source in candidates:
            if "/BattleUnits/" not in source.as_posix(): continue
            own = parse(source).get("core", {})
            ident = own.get("name")
            if not ident or ident in rows: continue
            core = load(source)["core"]
            tags = {t.strip() for t in core.get("tags", "").split(",")}
            if "Unit" not in tags or not tags.intersection(FACTIONS): continue
            if (ASSETS / f"units/{ident}/unit.json").exists(): continue
            reason = "ACE驾驶员" if ident.startswith("Pilot_") else "再入辅助状态" if ident.endswith("_OverLine") else "搭载／收纳状态" if ident.endswith("_CloseState") else "系统／飞行／变形状态" if any(token in ident for token in ("_MA", "_ALICE", "_FlyStyle")) else "科技树外专用机／其他单位"
            deferred.append({"id": ident, "name": core.get("displayText_zh", core.get("displayText", ident)), "source": source.relative_to(ROOT).as_posix(), "reason": reason})
    write(Path(__file__).with_name("0087-deferred-content.json"), sorted({row["id"]:row for row in deferred}.values(), key=lambda row:row["id"]))
    write(Path(__file__).with_name("0087-manifest.json"), list(rows.values()))
    bulk = module("bulk0087", "import-0079-page-one.py")
    effects = bulk.read(ASSETS / "effects/effects.json")
    catalog = bulk.read(ASSETS / "unit-catalog.json")
    report = []
    for row in rows.values():
        path = ASSETS / f"units/{row['id']}/unit.json"
        try:
            existing = path.exists()
            prefab = bulk.read(path) if existing else bulk.build(row, effects)
            if not existing:
                prefab["tags"] = [t for t in prefab["tags"] if not re.fullmatch(r"(?:0079[EL]?|0083)", t)]
                if "0087" not in prefab["tags"]: prefab["tags"].append("0087")
                prefab.setdefault("sourceStats", {})["technologyEra"] = "0087"
            primary = next(t for t in prefab["tags"] if t in ("EFSF", "ZEON", *FACTIONS))
            available = list(dict.fromkeys([primary, *prefab.get("availableFactions", []), *row["factions"]]))
            if len(available) > 1: prefab["availableFactions"] = available
            bulk.write(path, prefab)
            ref = f"units/{row['id']}/unit.json"
            if ref not in catalog["units"]: catalog["units"].append(ref)
            report.append({"id": row["id"], "status": "existing" if existing else "imported", "mechanics": prefab.get("mechanics", [])})
            print(report[-1]["status"], row["id"], flush=True)
        except Exception as error:
            report.append({"id": row["id"], "status": "error", "error": str(error), "traceback": traceback.format_exc()})
            print("ERROR", row["id"], str(error), flush=True)
    bulk.write(ASSETS / "effects/effects.json", effects)
    write(Path(__file__).with_name("0087-import-report.json"), {"units": report, "excluded": excluded})
    if any(r["status"] == "error" for r in report): raise SystemExit("Fix import errors before publishing registry")
    check = subprocess.run([shutil.which("node"), "-e", "require('./tools/load-catalog.cjs').loadCatalog({catalogOverride:JSON.parse(require('fs').readFileSync(0,'utf8')),embedAssets:false})"], input=json.dumps(catalog), text=True, capture_output=True, cwd=PROJECT)
    if check.returncode: raise SystemExit(check.stderr)
    write(ASSETS / "unit-catalog.json", catalog)
    write(treefile, tree)
    environment = dict(os.environ)
    environment.pop("PROJECTGREED_MOD_DLC", None)
    for filename in ("import-production.py", "report-0087.py"):
        subprocess.run([sys.executable, str(Path(__file__).with_name(filename))], cwd=PROJECT, env=environment, check=True)
    print("Registered", len(rows), "0087 combat units")
if __name__ == "__main__": main()
