"""Read Battle Operation 2's layered shuttle without modifying the source MOD."""
import copy,importlib,json,shutil,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from mod_source import parse
P=Path(__file__).resolve().parents[1]
source=Path('E:/RustedWarfare_Reunion/mods/GundamWars_BattleOperation2_V5')
ref='Units/Buildings/Event/Story/Stage1/Story_Stage1_SpaceShuttle.ini'
d=parse(source/ref)
u=json.loads((P/'assets/units/Facility_Radar/unit.json').read_text('utf-8'))
uid='Mission_SpaceShuttle';dest=P/'assets/units'/uid/'textures';dest.mkdir(parents=True,exist_ok=True)
u.update(id=uid,code='SpaceShuttle',name='穿梭机',description='奥古撤离穿梭机，完成发射准备前必须坚守。',
 source='GundamWars_BattleOperation2_V5/'+ref,tags=['AEUG','UC_0087_T1'],availableFactions=['AEUG'],
 unitTags=['Building','LargeUnit'],facility={'type':'objective'},formOnly=True,faction='AEUG',
 materials={'textures':{},'icon':'shuttle_2.png'},layers=[],
 localization={'en':{'name':'Space Shuttle'},'ja':{'name':'スペースシャトル'}})
u['stats'].update(hp=int(d['core']['maxHp']),en=1,move=0,mobility=1,cost=25,speed=1,facilityType='objective',footprint={'width':5,'height':5},commandAuras=[])
for kind in ['beam','shell','melee']:
 u['defenses'][kind]={'percent':25 if kind!='melee' else 0,'flat':0}
u['sourceStats']={'nativeHP':int(d['core']['maxHp']),'conversion':'Original 300000 HP, 25% beam and shell resistance, three native decal layers fitted to five cells.'}
u['skeleton']['Body']={'x':0,'y':0};u['skills']=[];u['mechanics']=[]
for i in range(1,4):
 layer=d[f'decal_Body_{i}'];image=source/layer['image'][5:];name=f'shuttle_{i}.png'
 shutil.copyfile(image,dest/name);u['materials']['textures'][name]='textures/'+name
 u['layers'].append({'name':f'Body_{i}','texture':name,'bone':'Body','order':int(layer['order']),
 'scale':float(layer['imageScale']),'rotation':0,'offset':{'x':0,'y':0},
 'worldOffset':{'x':float(layer['xOffsetRelative']),'y':-float(layer['yOffsetRelative'])},
 'source':'GundamWars_BattleOperation2_V5/'+image.relative_to(source).as_posix()})
fit=importlib.import_module('import-battlefield-facilities').fit_facility
fit(u,dest,'base');u['presentation']['mapScale']*=5/3
u['sourceStats']['visual']['targetCells']=5;u['sourceStats']['visual']['mapScale']=u['presentation']['mapScale']
(dest.parent/'unit.json').write_text(json.dumps(u,ensure_ascii=False,indent=2)+'\n','utf-8')
cat=P/'assets/unit-catalog.json';c=json.loads(cat.read_text('utf-8'));entry=f'units/{uid}/unit.json'
if entry not in c['units']:c['units'].append(entry)
cat.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n','utf-8')
print('Imported three-layer shuttle with native HP and five-cell footprint')
