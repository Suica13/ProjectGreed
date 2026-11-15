import hashlib,json,shutil
from pathlib import Path
p=Path(__file__).resolve().parents[1]
source=Path('E:/RustedWarfare_Reunion/mods/units/GW_BattleUniverse_DLC_0087')
target=p/'shared/pilots.json';data=json.loads(target.read_text('utf-8'))
for faction,name in [('AEUG','奥古'),('TITANS','提坦斯'),('NEO_ZEON','新吉翁')]:
 for kind,title in [('Common','一般兵'),('Officer','指挥官')]:
  ident=f'Pilot_{faction}_0087_{kind}_1';ref=f'Resource/Image/Units/Icon/{ident}.png';file=source/ref
  if not file.exists():continue
  shutil.copyfile(file,p/'assets/pilots'/f'{ident}.png')
  entry={'id':ident,'name':name+title,'faction':faction,'source':ref,'sourceSha256':hashlib.sha256(file.read_bytes()).hexdigest(),'icon':f'assets/pilots/{ident}.png'}
  data['portraits']=[v for v in data['portraits'] if v['id']!=ident]+[entry]
target.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n','utf-8')
