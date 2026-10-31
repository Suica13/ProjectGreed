const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createServer } = require('../server.js');

for (const width of [2400, 1440, 390]) {
  test('content fills its pane and encyclopedia filters work at ' + width, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
    await page.waitForFunction(() => assetsReady);
    for (const view of ['menu', 'formation', 'pilots', 'production', 'development', 'records', 'encyclopedia']) {
      await page.evaluate(view => MenuShell.go(view), view);
      const geometry = await page.evaluate(() => {
        const screen = [...document.querySelectorAll('body > .menu-screen')].find(e => !e.hidden);
        const s = screen.getBoundingClientRect(), panel = screen.querySelector(':scope > .modal').getBoundingClientRect();
        const style = getComputedStyle(screen);
        return { left: panel.left - s.left - parseFloat(style.paddingLeft), right: s.right - panel.right - parseFloat(style.paddingRight), top: panel.top - s.top - parseFloat(style.paddingTop), bottom: s.bottom - panel.bottom - parseFloat(style.paddingBottom), scroll: document.documentElement.scrollWidth, width: innerWidth };
      });
      for (const side of ['left', 'right', 'top', 'bottom']) expect(Math.abs(geometry[side]), view + ' ' + side).toBeLessThan(2);
      expect(geometry.scroll).toBeLessThanOrEqual(geometry.width);
    }
    await expect(page.locator('#shellEncyclopedia')).toHaveAttribute('aria-pressed', 'true');
    await page.locator('#encyclopediaFaction').selectOption('');
    const cards = page.locator('.encyclopedia-unit');
    await expect(cards).toHaveCount(await page.evaluate(() => Rules.catalog.prefabs.length));
    await expect(page.locator('.encyclopedia-more')).toHaveCount(0);
    const typeFilters = await page.evaluate(() => {
      const read = id => [...document.getElementById(id).children].map(node => ({
        tag: node.tagName, label: node.label,
        options: node.tagName === 'OPTGROUP'
          ? [...node.children].map(option => [option.value, option.textContent])
          : [[node.value, node.textContent]],
      }));
      return { formation: read('formationType'), encyclopedia: read('encyclopediaType') };
    });
    expect(typeFilters.encyclopedia).toEqual(typeFilters.formation);
    await page.locator('#encyclopediaType').selectOption('environment:space');
    await expect(page.locator('#encyclopediaList')).toHaveAttribute('data-rendering', 'false');
    expect(await cards.count()).toBe(await page.evaluate(() => Rules.catalog.prefabs.filter(p => (p.stats.adaptability?.space ?? 0) >= 90).length));
    await page.locator('#encyclopediaType').selectOption('');
    await expect(page.locator('#encyclopediaList')).toHaveAttribute('data-rendering', 'false');

    const positions = await cards.evaluateAll(nodes => nodes.slice(0, 3).map(n => ({ x: n.offsetLeft, y: n.offsetTop })));
    expect(positions[0].y).toBe(positions[1].y);
    expect(positions[1].x).toBeGreaterThan(positions[0].x);
    expect(positions[2].y).toBeGreaterThan(positions[0].y);
    if (width !== 2400) await page.screenshot({ path: 'tmp/encyclopedia-' + width + '.png' });
    await page.locator('#encyclopediaSearch').fill('RX_78_4');
    await expect(cards).toHaveCount(2);
    await cards.first().getByRole('button', { name: '详细', exact: true }).click();
    await expect(page.locator('#formationUnitDetail')).toBeVisible();
    await page.locator('#closeFormationDetail').click();
    await expect(page.locator('#encyclopediaScreen')).toBeVisible();
    await page.locator('#encyclopediaSearch').fill('');
    await page.locator('#encyclopediaWeaponsTab').click();
    await page.locator('#encyclopediaType').selectOption('beam');
    await page.locator('#encyclopediaLevel').selectOption('2');
    await expect(page.locator('#encyclopediaList .weapon-card').first()).toBeVisible();
    const names = await page.locator('#encyclopediaList .weapon-name').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/Lv\.2$/);
    await page.locator('#encyclopediaType').selectOption('irradiation');
    await page.locator('#encyclopediaLevel').selectOption('');
    await expect(page.locator('#encyclopediaList .weapon-card').first()).toBeVisible();
    expect(await page.locator('#encyclopediaList .weapon-total-damage').first().textContent()).not.toBe('0');
    await page.locator('#encyclopediaSearch').fill('no-weapon-exists-here');
    await expect(page.locator('#encyclopediaCount')).toHaveText('0');
    expect(errors).toEqual([]);
  });
}

test('online room membership survives encyclopedia navigation and live snapshots', async ({ page }) => {
  const app = createServer({ host: '127.0.0.1', port: 0 });
  const address = await app.listen(), base = `http://127.0.0.1:${address.port}`;
  try {
    await page.goto(base);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(base => Lobby.reconnect(base), base);
    await expect(page.locator('#lobby')).toBeVisible();
    await page.locator('#createRoom').click();
    await page.locator('#roomCode').fill('ENCYCLOPEDIA');
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await page.waitForFunction(() => Net.active && Net.snapshot && !Net.awaiting);
    const identity = await page.evaluate(() => ({ room: Net.room, member: Net.memberId, seat: Net.seat }));
    for (const view of ['encyclopedia', 'production', 'development', 'room']) {
      await page.evaluate(view => MenuShell.go(view), view);
      await page.evaluate(() => Net.request('sync'));
      await page.waitForFunction(() => !Net.awaiting);
      expect(await page.evaluate(() => ({ room: Net.room, member: Net.memberId, seat: Net.seat }))).toEqual(identity);
      expect(await page.evaluate(() => pageView)).toBe(view);
    }
    const room = await page.locator('#roomMain').boundingBox();
    const container = await page.locator('#roomPreparation').boundingBox();
    expect(container.width - room.width).toBeLessThan(30);
    expect(container.height - room.height).toBeLessThan(30);
  } finally {
    await page.close();
    await app.close();
  }
});
