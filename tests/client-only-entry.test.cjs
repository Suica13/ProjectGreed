const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createServer } = require('../server.js');

test('game server and normal client exclude the separately launched catalog editor', async t => {
  for (const file of ['client/source-editor.js', 'client/source-editor.css', 'tools/developer-api.cjs'])
    assert.equal(fs.existsSync(file), false, file);
  assert.equal(require('../package.json').scripts['build:developer'], 'node build.cjs --developer');
  assert.doesNotMatch(fs.readFileSync('public/client.html', 'utf8'), /id="catalog-developer"|window\.CatalogDeveloper =/);
  const app = createServer({ port: 0, host: '127.0.0.1' });
  const address = await app.listen();
  t.after(() => app.close());
  const base = `http://127.0.0.1:${address.port}`;
  for (const path of ['/developer.html', '/api/developer/session', '/api/developer/unit', '/api/developer/reload', '/api/editor/session'])
    assert.equal((await fetch(base + path)).status, 404, path);
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/map-editor.html')).status, 200);
  assert.equal((await fetch(base + '/admin/activities.html')).status, 200);
});
