"""Import only the three RTT economy buildings. Original MOD remains read-only."""
import copy,importlib.util,json,shutil
from pathlib import Path
from mod_source import MAIN,ROOT,MOD,ASSETS,load,resolve,section
from weapon_store import loads,dumps
spec=importlib.util.spec_from_file_location('facility_import',Path(__file__).with_name('import-battlefield-facilities.py'))
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
rows=[('Factory','工厂',ROOT/'Units/Buildings/Factory/Faction/EFSF_0079/Factory_EFSF_0079_Land.ini','factory'),
 ('Refinery','精炼厂',MAIN/'Units/Buildings/Refinery/Common/Refinery_Common_T1.ini','refinery'),
 ('Research','研究所',MAIN/'Units/Buildings/Institute/Common/Institute_Common_T1.ini','research')]
report=[]
for suffix,name,source,kind in rows:
 d=load(source);u=loads((ASSETS/'units/Facility_HQ/unit.json').read_text(encoding='utf-8'))
 uid='Facility_'+suffix;u.update(id=uid,code=uid,name=name,description='占山为王局内经济设施',source=source.relative_to(MOD).as_posix(),
   facility={'type':kind},weapons={},skills=[],layers=[],
   materials={'textures':{},'icon':''},weaponKits=[{'id':'standard','name':'标准套件','cost':0,'weapons':[]}])
 u.pop('localization',None)
 u['stats'].update(hp=int(d['core'].get('maxHp',30000)),facilityType=kind,footprint={'width':1,'height':1},cost=25)
 u['sourceStats']={'facilitySource':u['source'],'nativeHP':u['stats']['hp']}
 dest=ASSETS/'units'/uid/'textures';dest.mkdir(parents=True,exist_ok=True)
 for key in ['decal_Body_1','decal_Body','decal_Light']:
  if key not in d:continue
  decal=section(d,key)
  if not decal.get('image'):continue
  image=resolve(decal['image'],source.parent)
  shutil.copy2(image,dest/image.name)
  u['materials']['textures'][image.name]='textures/'+image.name
  u['materials']['icon']=u['materials']['icon'] or image.name
  u['layers'].append({'name':key,'texture':image.name,'bone':'Body','order':float(decal.get('order',1)),
    'scale':float(decal.get('imageScale',1)),'rotation':float(decal.get('dirOffset',0)),
    'offset':{'x':0,'y':0},'worldOffset':{'x':0,'y':0},'source':image.relative_to(MOD).as_posix()})
 if not u['layers']:raise ValueError('No native building art '+str(source))
 helper.fit_facility(u,dest,'base')
 (dest.parent/'unit.json').write_text(dumps(u),encoding='utf-8')
 report.append({'id':uid,'source':u['source'],'visual':u['sourceStats']['visual']})
catalog=ASSETS/'unit-catalog.json';c=json.loads(catalog.read_text(encoding='utf-8'))
for suffix,*_ in rows:
 ref='units/Facility_'+suffix+'/unit.json'
 if ref not in c['units']:c['units'].append(ref)
catalog.write_text(json.dumps(c,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ASSETS.parent/'docs/imports/dominion-facilities.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Imported three native economy facilities')
