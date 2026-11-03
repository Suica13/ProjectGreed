"""Rasterize the strategic projection into deterministic, playable local terrain.

GIS dependencies are generation-only. Exported maps are ordinary tile JSON.
North stays up; ocean entrances remain water, with an island at the central base.
"""
import hashlib
import heapq
import json
import math
import re
from collections import Counter
from pathlib import Path

import numpy as np
from shapely import contains_xy, make_valid
from shapely.affinity import affine_transform, translate
from shapely.geometry import GeometryCollection, Point, Polygon, box, shape
from shapely.ops import unary_union

ROOT = Path(__file__).resolve().parents[1]
VERSION = 2
WALKABLE = {'plain', 'snow', 'desert', 'highland', 'forest', 'rubble'}
COLORS = {'plain': '#65765d', 'snow': '#d6e0e5', 'desert': '#c0a474',
          'highland': '#918b72', 'forest': '#345944', 'rubble': '#6e7371',
          'rock': '#777973', 'water': '#264e68'}


def polygons(geometry):
    if geometry.geom_type == 'Polygon':
        yield geometry
    else:
        for child in getattr(geometry, 'geoms', []):
            yield from polygons(child)


def svg_geometry(path, center=None, wrap=1200):
    geometry = GeometryCollection()
    for ring in re.findall(r'M([^Z]+)Z', path):
        coords = [tuple(map(float, point.split(','))) for point in ring.split('L')]
        if center is not None:
            coords = [(x + round((center-x)/wrap)*wrap, y) for x, y in coords]
        if len(coords) >= 3:
            geometry = make_valid(geometry.symmetric_difference(make_valid(Polygon(coords))))
    return geometry


class RegionalGeography:
    def __init__(self, world):
        self.world = world
        self.wrap = world['width']
        self.land = self.wrapped(svg_geometry(world['landPath']))
        self.features = []
        for layer in ['rivers_lake_centerlines', 'lakes', 'geography_regions_polys']:
            data = json.loads((ROOT / f'assets/geography/ne_110m_{layer}.geojson').read_text(encoding='utf-8'))
            for feature in data['features']:
                properties = feature['properties']
                self.features.append((properties['kind'], properties['name'],
                                      self.wrapped(self.project(shape(feature['geometry'])))))

    def project(self, geometry):
        width, height = self.world['width'], self.world['height']
        return make_valid(affine_transform(geometry, [width/360, 0, 0, -height/145,
                                                       width/2, 85*height/145]))

    def wrapped(self, geometry):
        return unary_union([translate(geometry, xoff=offset) for offset in [-self.wrap, 0, self.wrap]])

    def generate(self, region, battle):
        width, height = battle['width'], battle['height']
        territory = svg_geometry(region['path'], region['center'][0], self.wrap)
        parts = list(polygons(territory))
        largest = max(part.area for part in parts)
        extent = unary_union([part for part in parts if part.area >= max(.2, largest*.003)])
        left, top, right, bottom = extent.bounds
        # One projected scale for both axes, rather than stretching the coastline.
        scale = max((right-left)/(width-8), (bottom-top)/(height-8), .1)
        cx, cy = (left+right)/2, (top+bottom)/2
        left, top = cx-width*scale/2, cy-height*scale/2
        right, bottom = left+width*scale, top+height*scale
        xs, ys = np.meshgrid(left+(np.arange(width)+.5)*scale,
                             top+(np.arange(height)+.5)*scale)
        land = contains_xy(self.land, xs, ys)
        owned = contains_xy(territory, xs, ys)
        latitude = 85-ys*145/self.world['height']
        longitude = (xs*360/self.wrap-180+180) % 360-180
        seed = int.from_bytes(hashlib.sha256(region['id'].encode()).digest()[:4], 'big')
        gy, gx = np.indices((height, width))
        noise = ((gx//3*73856093) ^ (gy//3*19349663) ^ seed) % 100
        tiles = np.full((height, width), 'water', dtype='<U10')
        tiles[land] = 'plain'
        cold = np.abs(latitude) >= 58
        tropical = np.abs(latitude) < 15
        wooded = land & ((tropical & (noise < 75)) | ((~tropical) & (noise < 32)))
        tiles[wooded] = 'forest'
        tiles[land & cold] = 'snow'
        # Broad climatic belts supplement the intentionally coarse physical layer.
        dry = (((longitude > 35) & (longitude < 60) & (latitude > 15) & (latitude < 33)) |
               ((longitude > 115) & (longitude < 143) & (latitude > -34) & (latitude < -20)) |
               ((longitude > 12) & (longitude < 25) & (latitude > -29) & (latitude < -17)))
        tiles[land & dry] = 'desert'
        names = []
        viewport = box(left, top, right, bottom)
        rivers = []
        for kind, name, geometry in self.features:
            if not geometry.intersects(viewport):
                continue
            if kind == 'River':
                rivers.append(geometry)
                mask = contains_xy(geometry.buffer(scale*.34), xs, ys) & land
                tiles[mask] = 'water'
            else:
                mask = contains_xy(geometry, xs, ys) & land
                if kind == 'Lake': tiles[mask] = 'water'
                elif kind == 'Desert': tiles[mask] = 'desert'
                elif kind == 'Tundra': tiles[mask] = 'snow'
                elif kind in ['Range/mtn', 'Plateau']:
                    tiles[mask] = 'highland'
                    tiles[mask & (noise < 14)] = 'rock'
            if name and np.any(contains_xy(geometry.buffer(scale*.5), xs, ys) & owned):
                names.append(name)
        battle['tiles'] = tiles.tolist()
        layout = battle['strategic']
        pads = []
        occupied = []
        candidates = [(x, y) for y in range(3, height-3) for x in range(3, width-3)
                      if land[y, x] and owned[y, x] and battle['tiles'][y][x] != 'water']
        if not candidates:
            candidates = [(x, y) for y in range(3, height-3) for x in range(3, width-3)
                          if land[y, x] and battle['tiles'][y][x] != 'water']
        # Ocean objectives are naval stations, not invented continents.
        naval = region['kind'] == 'sea'
        for node in layout['nodes']:
            if node['kind'] == 'base' and not naval:
                desired = ((region['center'][0]-left)/scale-.5,
                           (region['center'][1]-top)/scale-.5)
            else:
                desired = (node['x'], node['y'])
            choices = candidates if not naval else []
            spaced = [point for point in choices if all(math.dist(point, p) >= 7 for p in occupied)]
            if spaced:
                node['x'], node['y'] = min(spaced, key=lambda p: math.dist(p, desired))
            elif choices:
                node['x'], node['y'] = min(choices, key=lambda p:
                    math.dist(p, desired) + sum(max(0, 7-math.dist(p, q))*30 for q in occupied))
            occupied.append((node['x'], node['y']))
            if battle['tiles'][node['y']][node['x']] == 'water' and (not naval or node['kind'] == 'base'): pads.append(node['id'])
            # Only the central naval base gets an island; outposts remain water.
            if not naval or node['kind'] == 'base':
                self.clear_pad(battle, node['x'], node['y'], 5 if naval else 1)
            if node['kind'] == 'base' and region.get('factory'):
                self.urbanize(battle, node['x'], node['y'])
        for gate in layout['gates']:
            side = gate['side']
            edge = ([(gate['x'], y) for y in range(5, height-5)] if side in ['west', 'east'] else
                    [(x, gate['y']) for x in range(5, width-5)])
            shore = [(x, y) for x, y in edge if land[y, x]]
            if shore and not naval:
                gate['x'], gate['y'] = min(shore, key=lambda p: math.dist(p, (gate['x'], gate['y'])))
            if not naval and battle['tiles'][gate['y']][gate['x']] == 'water': pads.append(gate['id'])
            if not naval:
                self.clear_pad(battle, gate['x'], gate['y'], 3)
        # Seats are metadata, not encounter-style left/right deployment strips.
        # The campaign adapter places real armies at their base/arrival gate.
        base = next(node for node in layout['nodes'] if node['kind'] == 'base')
        for spawn in battle['spawns']:
            spawn.update(x=base['x'], y=base['y'])
        battle.pop('deploymentAreas', None)
        battle.pop('deploymentExpansion', None)
        # Ground objectives receive connected approach roads with the least terrain
        # disruption. Ocean maps retain water supply lanes and require transports.
        roads = []
        if not naval:
            base = layout['nodes'][0]
            for point in [*layout['nodes'][1:], *layout['gates']]:
                route = self.route(battle, (base['x'], base['y']), (point['x'], point['y']))
                roads.append(route)
                for x, y in route:
                    self.clear_pad(battle, x, y, 1, only_obstacles=True)
        lookup = {node['id']: node for node in [*layout['nodes'], *layout['gates']]}
        for line in layout['links']:
            a, b = lookup[line['a']], lookup[line['b']]
            if a['id'].startswith('gate_'):
                node = min(layout['nodes'], key=lambda n: math.dist((a['x'], a['y']), (n['x'], n['y'])))
                line['b'] = node['id']
        stats = Counter(tile for row in battle['tiles'] for tile in row)
        dominant = stats.most_common(1)[0][0]
        biome = 'arctic' if dominant == 'snow' else 'desert' if dominant == 'desert' else 'wetland' if dominant == 'water' else 'forest' if dominant == 'forest' else 'urban'
        battle['appearance'] = {'biome': biome, 'colors': COLORS}
        battle['geography'] = {'version': VERSION, 'regionId': region['id'], 'orientation': 'north-up',
            'projection': 'strategic-equirectangular', 'worldBounds': [round(v, 6) for v in [left, top, right, bottom]],
            'worldUnitsPerTile': scale, 'physicalFeatures': sorted(set(names)),
            'landingPlatforms': pads, 'terrainCounts': dict(stats),
            'source': 'world.json region path + Natural Earth 1:110m physical layers',
            'groundApproaches': roads}
        return battle

    @staticmethod
    def clear_pad(battle, x, y, radius, only_obstacles=False):
        for yy in range(max(0, y-radius), min(battle['height'], y+radius+1)):
            for xx in range(max(0, x-radius), min(battle['width'], x+radius+1)):
                if not only_obstacles or battle['tiles'][yy][xx] in ['water', 'rock']:
                    battle['tiles'][yy][xx] = 'plain'

    @staticmethod
    def urbanize(battle, x, y):
        for yy in range(max(0,y-3), min(battle['height'],y+4)):
            for xx in range(max(0,x-3), min(battle['width'],x+4)):
                if battle['tiles'][yy][xx] in WALKABLE and max(abs(xx-x),abs(yy-y)) >= 2:
                    battle['tiles'][yy][xx] = 'rubble'

    @staticmethod
    def route(battle, start, end):
        """Dijkstra prefers real land and passes; water crossings cost much more."""
        queue = [(0, start)]; distances = {start: 0}; previous = {}
        while queue:
            cost, point = heapq.heappop(queue)
            if cost != distances[point]: continue
            if point == end: break
            x, y = point
            for nx, ny in [(x-1,y),(x+1,y),(x,y-1),(x,y+1)]:
                if not (0 <= nx < battle['width'] and 0 <= ny < battle['height']): continue
                tile = battle['tiles'][ny][nx]
                next_cost = cost + (60 if tile == 'water' else 5 if tile == 'rock' else 1)
                if next_cost < distances.get((nx,ny), math.inf):
                    distances[nx,ny] = next_cost; previous[nx,ny] = point
                    heapq.heappush(queue,(next_cost,(nx,ny)))
        route = [end]
        while route[-1] != start: route.append(previous[route[-1]])
        return list(reversed(route))
