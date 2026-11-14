const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.resolve('public/map-editor.html')).href;

for (const width of [1440, 768, 390]) test(`mission editor map picking and dock layout at ${width}px`, async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({width, height: 950});
  await page.goto(url);
  await page.evaluate(() => {
    MapEditor.importMap(structuredClone(MissionEditorData.sample));
    MapEditor.tab('mission');
    MapEditor.fit();
  });
  const layout = await page.evaluate(() => {
    const rect = s => { const r = document.querySelector(s).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}; };
    return {tabs: rect('.editor-tabs'), map: rect('.workspace'), tools: rect('aside.left'), canvas: rect('#viewport'), overflow: document.body.scrollWidth > innerWidth};
  });
  expect(layout.tabs.bottom).toBeLessThanOrEqual(layout.map.y + 1);
  expect(layout.map.bottom).toBeLessThanOrEqual(layout.tools.y + 1);
  expect(layout.canvas.height).toBeGreaterThan(100);
  expect(layout.tools.width).toBe(width);
  expect(layout.overflow).toBe(false);
  const marker = await page.evaluate(() => {
    const a = MapEditor.document.mission.actors.find(a => a.id === 'whitebase'), d = MapEditor.document, c = MapEditor.camera;
    const r = document.getElementById('mapCanvas').getBoundingClientRect();
    return {x:r.x+c.x+(a.x+.5)*d.tileWidth*c.zoom,y:r.y+c.y+(a.y+.5)*d.tileHeight*c.zoom};
  });
  const before = await page.evaluate(() => JSON.stringify(MapEditor.document.layers));
  await page.mouse.click(marker.x, marker.y);
  const actor = page.locator('[data-actor-id="whitebase"]');
  await expect(actor).toHaveAttribute('open', '');
  await expect(actor).toHaveClass(/selected-actor/);
  await expect(actor.getByLabel('脚本单位 ID', {exact:true})).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(MapEditor.document.layers))).toBe(before);
  const stacked = await page.evaluate(() => {
    const actors = MapEditor.document.mission.actors;
    const a = actors.find(a => actors.filter(b => b.x === a.x && b.y === a.y).length > 1);
    MapEditor.focusCell(a.x, a.y);
    const same = actors.filter(b => b.x === a.x && b.y === a.y);
    return {ids:same.map(a => a.id)};
  });
  const box = await page.locator('#mapCanvas').boundingBox();
  await page.mouse.click(box.x+box.width/2,box.y+box.height/2);
  await expect(page.locator('#missionMapPicker button')).toHaveCount(stacked.ids.length);
  await page.locator('#missionMapPicker button').last().click();
  expect(await page.evaluate(() => MissionEditor.selectedActorId)).toBe(stacked.ids.at(-1));
  await page.locator('#floatPanel').click();
  await expect(page.locator('aside.left')).toHaveClass(/floating-panel/);
  const handle = await page.locator('#panelHandle strong').boundingBox();
  await page.mouse.move(handle.x+10, handle.y+8); await page.mouse.down();
  await page.mouse.move(handle.x+35, handle.y+28); await page.mouse.up();
  await page.locator('#floatPanel').click();
  await expect(page.locator('aside.left')).not.toHaveClass(/floating-panel/);
  await page.locator('[data-tab="layers"]').click();
  await expect(page.locator('#layerName')).toBeVisible();
  expect(errors).toEqual([]);
});

test('renaming a script actor updates nested conditions, dialogue, spawn and protected targets atomically', async ({page}) => {
  await page.goto(url);
  const result = await page.evaluate(() => {
    MapEditor.importMap(structuredClone(MissionEditorData.sample));
    const m = MapEditor.document.mission;
    m.victory = {type:'defeat_actor',actor:'whitebase'};
    m.events.push({id:'rename-test',name:'whitebase',when:{type:'all',conditions:[{type:'actor_destroyed',actor:'whitebase'}]},actions:[{type:'spawn',actors:['whitebase']},{type:'dialogue',lines:[{actor:'whitebase',name:'whitebase',text:'whitebase'}]}]});
    MissionEditor.renameActor('whitebase','musai_1');
    const renamed = structuredClone(MapEditor.document.mission);
    let duplicate = false, invalid = false;
    try { MissionEditor.renameActor('musai_1',renamed.actors[1].id); } catch { duplicate = true; }
    try { MissionEditor.renameActor('musai_1','INVALID ID'); } catch { invalid = true; }
    document.getElementById('undo').click();
    return {renamed,duplicate,invalid,undo:MapEditor.document.mission};
  });
  expect(result.renamed.actors[0].id).toBe('musai_1');
  expect(result.renamed.protect).toContain('musai_1');
  expect(result.renamed.victory.actor).toBe('musai_1');
  const event = result.renamed.events.at(-1);
  expect(event.when.conditions[0].actor).toBe('musai_1');
  expect(event.actions[0].actors).toEqual(['musai_1']);
  expect(event.actions[1].lines[0]).toEqual({actor:'musai_1',name:'whitebase',text:'whitebase'});
  expect(event.name).toBe('whitebase');
  expect(result.duplicate && result.invalid).toBe(true);
  expect(result.undo.actors[0].id).toBe('whitebase');
  expect(result.undo.protect).toContain('whitebase');
});
