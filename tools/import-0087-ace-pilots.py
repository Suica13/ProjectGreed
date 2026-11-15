"""Import 0087 ACEs and wire the original MOD's unlock dependencies."""
import importlib,json,os,re,sys
from pathlib import Path
os.environ['PROJECTGREED_MOD_DLC']='GW_BattleUniverse_DLC_0087'
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from mod_source import ROOT,parse
project=Path(__file__).resolve().parents[1]
tree_path=project/'shared/development-tree.json'
tree=json.loads(tree_path.read_text('utf-8'))
bindings={}
for source in (ROOT/'Units/TechTree/Tech/Faction').glob('*/TechList_*.ini'):
 for action,block in parse(source).items():
  trigger=block.get('autoTrigger','')
  if 'Unlock_Pilot_' not in trigger:continue
  tech=re.search(r"self.globalTeamTags\(includes='(Tech_[^']+)'\)",trigger)
  pilot=re.search(r"not self.globalTeamTags\(includes='Unlock_(Pilot_[^']+)'\)",trigger)
  if not tech or not pilot:continue
  matches=[node for nodes in tree.values() for node in nodes if node['id']==tech[1]]
  if len(matches)!=1:raise ValueError('Missing or ambiguous ACE technology: '+tech[1])
  node=matches[0]
  if pilot[1] not in node['unlocks']:node['unlocks'].append(pilot[1])
  bindings[pilot[1]]=node['id']
tree_path.write_text(json.dumps(tree,ensure_ascii=False,indent=2)+'\n','utf-8')
importlib.import_module('import-ace-pilots').main('0087')
report=project/'tmp/verification/reports/0087-ace-import.json'
report.parent.mkdir(parents=True,exist_ok=True)
report.write_text(json.dumps({'bindings':bindings},ensure_ascii=False,indent=2)+'\n','utf-8')
print('Connected',len(bindings),'ACE technology unlocks')
