"""Add large ground battlefields and an orbital map without replacing existing hand-edited maps."""
import json
import math
from collections import deque
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "assets"
COLORS = dict(plain="#56654d", forest="#234b38", rubble="#72776b", rock="#777d74", water="#224c60", highland="#9c986b")

def create_map(identifier, players, width, height, names, descriptions, biome="forest", vertical=False):
    tiles = [["plain"] * width for _ in range(height)]
    spawns = []
    for position in range(players):
        for team in range(2):
            if vertical:
                x, y = 5 + position * 12 + team, 3 if team == 0 else height - 4
            else:
                x, y = (4 if team == 0 else width - 5), 5 + position * 11 + team * 2
                if players == 3: y = 5 + position * 12 + team
            spawns.append(dict(team=team, position=position + 1, x=x, y=y))
    return dict(id=identifier, environment="ground", name=names[0]+f" · {players}v{players}", description=descriptions[0],
        localization={lang:dict(name=name+f" · {players}v{players}",description=description)
            for lang,name,description in zip(["zh","en","ja"],names,descriptions)},
        width=width,height=height,playersPerTeam=players,deploymentRadius=4,spawns=spawns,
        appearance=dict(biome=biome,colors=COLORS.copy()),tiles=tiles)

def patch(m, cx, cy, rx, ry, kind):
    for y in range(max(0,cy-ry),min(m["height"],cy+ry+1)):
        for x in range(max(0,cx-rx),min(m["width"],cx+rx+1)):
            if ((x-cx)/rx)**2+((y-cy)/ry)**2 <= 1 + .10*math.sin(x*1.7+y*.9):
                m["tiles"][y][x]=kind

def rect(m, x, y, width, height, kind):
    for row in range(max(0,y),min(m["height"],y+height)):
        for col in range(max(0,x),min(m["width"],x+width)):m["tiles"][row][col]=kind

def finish(m):
    for spawn in m["spawns"]:
        for y in range(m["height"]):
            for x in range(m["width"]):
                if abs(x-spawn["x"])+abs(y-spawn["y"])<=4:m["tiles"][y][x]="plain"
    start=(m["spawns"][0]["x"],m["spawns"][0]["y"])
    seen={start}; queue=deque([start])
    while queue:
        x,y=queue.popleft()
        for xx,yy in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
            if 0<=xx<m["width"] and 0<=yy<m["height"] and (xx,yy) not in seen and m["tiles"][yy][xx] not in ("water","rock"):
                seen.add((xx,yy));queue.append((xx,yy))
    assert len(seen)==sum(t not in ("water","rock") for row in m["tiles"] for t in row),m["id"]
    (ASSETS/"maps"/(m["id"]+".json")).write_text(json.dumps(m,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def space_expansion():
    maps=[]
    m=create_map("asteroid_crossing_1v1",1,26,22,
        ["小行星航路","Asteroid Crossing","小惑星航路"],
        ["紧凑宇宙战场：弯曲的小行星群切分中央航道，北侧残骸密集，南侧留有较宽的绕行空间。",
         "A compact space battlefield with a curved asteroid chain, northern debris cover and a broad southern flank route.",
         "湾曲する小惑星群が中央航路を分ける宇宙戦場。北の残骸地帯と南の広い迂回路を使い分ける。"],biome="space")
    m["spawns"][0]["y"]=9;m["spawns"][1]["y"]=12
    for x,y,w,h in [(9,3,2,2),(13,6,2,3),(16,12,2,2),(11,17,2,1),(19,3,1,2)]:rect(m,x,y,w,h,"rock")
    for x,y,w,h in [(7,2,2,1),(16,4,3,2),(9,8,2,2),(13,12,2,1),(7,17,2,2),(19,18,2,1)]:rect(m,x,y,w,h,"rubble")
    maps.append(m)

    m=create_map("colony_wreck_3v3",3,40,38,
        ["破碎殖民卫星","Shattered Colony","砕けたコロニー"],
        ["三线宇宙战场：断裂的殖民卫星外壳与残骸形成交错掩体；中央缺口适合交火，南北外缘可跨线支援。",
         "Three staggered fronts through broken colony hulls and wreckage, with a central breach and northern and southern reinforcement routes.",
         "破断したコロニー外壁と残骸が三つの戦線を形成。中央の裂け目と南北の外周路から他戦線を支援できる。"],biome="space")
    for x,y,w,h in [(12,4,2,3),(17,8,3,1),(25,5,2,2),(28,13,2,3),(21,18,2,2),(12,22,2,3),(19,28,3,1),(28,29,2,3),(23,34,2,1)]:rect(m,x,y,w,h,"rock")
    for x,y,w,h in [(10,8,3,2),(19,4,3,2),(24,11,2,2),(14,15,3,2),(25,21,3,2),(17,24,2,2),(11,30,3,2),(24,31,2,2),(32,24,2,2)]:rect(m,x,y,w,h,"rubble")
    maps.append(m)

    m=create_map("outer_orbit_5v5",5,52,56,
        ["外围宙域","Outer Orbit","外縁宙域"],
        ["大型宇宙会战：北部密集舰船残骸、中部开阔航道与南部零散小行星带各具特点；多条横向通道便于五路协同。",
         "A large space battle with dense northern shipwrecks, open central lanes and scattered southern asteroids, linked by lateral reinforcement corridors.",
         "北の艦船残骸、中央の開けた航路、南の小惑星帯が特徴の大規模宇宙戦場。横断航路で五つの戦線を連携できる。"],biome="space")
    for x,y,w,h in [(12,4,3,2),(22,8,4,2),(34,3,3,3),(16,14,2,3),(32,17,3,2),(25,27,2,2),(11,36,2,3),(22,42,2,2),(35,37,3,2),(31,49,2,2),(15,51,2,1)]:rect(m,x,y,w,h,"rock")
    for x,y,w,h in [(10,8,4,2),(18,4,2,2),(28,5,3,2),(36,11,3,2),(22,14,4,2),(12,22,2,2),(34,26,2,2),(20,34,3,1),(28,39,3,2),(16,44,2,2),(38,46,2,2),(24,51,3,1)]:rect(m,x,y,w,h,"rubble")
    maps.append(m)
    for m in maps:
        m["environment"]="space"
        m["appearance"]["colors"].update(plain="#10152b",rubble="#60647f",rock="#47445e",water="#182147",highland="#77708e")
    return maps


def register_maps(maps):
    for m in maps:finish(m)
    catalog_path=ASSETS/"unit-catalog.json"
    catalog=json.loads(catalog_path.read_text(encoding="utf-8"))
    for m in maps:
        reference="maps/"+m["id"]+".json"
        if reference not in catalog["maps"]:catalog["maps"].append(reference)
    catalog["maps"].sort(key=lambda ref:json.loads((ASSETS/ref).read_text(encoding="utf-8"))["playersPerTeam"])
    catalog_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Added:",", ".join(m["id"] for m in maps))


def main():
    maps=[]
    m=create_map("central_heights_3v3",3,36,36,
        ["中央高原","Central Heights","中央高原"],
        ["中央连片高地与南北侧道；西北废墟密集，东南坡面开阔，适合争夺中央后分线推进。",
         "A central plateau with northern and southern flank routes, dense northwest ruins and open southeast slopes.",
         "中央の広い高地と南北の迂回路。北西の廃墟と南東の開けた斜面から進路を選べる。"])
    patch(m,18,17,9,12,"highland")
    for x,y,w,h in [(11,7,3,2),(16,12,2,2),(23,18,2,3),(13,24,3,2),(25,28,2,2),(7,29,2,1)]:rect(m,x,y,w,h,"rubble")
    for x,y in [(10,9),(25,12),(17,28),(21,7)]:rect(m,x,y,1,1,"rock")
    patch(m,7,14,2,4,"forest");patch(m,28,25,2,3,"forest")
    maps.append(m)

    m=create_map("serpentine_rainforest_3v3",3,36,36,
        ["蛇河雨林","Serpentine Rainforest","蛇行河の熱帯雨林"],
        ["横贯中央的S型河将雨林分成南北两岸，西、中、东三处渡口连接大片林区，桥头零散遗迹提供掩护。",
         "A horizontal S-shaped river divides dense rainforest into two banks, linked by three offset crossings and scattered bridgehead ruins.",
         "中央を横切るS字の川が熱帯雨林を南北に分断。三つの渡河路と橋頭の遺跡を巡って戦う。"],vertical=True)
    m["appearance"]["colors"].update(plain="#476749",forest="#173f31",water="#225c6b",highland="#809864")
    for cx,cy,rx,ry in [(8,8,8,6),(25,9,10,7),(9,27,9,7),(27,27,8,8)]:patch(m,cx,cy,rx,ry,"forest")
    for x in range(m["width"]):
        river=18+round(4*math.sin((x-3)*2*math.pi/35))
        rect(m,x,river-1,1,3,"water")
    for x in [8,19,29]:rect(m,x,11,2,15,"plain")
    for x,y in [(7,12),(20,24),(28,14),(11,25),(24,5)]:rect(m,x,y,2,1,"rubble")
    maps.append(m)

    m=create_map("military_base_5v5",5,48,56,
        ["联合军事基地","Joint Military Base","合同軍事基地"],
        ["十个出生点沿基地两侧展开；北部机库与中部仓库形成零散掩体，南部停机坪开阔，外围道路可跨线支援。",
         "Ten deployment zones flank hangars, warehouses and open southern aprons, with perimeter roads for reinforcement.",
         "基地の両側に十の出撃地点。北の格納庫、中央倉庫、南の開けた駐機場と外周路を使い分ける。"],biome="urban")
    m["appearance"]["colors"].update(plain="#3c484d",rubble="#7b868a",highland="#858b76")
    for x,y,w,h in [(10,3,5,3),(20,5,6,3),(32,3,5,4),(15,13,4,3),(28,16,5,3),(10,25,4,4),(22,28,5,3),(33,29,4,4),(16,40,4,2),(29,45,3,3),(23,51,5,2)]:
        rect(m,x,y,w,h,"rubble")
        if h>=3:rect(m,x+1,y+1,max(1,w-3),1,"rock")
    patch(m,8,44,2,5,"forest");patch(m,39,11,2,4,"forest")
    maps.append(m)

    m=create_map("great_plains_5v5",5,48,56,
        ["双岭大平原","Twin Ridge Plains","双丘大平原"],
        ["北部与南部两片高地夹着宽阔平原；中央掩体稀少，北岭散落废墟、南岭林带不规则分布，适合大范围机动。",
         "Northern and southern highlands frame a wide exposed plain; northern ruins and irregular southern woods offer flanking cover.",
         "南北の高地に挟まれた広い平原。中央の遮蔽物は少なく、北の廃墟と南の林帯から迂回できる。"])
    patch(m,22,8,24,9,"highland");patch(m,27,48,25,9,"highland")
    for x,y,w,h in [(12,7,2,2),(29,10,3,2),(36,46,2,2),(19,27,2,1),(31,33,1,2)]:rect(m,x,y,w,h,"rubble")
    patch(m,13,45,4,3,"forest");patch(m,34,49,3,4,"forest")
    rect(m,23,17,1,1,"rock");rect(m,30,39,1,1,"rock")
    maps.append(m)
    m=create_map("orbital_debris_2v2",2,32,28,
        ["轨道残骸带","Orbital Debris Field","軌道デブリ帯"],
        ["宇宙战场：小行星与殖民卫星残骸零散分布，中央航道开阔，两翼残骸提供掩护。",
         "A space battlefield with scattered asteroids and colony wreckage, an open central lane and debris cover on both flanks.",
         "小惑星とコロニー残骸が点在する宇宙戦場。中央の開けた航路と両翼の残骸を使い分ける。"],biome="space")
    m["environment"]="space"
    m["appearance"]["colors"].update(plain="#10152b",rubble="#60647f",rock="#47445e",water="#182147",highland="#77708e")
    for x,y,w,h in [(8,2,2,2),(20,4,3,2),(11,10,2,2),(24,14,2,2),(8,23,3,2),(18,20,2,2)]:rect(m,x,y,w,h,"rock")
    for x,y,w,h in [(13,4,3,2),(6,12,2,2),(20,11,2,1),(13,18,3,2),(23,24,3,1)]:rect(m,x,y,w,h,"rubble")
    maps.append(m)
    maps.extend(space_expansion())
    register_maps(maps)
    catalog=json.loads((ASSETS/"unit-catalog.json").read_text(encoding="utf-8"))
    for ref in catalog["maps"]:
        p=ASSETS/ref;d=json.loads(p.read_text(encoding="utf-8"))
        d.setdefault("environment", "ground")
        d["appearance"]["colors"].setdefault("highland","#9c986b")
        p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("Added:",", ".join(m["id"] for m in maps))

if __name__=="__main__":
    import argparse
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--space-only",action="store_true",help="Generate only the three additional space maps.")
    options=parser.parse_args()
    if options.space_only:register_maps(space_expansion())
    else:main()