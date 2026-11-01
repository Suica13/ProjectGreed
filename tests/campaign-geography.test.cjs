const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../assets/maps/strategy/earth_0079_mid');
const world = require(path.join(root, 'world.json'));
const source = require(path.join(root, 'geography-source.json'));
const walkable = tile => !['water', 'rock'].includes(tile);
const maps = new Map(world.regions.map(region => [region.id,
  JSON.parse(fs.readFileSync(path.join(root, 'local-battles', `${region.id}_5v5.json`), 'utf8'))]));

test('regional maps retain a uniform north-up projection and usable deployment areas', () => {
  const signatures = new Set();
  for (const region of world.regions) {
    const map = maps.get(region.id), geo = map.geography;
    assert.equal(geo.regionId, region.id);
    assert.equal(geo.orientation, 'north-up');
    assert.equal(map.width, 57);
    assert.equal(map.height, 68);
    const [left, top, right, bottom] = geo.worldBounds;
    assert(Math.abs((right-left)/map.width - (bottom-top)/map.height) < 1e-6);
    assert.equal(Object.values(geo.terrainCounts).reduce((a,b) => a+b, 0), map.width*map.height);
    signatures.add(JSON.stringify(map.tiles));
    for (const area of map.deploymentAreas) {
      let count = 0;
      for (let y=area.y; y<area.y+area.height; y++)
        for (let x=area.x; x<area.x+area.width; x++) count += walkable(map.tiles[y][x]);
      assert(count >= 72, `${region.id}: deployment capacity`);
    }
    if (region.kind !== 'land') continue;
    const base = map.strategic.nodes.find(n => n.kind === 'base');
    const queue = [[base.x, base.y]], seen = new Set([`${base.x},${base.y}`]);
    for (let i=0; i<queue.length; i++) {
      const [x,y] = queue[i];
      for (const [nx,ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
        const key = `${nx},${ny}`;
        if (nx<0 || ny<0 || nx>=map.width || ny>=map.height || seen.has(key) || !walkable(map.tiles[ny][nx])) continue;
        seen.add(key); queue.push([nx,ny]);
      }
    }
    for (const point of [...map.strategic.nodes, ...map.strategic.gates])
      assert(seen.has(`${point.x},${point.y}`), `${region.id}: inaccessible ${point.id}`);
  }
  assert.equal(signatures.size, 43);
  assert(maps.get('greenland').geography.terrainCounts.snow > 500);
  assert(maps.get('north_africa').geography.terrainCounts.desert > 500);
  assert(maps.get('japan').geography.terrainCounts.water > 500);
});

test('touching regions have reciprocal strategic links and matching local entrances', () => {
  for (const [a,b] of [['india','kazakhstan'], ['scandinavia','odessa'],
    ['kazakhstan','beijing'], ['beijing','india'], ['arabia','kilimanjaro']]) {
    for (const [from,to] of [[a,b],[b,a]]) {
      assert(world.regions.find(r => r.id===from).links.includes(to));
      assert(source.regions.find(r => r.id===from).links.includes(to));
      assert(maps.get(from).strategic.gates.some(g => g.region===to));
    }
  }
  assert.equal(maps.get('india').strategic.gates.find(g => g.region==='kazakhstan').side, 'north');
  assert.equal(maps.get('kazakhstan').strategic.gates.find(g => g.region==='india').side, 'south');
});

test('India and Kazakhstan accept strategic movement in both directions', () => {
  const C = require('../shared/campaign.js'), G = require('../shared/rules.js');
  const ctx = {G, world, production:require('../shared/production-data.cjs'), development:require('../shared/development.js')};
  const members = [{seat:0}, {seat:1}];
  for (const [from,to] of [['india','kazakhstan'], ['kazakhstan','india']]) {
    const state = C.create(ctx, members);
    for (const r of state.regions) if ([from,to].includes(r.id)) r.owner = 0;
    state.units = [];
    const unit = C.addUnit(ctx, state, 0, from, 'Type61');
    C.action(ctx, state, members, 0, {action:'campaign_move', turn:state.turn, ids:[unit.id], region:to});
    assert.equal(unit.moveTo, to);
  }
});
