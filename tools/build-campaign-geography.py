"""Build continuous campaign land territories over Natural Earth's public-domain coastlines.
Generation only: pip install shapely numpy. The client needs no GIS dependency.
python tools/build-campaign-geography.py [--dependencies path/to/temporary/packages]
"""
import argparse
import json
import sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--dependencies')
args = parser.parse_args()
if args.dependencies:
    sys.path.insert(0, args.dependencies)
from shapely.geometry import shape, Polygon, Point, box
from shapely import make_valid
from shapely.ops import unary_union
from shapely.affinity import scale, affine_transform

ROOT = Path(__file__).resolve().parents[1]
spec = json.loads((ROOT/'shared/campaign-geography.json').read_text(encoding='utf-8'))
world = json.loads((ROOT/'shared/campaign-world.json').read_text(encoding='utf-8'))
width, height = spec['width'], spec['height']
low, high = spec['latitudeBounds']
def project(lon, lat):
    return ((lon+180)*width/360, (high-lat)*height/(high-low))

def projected(geometry):
    sx, sy = width / 360, height / (high-low)
    return make_valid(affine_transform(geometry, [sx, 0, 0, -sy, 180*sx, high*sy]))

def halfplane(points, a, b):
    nx, ny = b[0]-a[0], b[1]-a[1]
    limit = (b[0]*b[0]+b[1]*b[1]-a[0]*a[0]-a[1]*a[1])/2
    result = []
    for i, end in enumerate(points):
        start = points[i-1]
        before = start[0]*nx+start[1]*ny-limit
        after = end[0]*nx+end[1]*ny-limit
        if (before <= 0) != (after <= 0):
            t = before/(before-after)
            result.append((start[0]+t*(end[0]-start[0]),start[1]+t*(end[1]-start[1])))
        if after <= 0:
            result.append(end)
    return result

def polygons(geometry):
    if geometry.geom_type == 'Polygon':
        return [geometry]
    return [p for child in getattr(geometry,'geoms',[]) for p in polygons(child)]

def path(geometry):
    parts = []
    for polygon in polygons(geometry):
        if polygon.area < .2:
            continue
        for ring in [polygon.exterior,*polygon.interiors]:
            coords=list(ring.coords)[:-1]
            parts.append('M'+'L'.join(f'{x:.1f},{y:.1f}' for x,y in coords)+'Z')
    return ''.join(parts)

source=json.loads((ROOT/'assets/geography/ne_110m_land.geojson').read_text(encoding='utf-8'))
land=unary_union([shape(f['geometry']) for f in source['features']]).intersection(box(-180,low,180,high)).simplify(.18,preserve_topology=True)
africa=land.intersection(Polygon([(-20,-40),(55,-40),(55,12),(43,12),(35,30),(32,32),(10,38),(-6,37),(-20,30)]))
greenland=next(p for p in polygons(land) if p.contains(Point(-42,72)))
americas=land.intersection(box(-180,-60,-25,85)).union(greenland)
australia=land.intersection(box(112,-48,160,-10))
new_zealand=land.intersection(box(165,-50,180,-30))
asia=land.difference(unary_union([africa,americas,australia,new_zealand]))
scopes={name:projected(area) for name,area in [('africa',africa),('americas',americas),('australia',australia),('asia',asia)]}
groups={
'americas': 'alaska canada canada_east greenland california america new_york central_america andes south_america jaburo'.split(),
'africa':'dakar north_africa central_africa kilimanjaro south_africa'.split(),
'australia':'australia_west australia_north torrington'.split(),
}
regions=spec['regions']
for r in regions:
    r['center']=[round(v,1) for v in project(*r['lonLat'])]
land_territories=[]
for r in regions:
    if r['kind']=='sea':
        rx,ry={'hawaii':(32,29),'north_atlantic':(42,38),'south_atlantic':(39,43),'indian_ocean':(55,48),'south_pacific':(39,43)}[r['id']]
        geometry=scale(Point(*r['center']).buffer(1,quad_segs=24),rx,ry)
        if r['id']=='south_pacific':geometry=geometry.union(projected(new_zealand))
    else:
        group=next((name for name,ids in groups.items() if r['id'] in ids),'asia')
        points=[(0,0),(width,0),(width,height),(0,height)]
        for other in regions:
            if other['kind']!='land' or other['id']==r['id']:
                continue
            other_group=next((name for name,ids in groups.items() if other['id'] in ids),'asia')
            if group==other_group:points=halfplane(points,r['center'],other['center'])
        geometry=make_valid(Polygon(points)).intersection(scopes[group])
        land_territories.append(geometry)
    r['path']=path(geometry)
    assert r['path'],r['id']
    largest=max(polygons(geometry),key=lambda polygon:polygon.area)
    r['polygon']=[[round(x,1),round(y,1)] for x,y in list(largest.exterior.coords)[:-1]]
# The continental partition must cover the original land without gaps or overlaps.
coverage=unary_union([*land_territories, projected(new_zealand)])
assert coverage.symmetric_difference(projected(land)).area < .1, "Uncovered coastline"
assert abs(sum(area.area for area in land_territories)-unary_union(land_territories).area) < .1, "Overlapping land regions"
world.update(width=width,height=height,regions=regions,geographyVersion=2,landPath=path(projected(land)),legacyRegionIds=spec['legacyRegionIds'],references=spec['references'])
(ROOT/'shared/campaign-world.json').write_text(json.dumps(world,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Built',len(regions),'Earth regions with coastline paths')
