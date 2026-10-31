const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('All displays every unit and source weapon without ownership or faction restrictions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => MenuShell.go('encyclopedia'));
  await expect(page.locator('#encyclopediaFaction')).toHaveValue('');
  await expect(page.locator('#encyclopediaList')).toHaveAttribute('data-rendering', 'false');
  const coverage = await page.evaluate(() => {
    const displayed = new Set([...document.querySelectorAll('#encyclopediaList [data-unit-id]')].map(n => n.dataset.unitId));
    return { missing: Rules.catalog.prefabs.filter(p => !displayed.has(p.id)).map(p => p.id), count: displayed.size, total: Rules.catalog.prefabs.length };
  });
  expect(coverage.missing).toEqual([]);
  expect(coverage.count).toBe(coverage.total);
  await page.locator('#encyclopediaWeaponsTab').click();
  await expect(page.locator('#encyclopediaList')).toHaveAttribute('data-rendering', 'false');
  const weapons = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('#encyclopediaList .weapon-card')];
    const shown = new Set(cards.map(n => n.dataset.weaponSource + '__lv' + n.dataset.weaponLevel));
    const expected = new Set(Rules.catalog.prefabs.flatMap(p => Object.entries(p.weapons).map(([id, w]) => (w.sourceName || id) + '__lv' + w.level)));
    return { missing: [...expected].filter(id => !shown.has(id)), expected: expected.size, cards: cards.length,
      shownCount: Number(document.getElementById('encyclopediaCount').textContent),
      apLabels: cards.filter(n => n.querySelector('.weapon-ap-cost')).length };
  });
  expect(weapons.expected).toBeGreaterThan(700);
  expect(weapons.missing).toEqual([]);
  expect(weapons.cards).toBe(weapons.shownCount);
  expect(weapons.apLabels).toBe(weapons.cards);
  await expect(page.locator('.encyclopedia-more')).toHaveCount(0);
  await page.locator('#encyclopediaFaction').selectOption('ZEON');
  const filtered = Number(await page.locator('#encyclopediaCount').textContent());
  expect(filtered).toBeGreaterThan(0);
  expect(filtered).toBeLessThan(weapons.cards);
  await page.locator('#encyclopediaFaction').selectOption('');
  await expect(page.locator('#encyclopediaCount')).toHaveText(String(weapons.cards));
  expect(errors).toEqual([]);
});
