"""Import Page_01 combat units only; original MOD is read-only. Re-runs retain existing edits."""
from weapon_store import loads as load_source_json, dumps as dump_source_json
import importlib.util,json,re,sys,traceback,subprocess,shutil
from pathlib import Path
from mod_source import ROOT,ASSETS,MOD,load,parse
PROJECT=ASSETS.parent

def module(name,file):
    spec=importlib.util.spec_from_file_location(name,Path(__file__).with_name(file))
    result=importlib.util.module_from_spec(spec);spec.loader.exec_module(result);return result

def manifest():
    index={}
    for path in (ROOT/"Units").rglob("*.ini"):
        index.setdefault(path.stem,[]).append(path)
        if path.name.endswith(".ini.ini"):index.setdefault(path.name[:-8],[]).append(path)
    units={};excluded=[]
    for faction in ["EFSF","ZEON"]:
        page=ROOT/f"Units/TechTree/Core/Faction/{faction}_0079/TechTree_UI_Page_{faction}_0079_01.ini"
        techs=re.findall(r"onCreateSpawnUnitOf\s*:\s*(Tech_\w+)\*",page.read_text(encoding="utf-8-sig"))
        for tech in techs:
            marker=next(path for path in index[tech] if "/TechTree/" in path.as_posix())
            for ident in re.findall(r"@define UnitID\s*=\s*(\w+)",marker.read_text(encoding="utf-8-sig")):
                candidates=[path for path in index.get(ident,[]) if "/BattleUnits/" in path.as_posix()]
                if not candidates:
                    excluded.append({"id":ident,"tech":tech,"reason":"非战斗单位或建筑"});continue
                source=candidates[0];native=load(source);core=native["core"];tags=core.get("tags","")
                if any(tag.strip() in ["Building","Turret","Radar","Pilot"] for tag in tags.split(",")):
                    excluded.append({"id":ident,"tech":tech,"reason":"建筑或ACE驾驶员，未作为机体导入"});continue
                if ident not in units:
                    refs=parse(source).get("core",{}).get("copyFrom","")
                    units[ident]={"id":ident,"faction":faction,"name":core.get("displayText_zh",core.get("displayText",ident)),
                        "source":source.relative_to(ROOT).as_posix(),"tags":tags,"tech":[],
                        "nativeSkills":re.findall(r"(?:ROOT:)?(Template/Unit/Skill/[^,\s]+)",refs),
                        "weapons":re.findall(r"(?:ROOT:)?(Units/BattleUnits/Weapon/[^,\s]+)",refs)}
                if tech not in units[ident]["tech"]:units[ident]["tech"].append(tech)
    return list(units.values()),excluded

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows,excluded=manifest()
    output=Path(__file__).with_name("0079-page-two-manifest.json")
    output.write_text(dump_source_json(rows,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    bulk=module("page_two_bulk","import-0079-page-one.py")
    effects=bulk.read(ASSETS/"effects/effects.json");catalog=bulk.read(ASSETS/"unit-catalog.json");report=[]
    for row in rows:
        path=ASSETS/f"units/{row['id']}/unit.json"
        try:
            if path.exists():
                prefab=bulk.read(path);status="existing"
            else:
                prefab=bulk.build(row,effects);prefab.setdefault("sourceStats",{})["importedTechPage"]=1
                bulk.write(path,prefab);status="imported"
            report.append({"id":row["id"],"status":status,"weapons":len(prefab["weapons"])})
            print(status,row["id"],len(prefab["weapons"]),flush=True)
        except Exception as error:
            report.append({"id":row["id"],"status":"error","error":str(error),"traceback":traceback.format_exc()})
            print("ERROR",row["id"],str(error),flush=True)
    bulk.write(ASSETS/"effects/effects.json",effects)
    bulk.write(Path(__file__).with_name("0079-page-two-import-report.json"),{"units":report,"excluded":excluded})
    if any(row["status"]=="error" for row in report):raise SystemExit("Import errors; registry not published.")
    for row in rows:
        ref=f"units/{row['id']}/unit.json"
        if ref not in catalog["units"]:catalog["units"].append(ref)
    from special_systems import refresh_systems
    catalog=refresh_systems(catalog, {"RX_80PR_SpaceType"}, publish=False)
    from unit_eras import apply
    for ref in catalog["units"]:
        path=ASSETS/ref;prefab=apply(bulk.read(path));bulk.write(path,prefab)
    from animation_pool import refresh
    refresh()
    check=subprocess.run([shutil.which("node"),"-e","require('./tools/load-catalog.cjs').loadCatalog({catalogOverride:JSON.parse(require('fs').readFileSync(0,'utf8'))})"],input=dump_source_json(catalog),text=True,capture_output=True,cwd=PROJECT)
    if check.returncode:raise SystemExit(check.stderr)
    bulk.write(ASSETS/"unit-catalog.json",catalog)
    tech=module("page_two_tech","import-0079-tech.py")
    old=sys.argv;sys.argv=[str(Path(__file__).with_name("import-0079-tech.py")),str(ROOT)]
    try:tech.main()
    finally:sys.argv=old
    production=module("page_two_production","import-production.py");production.main()
    print("Registered",len(rows),"Page_01 combat units",flush=True)

if __name__=="__main__":main()
