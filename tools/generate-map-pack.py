"""Regenerate the five asymmetric battlefields. Builds never overwrite manual map edits."""
import json
import random
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PALETTES = {
    'arctic': dict(plain='#617f8d', forest='#385b57', rubble='#818f98', rock='#becbd0', water='#173f5b'),
    'urban': dict(plain='#2c333b', forest='#394e40', rubble='#606a75', rock='#454c59', water='#193f52'),
    'desert': dict(plain='#a18153', forest='#806d46', rubble='#83735c', rock='#c1a578', water='#326e70'),
    'forest': dict(plain='#556b47', forest='#234b38', rubble='#687368', rock='#777d74', water='#224c60'),
}
# Terrain is authored independently on every flank; spawn lanes remain broadly comparable.
SPECS = [
 ('frontier_1v1', 1, 24, 18, 'arctic', [(2,8),(21,8)],
  ('极地遗址','Polar Relics','極地の遺跡'),
  ('零散机库残骸与偏北冰塘，南侧通路开阔，可绕过中央掩体。','Scattered hangar ruins and a northern ice pool; the open southern route flanks central cover.','点在する格納庫跡と北側の氷池。南の開けた側道から迂回できる。')),
 ('open_dunes_1v1', 1, 24, 18, 'desert', [(2,7),(21,10)],
  ('风蚀沙海','Windswept Dunes','風蝕の砂海'),
  ('低掩体沙漠：零星岩丘与废弃哨站，中央大部分无遮蔽。','Low-cover desert with isolated rocks and abandoned outposts; most of the center is exposed.','岩丘と廃哨所が点在する砂漠。中央の大部分に遮蔽物はない。')),
 ('crossroads_2v2', 2, 28, 26, 'urban', [(3,6),(24,8),(3,19),(24,19)],
  ('都市断层','Fractured City','分断された都市'),
  ('零散废墟与错位街道；北部密集、南部开阔，中央斜向通路允许换线支援。','Scattered ruins and offset streets: a denser north, open south and diagonal reinforcement routes.','北側に瓦礫、南側に広場。ずれた街路と斜めの中央通路で援護できる。')),
 ('ice_bridges_2v2', 2, 28, 26, 'arctic', [(3,6),(24,7),(3,19),(24,19)],
  ('融冰河谷','Thawing Valley','雪解けの谷'),
  ('弯曲河道与错位渡口；中部宽渡口、北部窄路，桥头废墟零散分布。','A bent river with offset crossings: a broad central ford, narrow northern route and scattered bridgehead ruins.','曲がる川とずれた渡河地点。中央の広い浅瀬と北の細道、点在する橋頭跡。')),
 ('frontline_3v3', 3, 32, 36, 'forest', [(3,5),(28,7),(3,17),(28,18),(3,29),(28,30)],
  ('林海战线','Woodland Front','樹海戦線'),
  ('大片连续林地形成不规则三条战线，东南开阔地与偏北废墟提供不同进攻路线。','Large contiguous woods shape three irregular fronts; southeastern clearings and northern ruins offer different approaches.','連続する大森林に三つの不規則な戦線。南東の空地と北の廃墟で進路が変わる。')),
]


def generate(spec, index):
    ident, players, width, height, biome, positions, names, descriptions = spec
    tiles = [['plain'] * width for _ in range(height)]
    rng = random.Random(240079 + index)
    def rect(x,y,w,h,kind):
        for yy in range(max(0,y),min(height,y+h)):
            for xx in range(max(0,x),min(width,x+w)): tiles[yy][xx]=kind
    def woods(cx,cy,rx,ry):
        for y in range(max(0,cy-ry),min(height,cy+ry+1)):
            for x in range(max(0,cx-rx),min(width,cx+rx+1)):
                if ((x-cx)/rx)**2+((y-cy)/ry)**2 < 1+rng.uniform(-.12,.12): tiles[y][x]='forest'
    if ident=='frontier_1v1':
        rect(10,1,4,3,'water')
        for x,y,w,h in [(7,5,2,2),(14,6,3,2),(10,10,2,2),(17,12,2,1),(6,14,2,1)]: rect(x,y,w,h,'rubble')
        rect(8,5,1,1,'rock');rect(15,6,1,1,'rock');rect(12,15,2,1,'rock')
    elif ident=='open_dunes_1v1':
        for x,y in [(9,2),(15,14),(12,5),(7,13),(17,4)]: rect(x,y,1,1,'rock')
        rect(10,12,2,1,'rubble');rect(16,6,1,2,'rubble')
    elif ident=='crossroads_2v2':
        for x,y,w,h in [(8,2,2,2),(14,3,3,2),(19,5,2,2),(10,7,2,3),(17,10,3,2),(7,13,2,2),(13,16,3,2),(19,20,2,2),(9,23,2,1)]:
            rect(x,y,w,h,'rubble')
        for x,y in [(8,3),(15,3),(11,8),(18,10),(14,17),(19,21)]:rect(x,y,1,1,'rock')
    elif ident=='ice_bridges_2v2':
        for y in range(height):
            x=13+(1 if y<9 else -1 if y<18 else 2)
            if y not in [5,6,7,13,14,15,21,22]:rect(x,y,2,1,'water')
        for x,y,w,h in [(9,3,2,2),(17,8,2,1),(8,15,2,2),(18,18,3,2),(12,24,2,1)]:rect(x,y,w,h,'rubble')
        rect(20,2,2,1,'rock');rect(10,10,1,2,'rock')
    else:
        woods(10,8,5,7);woods(20,18,6,8);woods(11,29,5,5)
        # Clearings interrupt the fronts without cutting every tree patch into speckles.
        rect(13,5,3,3,'plain');rect(16,22,3,2,'plain');rect(21,28,7,7,'plain')
        for x,y,w,h in [(17,3,2,2),(22,9,2,1),(8,19,2,2),(15,26,2,1),(20,32,2,2)]:rect(x,y,w,h,'rubble')
        rect(17,4,1,1,'rock');rect(8,20,1,1,'rock')
    spawns=[]
    for seat,(x,y) in enumerate(positions):
        spawns.append(dict(team=seat%2,position=seat//2+1,x=x,y=y))
        for yy in range(height):
            for xx in range(width):
                if abs(xx-x)+abs(yy-y)<=4:tiles[yy][xx]='plain'
    # Validate every walkable cell and all spawn approaches are connected.
    start=positions[0];seen={start};queue=deque([start])
    while queue:
        x,y=queue.popleft()
        for xx,yy in [(x+1,y),(x-1,y),(x,y+1),(x,y-1)]:
            if 0<=xx<width and 0<=yy<height and (xx,yy) not in seen and tiles[yy][xx] not in ('rock','water'):
                seen.add((xx,yy));queue.append((xx,yy))
    assert len(seen)==sum(t not in ('rock','water') for row in tiles for t in row),ident
    assert any(row!=row[::-1] for row in tiles),ident
    return dict(id=ident,name=names[0]+f' · {players}v{players}',description=descriptions[0],
        localization={lang:dict(name=title+f' · {players}v{players}',description=description)
            for lang,title,description in zip(['zh','en','ja'],names,descriptions)},
        width=width,height=height,playersPerTeam=players,deploymentRadius=4,spawns=spawns,
        appearance=dict(biome=biome,colors=PALETTES[biome]),tiles=tiles)


def main():
    maps=[generate(spec,index) for index,spec in enumerate(SPECS)]
    directory=(ROOT/'assets/maps').resolve()
    assert directory==ROOT.resolve()/'assets/maps'
    # Rebuild the original presets, then restore the additive large-map pack.
    # Preserve additional maps and hand-authored files.
    for data in maps:
        (directory/(data['id']+'.json')).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        print(data['id'],data['width'],data['height'])
    path=ROOT/'assets/unit-catalog.json'
    catalog=json.loads(path.read_text(encoding='utf-8'))
    catalog['maps']=['maps/'+data['id']+'.json' for data in maps]+[ref for ref in catalog.get('maps',[]) if ref not in ['maps/'+data['id']+'.json' for data in maps]]
    catalog['defaultMap']=maps[0]['id']
    path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':
    main()
    import runpy
    runpy.run_path(str(ROOT / "tools/add-large-battlefields.py"), run_name="__main__")