const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

for (const width of [1440, 390]) {
  test('preview links focus exact weapon and usage dialog shows all unit portraits at ' + width, async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => {
      MenuShell.go('encyclopedia');
      document.getElementById('encyclopediaFaction').value = 'ZEON';
      Formation.previewUnit('RX_78_4');
    });
    const preview = page.locator('#formationUnitDetail');
    await expect(preview).toBeVisible();
    const source = preview.locator('.weapon-card[data-weapon-id="Common_ArmBR_Pink_L"]');
    const link = source.locator('.weapon-encyclopedia-link');
    const href = await link.getAttribute('href');
    await link.click();
    await expect(preview).toBeHidden();
    await expect(page.locator('#encyclopediaScreen')).toBeVisible();
    await expect(page.locator('#encyclopediaFaction')).toHaveValue('');
    const target = page.locator('.encyclopedia-weapon-target');
    await expect(target).toBeVisible();
    await expect(target).toHaveAttribute('data-weapon-id', 'Common_ArmBR_Pink_L');
    expect('#' + await target.getAttribute('id')).toBe(href);
    await target.getByRole('button', { name: '使用单位', exact: true }).click();
    const dialog = page.locator('#weaponUsersDialog');
    await expect(dialog).toBeVisible();
    const ids = await dialog.locator('.encyclopedia-unit').evaluateAll(nodes => nodes.map(n => n.dataset.unitId));
    expect(ids).toContain('RX_78_4');
    expect(ids).toContain('RX_78_4_Bst');
    expect(new Set(ids).size).toBe(ids.length);
    await expect(dialog.locator('.encyclopedia-portrait img')).toHaveCount(ids.length);
    expect(await dialog.locator('.encyclopedia-portrait img').evaluateAll(images => images.every(image => !!image.src))).toBe(true);
    const rect = await dialog.boundingBox();
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(width);
    expect(rect.y + rect.height).toBeLessThanOrEqual(960);
    if (width === 390) await page.screenshot({ path: 'tmp/weapon-users-phone.png' });
    await dialog.locator('[data-unit-id="RX_78_4_Bst"]').getByRole('button', { name: '详细', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(preview).toBeVisible();
    await page.locator('#closeFormationDetail').click();
    await target.getByRole('button', { name: '使用单位', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(errors).toEqual([]);
  });
}

test('license preview and irradiation preview both link to their encyclopedia weapon', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => ProductionUI.openUnit('RX_78_4'));
  await page.locator('#productionWeaponsTab').click();
  await page.locator('#productionInfo .weapon-encyclopedia-link').first().click();
  await expect(page.locator('#encyclopediaScreen')).toBeVisible();
  await expect(page.locator('.encyclopedia-weapon-target')).toBeVisible();
  await page.evaluate(() => Formation.previewUnit('RX_78_4_Bst'));
  await page.locator('#formationDetailMechanicsBlock > summary').click();
  await page.locator('#formationDetailMechanics .weapon-encyclopedia-link').first().click();
  await expect(page.locator('#formationUnitDetail')).toBeHidden();
  await expect(page.locator('.encyclopedia-weapon-target')).toHaveAttribute('data-weapon-id', 'EF_RX_78_4_HighMegaLauncher');
});
