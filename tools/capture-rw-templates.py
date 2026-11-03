"""Read-only capture of native RW_GW templates for the offline exporter."""
import json,sys,subprocess,re
from pathlib import Path
import mod_source as m
from unit_visuals import BONE_NAMES
root=Path(sys.argv[1]).resolve();m.MOD=root;m.ROOT=root/'GW_BattleUniverse_DLC_0079';m.MAIN=root/'GW_BattleUniverse_Main'
result={'repository':'Suica13/RW_GW','commit':subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD'],text=True).strip(),'templates':{},'bones':{v:k for k,v in BONE_NAMES.items()}}
for id in ['RGM_79','MS_06F','RX_78_2']:
 source=m.ROOT/'Units/BattleUnits'/id/(id+'.ini');data=m.load(source)
 layers={k[6:]:m.section(data,k) for k in data if k.startswith('decal_')}
 animations={k[10:]:m.section(data,k) for k in data if k.startswith('animation_')}
 weapons={}
 for key,v in data.items():
  if key.startswith('hiddenAction_') and key.endswith('_SetWeaponIndex'):
   match=re.search(r'nowWeaponIndex\s*=\s*(\d+)',v.get('setUnitMemory',''))
   if match:weapons[key[13:-15]]={'displayIndex':int(match[1])}
 prefab=json.loads((Path(__file__).resolve().parents[1]/'assets/units'/id/'unit.json').read_text())
 kits={}
 for kit in prefab['weaponKits']:
  w=kit['weapons'][0];trigger=data.get('hiddenAction_'+w+'_Trigger',{})
  match=re.search(r'EquipmentIndex\s*==\s*(\d+)',trigger.get('requireConditional',''))
  if match:kits[kit['id']]=int(match[1])
 result['templates'][id]={'path':source.relative_to(m.ROOT).as_posix(),'tags':data['core'].get('tags',''),'layers':layers,'animations':animations,'weapons':weapons,'kits':kits}
out=Path(__file__).resolve().parents[1]/'unit-editor/rw-templates.json';out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print({id:(t['kits'],list(t['weapons'])[:3]) for id,t in result['templates'].items()})
