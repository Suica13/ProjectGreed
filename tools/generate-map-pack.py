"""Generate the ten-map expansion. Run manually; builds never overwrite map edits."""
import json
import random
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PALETTES = {
    'arctic': dict(plain='#617f8d', forest='#385b57', rubble='#818f98', rock='#becbd0', water='#173f5b'),
    'urban': dict(plain='#2c333b', forest='#394e40', rubble='#606a75', rock='#454c59', water='#193f52'),
    'desert': dict(plain='#a18153', forest='#806d46', rubble='#83735c', rock='#c1a578', water='#326e70'),
    'wetland': dict(plain='#385950', forest='#234b38', rubble='#687368', rock='#777d74', water='#224c60'),
}
# Each variant has its own layout; left/right symmetry preserves equal approaches.
SPECS = [
 ('arctic_base_1v1', 1, 'arctic', 'base', ('极地研究基地','Polar Research Base','極地研究基地'),
  ('多掩体：机库与研究楼残骸围绕中央跑道，侧路可迂回。','Heavy cover: hangar ruins surround a central runway with side approaches.','遮蔽物が多い基地。中央滑走路と側道を使い分ける。')),
 ('new_york_ruins_1v1', 1, 'urban', 'city', ('纽约废墟街区','New York Ruins','ニューヨーク廃墟街'),
  ('密集掩体：废墟街区与十字街道交错，适合短距离交战。','Dense rubble blocks and crossing streets favor close engagements.','密集した瓦礫と交差道路。近距離戦向け。')),
 ('open_dunes_1v1', 1, 'desert', 'open', ('无遮沙海','Open Dune Sea','開けた砂海'),
  ('几乎无掩体：中央沙海开阔，仅边缘有少量岩丘。','Almost no cover: open central dunes with a few rocks near the edges.','遮蔽物はほぼなく、外縁に少数の岩場がある。')),
 ('ice_bridges_2v2', 2, 'arctic', 'bridges', ('冰河双桥','Twin Ice Bridges','氷河の二橋'),
  ('双通道：冰河切开战场，上下两座宽桥连接两岸，桥头有废墟掩体。','Two crossings: a frozen river splits the field, with broad bridges and ruined bridgeheads.','氷河を渡る上下二本の橋。橋頭堡に瓦礫の遮蔽物。')),
 ('new_york_boulevards_2v2', 2, 'urban', 'boulevards', ('纽约中央大道','New York Boulevards','ニューヨーク中央大通り'),
  ('开阔道路与密集街区并存：中央大道暴露，两侧街区可相互支援。','Exposed central boulevards contrast with dense supporting blocks on either side.','開けた中央大通りと密集市街が対照的な戦場。')),
 ('desert_depots_2v2', 2, 'desert', 'depots', ('沙漠补给站','Desert Supply Depots','砂漠の補給基地'),
  ('零散废墟：补给站残骸形成孤立掩体，站点之间是开阔沙地。','Scattered depot ruins provide isolated cover separated by exposed sand.','点在する補給基地の残骸。拠点間は開けた砂地。')),
 ('arctic_fortress_3v3', 3, 'arctic', 'fortress', ('北极防卫线','Arctic Defense Line','北極防衛線'),
  ('分区防线：三片基地掩体通过横向走廊连接，可守点或转移支援。','Three fortified sectors linked by cross corridors support defense and reinforcement.','三つの防衛区画を連絡路がつなぐ。守備と増援向け。')),
 ('new_york_crossfire_3v3', 3, 'urban', 'crossfire', ('纽约三线交火','New York Crossfire','ニューヨーク三戦線'),
  ('多掩体三线：每条战线均有废墟街区，中间巷道允许上下调动。','Three rubble-heavy lanes with connecting alleys for shifting forces.','瓦礫の多い三戦線。路地を通じて戦力を移動できる。')),
 ('desert_highway_3v3', 3, 'desert', 'highway', ('沙漠远征公路','Desert Expedition Highway','砂漠遠征道路'),
  ('低掩体：大部分区域无遮挡，只有少量路旁废墟和两段岩脊。','Low cover: a broad exposed field with sparse roadside ruins and two ridges.','遮蔽物は少なく、沿道に少数の瓦礫と二つの岩稜。')),
 ('marsh_islands_1v1', 1, 'wetland', 'marsh', ('湿地遗迹','Wetland Relics','湿地の遺跡'),
  ('额外地图：林地掩体与水塘交错，中央遗迹和两翼通路提供不同路线。','Bonus map: forest cover and pools surround central relics and flanking paths.','追加マップ。森林と水池、中央遺跡と両翼の迂回路。')),
]


def generate(spec, index):
    ident, players, biome, layout, names, descriptions = spec
    width, height = 26, {1:20, 2:28, 3:38}[players]
    lanes = {1:[10], 2:[7,20], 3:[6,19,32]}[players]
    tiles = [['plain'] * width for _ in range(height)]
    rng = random.Random(7900 + index)

    def put(x,y,kind):
        if 0 <= x < width and 0 <= y < height:
            tiles[y][x] = tiles[y][width-1-x] = kind

    def rect(x,y,w,h,kind):
        for yy in range(y,y+h):
            for xx in range(x,x+w): put(xx,yy,kind)

    if layout == 'base':
        for y in [3,13]:
            rect(7,y,5,4,'rubble'); rect(9,y+1,2,2,'rock')
        rect(5,5,1,10,'rubble')
        for y in [1,18]: rect(4,y,6,1,'forest')
    elif layout in ('city','crossfire'):
        centers = [4,10,16] if players == 1 else lanes
        for cy in centers:
            rect(5,cy-4,7,9,'rubble') if players == 3 else rect(6,cy-2,6,5,'rubble')
            rect(8,cy-1,2,2,'rock')
            rect(12,cy-2,1,2,'rubble')
        for y in range(2,height-2):
            if y % 4 == 0: put(4,y,'forest')
    elif layout == 'open':
        for x,y in [(9,2),(7,17),(11,1)]: put(x,y,'rock')
        put(9,16,'forest');put(7,3,'forest')
    elif layout == 'bridges':
        rect(11,0,2,height,'water')
        for cy in lanes:
            rect(11,cy-1,2,4,'plain')
            rect(8,cy-3,2,2,'rubble');rect(8,cy+3,2,2,'rubble')
        for y in [1,13,26]: rect(5,y,3,1,'forest')
    elif layout == 'boulevards':
        for cy in [4,9,18,23]:
            rect(6,cy-1,6,3,'rubble');rect(8,cy,2,1,'rock')
        for y in range(height):
            if y in range(12,16): rect(0,y,13,1,'plain')
        rect(12,0,1,height,'plain')
    elif layout == 'depots':
        for cy in [4,14,24]:
            rect(9,cy-1,3,2,'rubble');put(10,cy-1,'rock')
        for x,y in [(6,11),(8,19),(5,2),(7,26)]:put(x,y,'forest')
    elif layout == 'fortress':
        for cy in lanes:
            rect(6,cy-3,6,7,'rubble');rect(8,cy-1,2,2,'rock')
            rect(12,cy-2,1,5,'forest')
            rect(7,cy,6,1,'plain')
        for y in [12,25]: rect(0,y,13,2,'plain')
        rect(11,0,2,2,'water');rect(11,height-2,2,2,'water')
    elif layout == 'highway':
        for cy in [12,25]: rect(9,cy-1,2,3,'rock')
        for cy in lanes:
            rect(7,cy+2,2,1,'rubble');put(10,cy-2,'forest')
    elif layout == 'marsh':
        rect(9,0,4,4,'water');rect(9,16,4,4,'water')
        rect(11,8,2,4,'rubble')
        for y in range(2,height-2):
            for x in range(5,11):
                if tiles[y][x] == 'plain' and rng.random() < .55:put(x,y,'forest')
        rect(0,5,13,1,'plain');rect(0,14,13,1,'plain')

    spawns=[]
    for position,y in enumerate(lanes,1):
        for team,x in [(0,3),(1,width-4)]:
            spawns.append(dict(team=team,position=position,x=x,y=y))
            for yy in range(height):
                for xx in range(width):
                    if abs(xx-x)+abs(yy-y)<=3:tiles[yy][xx]='plain'
    # Every walkable cell must be reachable; no isolated units or sealed pockets.
    start=(spawns[0]['x'],spawns[0]['y']);seen={start};queue=deque([start])
    while queue:
        x,y=queue.popleft()
        for xx,yy in [(x+1,y),(x-1,y),(x,y+1),(x,y-1)]:
            if 0<=xx<width and 0<=yy<height and (xx,yy) not in seen and tiles[yy][xx] not in ('rock','water'):
                seen.add((xx,yy));queue.append((xx,yy))
    walkable=sum(t not in ('rock','water') for row in tiles for t in row)
    assert len(seen)==walkable, (ident,'disconnected terrain')
    name=names[0]+f' · {players}v{players}'
    return dict(id=ident,name=name,description=descriptions[0],
        localization={lang:dict(name=title+f' · {players}v{players}',description=description)
            for lang,title,description in zip(['zh','en','ja'],names,descriptions)},
        width=width,height=height,playersPerTeam=players,deploymentRadius=3,spawns=spawns,
        appearance=dict(biome=biome,colors=PALETTES[biome]),tiles=tiles)


def main():
    catalog_path=ROOT/'assets/unit-catalog.json'
    catalog=json.loads(catalog_path.read_text(encoding='utf-8'))
    for index,spec in enumerate(SPECS):
        data=generate(spec,index)
        reference='maps/'+data['id']+'.json'
        (ROOT/'assets'/reference).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        if reference not in catalog['maps']:catalog['maps'].append(reference)
        cover=sum(t in ('forest','rubble') for row in data['tiles'] for t in row)/(data['width']*data['height'])
        print(data['id'],f'cover={cover:.1%}')
    catalog_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__=='__main__':main()