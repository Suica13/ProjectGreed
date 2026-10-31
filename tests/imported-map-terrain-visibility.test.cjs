const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const M = require('../shared/map-document.js');
const View = require('../shared/tilemap-view.js');

for (const id of ['a_baoa_qu_space_3v3', 'colony_interior_3v3', 'mass_driver_facility_3v3']) {
  test(id + ' displays embedded art without painting terrain attributes over it', () => {
    const map = JSON.parse(fs.readFileSync(path.join(__dirname, '../assets/maps', id + '.json'), 'utf8'));
    const doc = M.importMap(map);
    const terrainLayers = doc.layers.filter(l => l.type === 'tile' && !l.decorative);
    assert.ok(terrainLayers.length > 0);
    for (const layer of terrainLayers) {
      assert.equal(layer.visible, true, 'terrain must still participate in gameplay');
      assert.equal(layer.opacity, 0);
    }
    const compiled = M.compile(doc);
    assert.deepEqual(compiled.tiles, map.tiles);
    assert.deepEqual(compiled.cellEnvironments, map.cellEnvironments);
    assert.deepEqual(M.importMap(compiled), doc, 'reimport preserves transparent terrain');
    let images = 0;
    const ctx = {
      save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
      drawImage() { images++; },
      fillRect() { assert.fail('terrain attribute colors must not cover the background'); },
    };
    View.create({ loadImage: () => ({ width: 1, height: 1 }) }).draw(ctx, doc, 'below', {
      ox: 0, oy: 0, cellWidth: 1, cellHeight: 1, width: doc.width, height: doc.height,
    });
    assert.ok(images > 0, 'embedded background remains visible');
  });
}
