"""Read native Hong Kong tiles and resolve decorative building layers without altering the MOD."""
from pathlib import Path
import argparse,os,sys,xml.etree.ElementTree as ET,base64,struct,json,hashlib,shutil
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,default=Path('E:/RustedWarfare_Reunion/mods/GundamWars_BattleOperation2_V5'))
args=parser.parse_args();source=args.source.resolve()
os.environ['PROJECTGREED_MOD_DLC_ROOT']=str(source)
sys.path.insert(0,str(Path(__file__).resolve().parent))
import mod_source as mod
target=Path(__file__).resolve().parents[1]/'assets/maps/missions/hong-kong-native'
target.mkdir(parents=True,exist_ok=True)
tmx=source/'Maps/NHK[5v5]_PVP_01.tmx'
r=ET.parse(tmx).getroot();tile=r.find('./tileset[@name="tile_3"]')
png=base64.b64decode(tile.find('./properties/property[@name="embedded_png"]').get('value'))
(target/'tile_3.png').write_bytes(png)
buildings=[]
for i in range(1,8):
 file=source/f'Units/Buildings/Wall/House_HK_{i}.ini';data=mod.load(file,root=source)
 layer=mod.section(data,'decal_A');image=mod.resolve(layer['image'],file.parent,source)
 w,h=struct.unpack('>II',image.read_bytes()[16:24]);name=image.name
 shutil.copyfile(image,target/name)
 buildings.append({'id':f'House_HK_{i}','image':name,'width':w,'height':h,
   'source':str(file.relative_to(source)).replace('\\','/'),'sha256':hashlib.sha256(image.read_bytes()).hexdigest(),
   'scale':float(layer.get('imageScale',1)),'offsetX':float(layer.get('xOffsetRelative',0)),
   'offsetY':float(layer.get('yOffsetRelative',0)),'footprint':data['core']['footprint']})
fire=source/'Resource/Image/Fx/Unit/Image/Burned_1.png'
shutil.copyfile(fire,target/'Burned_1.png')
fw,fh=struct.unpack('>II',fire.read_bytes()[16:24])
manifest={'source':'GundamWars_BattleOperation2_V5/Maps/NHK[5v5]_PVP_01.tmx',
 'sha256':hashlib.sha256(tmx.read_bytes()).hexdigest(),'width':int(r.get('width')),'height':int(r.get('height')),
 'atlas':{'image':'tile_3.png','width':200,'height':200,'tileWidth':10,'tileHeight':10,'firstgid':int(tile.get('firstgid'))},
 'fire':{'image':'Burned_1.png','width':fw,'height':fh,'frames':5},'buildings':buildings}
(target/'source.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf-8')
print('Imported Hong Kong native atlas and',len(buildings),'decorative buildings')
