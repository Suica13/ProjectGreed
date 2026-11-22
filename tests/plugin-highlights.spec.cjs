const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
for (const width of [1440, 390]) test('plugin-modified stats and weapons use green and reset after removal ' + width, async ({ page }) => {
  test.setTimeout(90000);
  await page.setViewportSize({ width, height: 1050 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href); await page.waitForFunction(() => assetsReady);
  const id = await page.evaluate(() => {
    I18n.setLanguage('zh'); Economy.creditActivity({ id: 'green-plugin', matchId: 'green-plugin', money: 100000, supplies: 0, inventory: { RGM_79: 1 } });
    for(const id of ['frame','generator','long_beam','short_beam','shield'])Economy.purchasePlugin('anaheim',id);
    return Economy.snapshot().storage.units[0].id;
  });
  await page.locator('#shellHangar').click(); await page.locator(`#warehouseBays [data-stock-id="${id}"]`).click();
  await expect(page.locator('#warehouseDialog .plugin-modified-value')).toHaveCount(0);
  await page.evaluate(id => {
    ['frame', 'generator', 'long_beam', 'shield'].forEach((part, slot) => Economy.setStoredPlugin(id, slot, part)); WarehouseUI.openItem(id);
  }, id);
  for (const label of ['HP', 'EN']) {
    const value = page.locator('#warehouseMainStats dt').filter({ hasText: new RegExp('^' + label + '$') }).locator('xpath=following-sibling::dd[1]');
    await expect(value).toHaveClass('plugin-modified-value'); await expect(value).toHaveCSS('color', 'rgb(120, 229, 160)');
  }
  await expect(page.locator('#warehouseMainStats dd').first()).not.toHaveClass('plugin-modified-value');
  await page.getByRole('button', { name: '武装列表', exact: true }).click();
  async function checkWeapons() {
    const expected = await page.evaluate(id => {
      const item = Economy.snapshot().storage.units.find(item => item.id === id), base = UnitModels[item.unitId + '__' + item.kitId], model = UnitPlugins.apply(base, item.plugins);
      return model.weapons.map((weapon, index) => ({ id: weapon.id, range: weapon.max !== base.weapons[index].max, hit: weapon.hit !== base.weapons[index].hit }));
    }, id);
    expect(expected.some(weapon => weapon.range || weapon.hit)).toBe(true);
    for (const weapon of expected) {
      const card = page.locator(`#warehouseWeaponList .weapon-card[data-weapon-id="${weapon.id}"]`);
      expect(await card.locator('.weapon-range').evaluate(el => el.classList.contains('plugin-modified-value'))).toBe(weapon.range);
      expect(await card.locator('.weapon-hit-rate').evaluate(el => el.classList.contains('plugin-modified-value'))).toBe(weapon.hit);
      await expect(card.locator('.weapon-total-damage')).not.toHaveClass(/plugin-modified-value/);
    }
  }
  await checkWeapons();
  const alternateKit = await page.evaluate(id => {
    const item = Economy.snapshot().storage.units.find(item => item.id === id);
    return [...document.querySelectorAll('#warehouseDetailKit option')].find(option => !option.selected && UnitModels[item.unitId + '__' + option.value]?.weapons.some(weapon => weapon.type !== 'melee' && (weapon.type === 'beam' || weapon.damageComponents?.beam > 0)))?.value;
  }, id);
  if (alternateKit) { await page.locator('#warehouseDetailKit').selectOption(alternateKit); await checkWeapons(); }
  await page.evaluate(id => { Economy.setStoredPlugin(id, 2, 'short_beam'); WarehouseUI.openItem(id); }, id);
  await checkWeapons();
  await page.screenshot({ path: `tmp/verification/screenshots/plugin-highlights-${width}.png` });
  await page.evaluate(id => { for (let slot = 0; slot < 4; slot++) Economy.setStoredPlugin(id, slot, null); WarehouseUI.openItem(id); }, id);
  await expect(page.locator('#warehouseDialog .plugin-modified-value')).toHaveCount(0);
  expect(errors).toEqual([]);
});
