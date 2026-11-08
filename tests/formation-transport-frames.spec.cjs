const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('carrier outlines follow wrapped groups and resize without changing cards or preload references', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    const tank = () => ({ unitId: 'Type61', kitId: 'standard' });
    const carrier = () => ({ unitId: 'Medea', kitId: 'standard' });
    const cargo = index => ({ ...tank(), preload: { carrierIndex: index, hangarId: 'Hangar_1' } });
    localStorage.setItem('slg-formations-v1.PMC', JSON.stringify({ version: 3, squads: [
      { name: 'Transport outlines', units: [tank(), carrier(), cargo(1), cargo(1), cargo(1), tank(), carrier(), cargo(6), cargo(6)] }
    ] }));
    localStorage.setItem('projectgreed.combatFaction', 'PMC');
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);

  await page.locator('[data-shell-section=hangar]').click();
  const paths = page.locator('#formationUnits > svg path');
  await expect(paths).toHaveCount(2);
  await expect(page.locator('#formationUnits > .formation-row')).toHaveCount(9);
  await expect(page.locator('#formationUnits > .formation-row:not([data-transport-group])')).toHaveCount(2);
  const saved = await page.evaluate(() => JSON.stringify(Formation.current()));
  for (const width of [1600, 1000, 390, 1600]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await expect.poll(() => page.evaluate(() => {
      const rows = [...document.querySelectorAll('#formationUnits > .formation-row')];
      const a = rows[0].getBoundingClientRect(), b = rows[1].getBoundingClientRect();
      const frame = document.querySelector('#formationUnits > svg');
      return { columns: Math.abs(a.top - b.top) < 1 ? 2 : 1, width: Number(frame.getAttribute('width')), listWidth: document.querySelector('#formationUnits').clientWidth };
    })).toEqual(expect.objectContaining({ columns: 1, width: expect.any(Number), listWidth: expect.any(Number) }));
    const geometry = await page.evaluate(() => {
      const list = document.querySelector('#formationUnits');
      const svg = list.querySelector('svg');
      const first = svg.querySelector('[data-transport-group="1"]');
      const coords = [...first.getAttribute('d').matchAll(/[MVH]([\d.]+)(?:,([\d.]+))?/g)];
      return { width: +svg.getAttribute('width'), listWidth: list.clientWidth,
        heights: [...list.querySelectorAll(':scope > .formation-row')].map(row => row.getBoundingClientRect().height),
        horizontalEdges: (first.getAttribute('d').match(/H/g) || []).length,
        pointerEvents: getComputedStyle(svg).pointerEvents,
        xStarts: [...new Set(coords.filter(m => m[0][0] === 'M').map(m => Math.round(+m[1])))] };
    });
    expect(geometry.width).toBe(geometry.listWidth);
    expect(geometry.heights.every(height => height === 116)).toBe(true);
    expect(geometry.pointerEvents).toBe('none');
    // The single-column outline joins the carrier to its indented cargo with a step.
    expect(geometry.horizontalEdges).toBe(3);
    if (width === 390 || width === 1600) await page.screenshot({ path: `tmp/verification/screenshots/transport-frame-${width}.png` });
  }
  expect(await page.evaluate(() => JSON.stringify(Formation.current()))).toBe(saved);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-formation-index="4"]').scrollIntoViewIfNeeded();
  const scrollOffset = await page.locator('#formationUnits').evaluate(list => {
    const row = list.querySelector('[data-formation-index="4"]');
    const svg = list.querySelector('svg');
    const position = +svg.querySelector('[data-transport-group="1"]').getAttribute('d').match(/V([\d.]+)$/)[1];
    return Math.abs(svg.getBoundingClientRect().top + position - row.getBoundingClientRect().bottom);
  });
  expect(scrollOffset).toBeLessThan(4);
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.locator('[data-formation-index="1"] .formation-detail-button').click();
  await expect(page.locator('#formationUnitDetail')).toBeVisible();
  await page.locator('#closeFormationDetail').click();
  for (const index of [4, 3, 2])
    await page.locator(`[data-formation-index="${index}"]`).getByRole('button', { name: '移除', exact: true }).click();
  await expect(paths).toHaveCount(1);
  await expect(page.locator('#formationUnits > .formation-row[data-transport-group="1"]')).toHaveCount(0);
  expect(errors).toEqual([]);
});


