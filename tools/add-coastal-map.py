import json
from map_deployment import widen_map
from pathlib import Path
p=Path('assets/maps/orbital_debris_2v2.json');m=json.loads(p.read_text(encoding='utf-8'));m.update(id='coastal_supply_2v2',name='海陆补给线 · 2v2',description='海军部署于上方航道，陆军部署于沿岸，可由飞机与两栖部队跨越海岸。',environment='ground',width=40,height=36,navalDeployment=True,deploymentRadius=5,deploymentExpansion={'baseWidth':32,'addedLeft':4,'addedRight':4})
m['localization']={'zh':{'name':m['name'],'description':m['description']},'en':{'name':'Coastal Supply Lines · 2v2','description':'Water deployment lanes for ships, coastal land deployments for ground forces.'},'ja':{'name':'沿岸補給線 · 2v2','description':'艦艇は水域、陸上部隊は海岸に展開する。'}}
m['appearance']['biome']='wetland';m['appearance']['colors']={'plain':'#4b6151','water':'#234c61','rock':'#596064','forest':'#294738','rubble':'#43494a','highland':'#9c986b'}
m['tiles']=[['water' if y%18<8 else 'plain' for x in range(40)] for y in range(36)]
for y in range(36):
 for x in range(4,36):
  if y%18 in [8,9] and (x+y)%11==0:m['tiles'][y][x]='rubble'
  if y%18>11 and (x*17+y*7)%19<2:m['tiles'][y][x]='forest'
m['deploymentAreas']=[{'x':0 if seat%2==0 else 36,'y':(seat//2)*18,'width':4,'height':18} for seat in range(4)]
m['spawns']=[{'team':seat%2,'position':seat//2+1,'x':1 if seat%2==0 else 38,'y':seat//2*18+12} for seat in range(4)]
widen_map(m)
Path('assets/maps/coastal_supply_2v2.json').write_text(json.dumps(m,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
p=Path('assets/unit-catalog.json');d=json.loads(p.read_text(encoding='utf-8'));ref='maps/coastal_supply_2v2.json'
if ref not in d['maps']:d['maps'].append(ref)
p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')