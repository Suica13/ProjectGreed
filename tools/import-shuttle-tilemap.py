"""Read-only import of the original BO2 TMX ground layer and embedded pixel atlas."""
from pathlib import Path
import argparse,base64,gzip,hashlib,json,struct,xml.etree.ElementTree as ET,zlib
root=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser()
parser.add_argument('--source',type=Path,default=Path('E:/RustedWarfare_Reunion/mods/GundamWars_BattleOperation2_V5/Maps/LimitTimer_PVE_01.tmx'))
args=parser.parse_args()
r=ET.parse(args.source).getroot()
atlas=r.find('tileset')
png=base64.b64decode(atlas.find('./properties/property[@name="embedded_png"]').get('value'))
d=r.find('./layer[@name="Ground"]/data')
raw=base64.b64decode(d.text)
raw=gzip.decompress(raw) if d.get('compression')=='gzip' else zlib.decompress(raw)
gids=struct.unpack('<'+'I'*(len(raw)//4),raw)
assert len(gids)==int(r.get('width'))*int(r.get('height'))
assert all(0<gid<201 for gid in gids), 'unexpected visual tileset or flipped tile'
runs=[]
for gid in gids:
 if runs and runs[-1][0]==gid:runs[-1][1]+=1
 else:runs.append([gid,1])
target=root/'assets/maps/missions/shuttle-native'
target.mkdir(parents=True,exist_ok=True)
(target/'tile_1.png').write_bytes(png)
data={'source':'GundamWars_BattleOperation2_V5/Maps/LimitTimer_PVE_01.tmx',
 'sha256':hashlib.sha256(args.source.read_bytes()).hexdigest(),
 'width':int(r.get('width')),'height':int(r.get('height')),
 'tileWidth':int(atlas.get('tilewidth')),'tileHeight':int(atlas.get('tileheight')),
 'imageWidth':int(atlas.find('image').get('width')),'imageHeight':int(atlas.find('image').get('height')),
 'groundRuns':runs}
(target/'source.json').write_text(json.dumps(data,separators=(',',':'))+'\n',encoding='utf-8')
print('Imported native ground:',data['width'],data['height'],'runs:',len(runs),'atlas:',len(png))
