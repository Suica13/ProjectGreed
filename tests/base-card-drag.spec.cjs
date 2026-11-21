const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const P = require('../shared/pilots');
const pilotKey = 'projectgreed.custom-pilots.v3.shared';

for (const width of [1440, 390]) test('base cards swap physical units and pilots with persistent mouse/touch drag ' + width, async ({ page }) => {
  test.setTimeout(120000);
  await page.setViewportSize({ width, height: 1050 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pilots = [P.createCustom('custom-drag-pmc-a', '驾驶员甲'), P.createCustom('custom-drag-pmc-b', '驾驶员乙'),
    ...P.catalog.aces.filter(p => p.price).slice(0, 2).map(p => P.createAce(p.id))];
  await page.addInitScript(({ pilots, key }) => {
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ pilots, awards: [] }));
  }, { pilots, key: pilotKey });
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(() => assetsReady);
  const stock = await page.evaluate(() => {
    I18n.setLanguage('zh');
    Economy.creditActivity({ id: 'drag-ui', matchId: 'drag-ui', money: 0, supplies: 0, inventory: { RGM_79: 2, Medea: 2 } });
    const first = Economy.snapshot().storage.units[0];
    Economy.setStoredPilot(first.id, 'custom-drag-pmc-a');
    return Economy.snapshot().storage;
  });
  const cdp = width === 390 ? await page.context().newCDPSession(page) : null;
  async function drag(source, target, cancel = false) {
    const a = await source.boundingBox(), b = await target.boundingBox();
    const start = { x: a.x + a.width / 2, y: a.y + a.height / 2 }, end = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    if (cdp) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
      for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * i / 8, y: start.y + (end.y - start.y) * i / 8 }] });
      await cdp.send('Input.dispatchTouchEvent', { type: cancel ? 'touchCancel' : 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 });
      if (cancel) await page.keyboard.press('Escape');
      await page.mouse.up();
    }
  }
  await page.locator('#shellHangar').click();
  for (const kind of ['units', 'ships']) {
    if (kind === 'ships') await page.locator('#warehouseShips').click();
    const [first, second] = stock[kind];
    const source = page.locator(`#warehouseBays [data-stock-id="${first.id}"] .warehouse-card-icon`), target = page.locator(`#warehouseBays [data-stock-id="${second.id}"]`);
    await drag(source, target, true);
    expect(await page.evaluate(kind => Economy.snapshot().storage[kind].map(i => [i.id, i.slot]), kind)).toEqual(stock[kind].map(i => [i.id, i.slot]));
    await drag(source, target);
    const result = await page.evaluate(kind => Economy.snapshot().storage[kind], kind);
    expect(result.find(i => i.id === first.id)).toEqual({ ...first, slot: second.slot });
    expect(result.find(i => i.id === second.id)).toEqual({ ...second, slot: first.slot });
    await expect(page.locator('#warehouseDialog')).toBeHidden();
  }
  await page.waitForTimeout(650);
  await page.locator('#warehouseUnits').click();
  await page.locator(`#warehouseBays [data-stock-id="${stock.units[0].id}"]`).click();
  await page.locator('#warehouseRelocate').click();
  await expect(page.getByRole('button', { name: '取消', exact: true })).toHaveCount(0);
  await expect(page.locator('.warehouse-relocate-pilot-info .plugin-cost').first()).toBeVisible();
  expect(await page.locator('.relocate-unit-name').first().evaluate(el => getComputedStyle(el).textAlign)).toBe('center');
  expect(await page.locator('.relocate-kit-name').first().evaluate(el => getComputedStyle(el).textAlign)).toBe('center');
  await page.locator('#warehouseClose').click();
  await expect(page.locator('#warehouseRelocate')).toBeVisible();
  await page.locator('#warehouseClose').click();
  await page.locator('#shellPilots').click();
  const savedPilots = () => page.evaluate(key => JSON.parse(localStorage.getItem(key)).pilots, pilotKey);
  for (const [tab, ids] of [['#dormPMCTab', pilots.slice(0, 2).map(p => p.id)], ['#dormACETab', pilots.slice(2).map(p => p.id)]]) {
    await page.locator(tab).click();
    const before = await savedPilots();
    await drag(page.locator(`.dorm-card[data-pilot-id="${ids[0]}"] .dorm-card-portrait > img`), page.locator(`.dorm-card[data-pilot-id="${ids[1]}"]`));
    const after = await savedPilots(), a = before.findIndex(p => p.id === ids[0]), b = before.findIndex(p => p.id === ids[1]);
    const expected = before.slice(); [expected[a], expected[b]] = [before[b], before[a]];
    expect(after).toEqual(expected);
    await expect(page.locator('.dorm-card[data-pilot-id]').first()).toHaveAttribute('data-pilot-id', ids[1]);
  }
  const persisted = await savedPilots();
  await page.screenshot({ path: `tmp/verification/screenshots/base-card-drag-${width}.png` });
  await page.reload(); await page.waitForFunction(() => assetsReady);
  expect(await savedPilots()).toEqual(persisted);
  expect(await page.evaluate(() => Economy.snapshot().storage.units.find(i => i.pilotId === 'custom-drag-pmc-a').slot)).toBe(stock.units[1].slot);
  expect(errors).toEqual([]);
});
