"""Read-only Page_00 unlock audit. Excludes buildings/radars/turrets; records ACE pilots for explicit review."""
from pathlib import Path
import sys,re,json
sys.path.insert(0,str(Path(__file__).resolve().parent));sys.stdout.reconfigure(encoding='utf-8')
from mod_source import ROOT,parse,load,section
idx={}
for p in (ROOT/'Units').rglob('*.ini'):
 idx.setdefault(p.stem,[]).append(p)
 if p.name.endswith('.ini.ini'):idx.setdefault(p.name[:-8],[]).append(p)
result=[]
for faction in ['EFSF','ZEON']:
 page=ROOT/f'Units/TechTree/Core/Faction/{faction}_0079/TechTree_UI_Page_{faction}_0079_00.ini'
 techs=re.findall(r'onCreateSpawnUnitOf\s*:\s*(Tech_\w+)\*',page.read_text(encoding='utf-8-sig'))
 units={}
 for tech in techs:
  file=next(p for p in idx[tech] if '/TechTree/' in p.as_posix())
  for block in re.split(r'(?m)^\[',file.read_text(encoding='utf-8-sig')):
   if block.startswith('action_UnlockInfo_') and (match:=re.search(r'@define UnitID\s*=\s*(\w+)',block)):
    unit=match[1];units.setdefault(unit,[]).append(tech)
 print(faction,'TECHS',techs)
 for unit,tech in units.items():
  candidates=[p for p in idx.get(unit,[]) if '/BattleUnits/' in p.as_posix()]
  if not candidates:continue
  source=candidates[0]
  try:
   data=load(source);core=data['core'];tags=core.get('tags','');name=core.get('displayText_zh',core.get('displayText',unit))
   if any(k in tags.split(',') for k in ['Building','Turret','Radar']):continue
   raw=parse(source);refs=raw.get('core',{}).get('copyFrom','')
   row=dict(id=unit,faction=faction,name=name,source=source.relative_to(ROOT).as_posix(),tech=tech,tags=tags,
    nativeSkills=re.findall(r'(?:ROOT:)?(Template/Unit/Skill/[^,\s]+)',refs),
    weapons=re.findall(r'(?:ROOT:)?(Units/BattleUnits/Weapon/[^,\s]+)',refs))
   result.append(row)
   print(unit,name,tags,','.join(Path(r).stem for r in row['nativeSkills']))
  except Exception as e:print('ERROR',unit,str(e)[:180])
Path('tools/0079-page-one-manifest.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('TOTAL',len(result))