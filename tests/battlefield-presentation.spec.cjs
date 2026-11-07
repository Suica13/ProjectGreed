const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('native facility sizes, SL team highlights and compact non-overlapping phase HUD', async ({ page }) => {
  test.setTimeout(60000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await expect(page.locator('#openSkirmish')).toBeEnabled();
  await page.evaluate(() => {
    const original = createRoomEngine;
    createRoomEngine = options => (window.bfEngine = original({ ...options, aiDelayMs: 999999 }));
    Formation.current = () => [{ unitId: 'Type61', kitId: 'standard' }];
  });
  await page.locator('#openSkirmish').click();
  await page.locator('#offlineRoomMode').selectOption('battlefield');
  await page.locator('#createOfflineRoom').click();
  await page.locator('#startRoomGame').click();
  await page.locator('#confirmFinalFormation').click();
  await expect(page.locator('#phaseTitle')).toHaveText('部署');
  await expect(page.locator('.phase-row #deploymentPanel')).toBeHidden();
  await expect(page.locator('.phase-row #hint')).toBeHidden();
  await page.locator('#confirmDeployment').click();
  await expect(page.locator('#battlefieldStatus')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !BattleAssets.loading)).toBe(true);
  const sizes = await page.evaluate(() => {
    const result = [];
    for (const suffix of ['HQ', 'MG', 'Beam', 'Missile', 'Cannon', 'Radar']) {
      const model = 'Facility_' + suffix + '__standard';
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 512;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const scale = 80 / Rules.mapCellPixels * ART.presentation.unitMapScale /
        ART.presentation.mapCellScale * UnitModels[model].presentation.mapScale;
      SpriteRenderer.draw(ctx, model, 256, 256, scale, 0, 'ImportedIdle', 0,
        null, true, false, false, {}, 0, false, false, 'space');
      const pixels = ctx.getImageData(0, 0, 512, 512).data;
      let left = 512, right = 0, top = 512, bottom = 0;
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++)
        if (pixels[(y * 512 + x) * 4 + 3] > 30) {
          left = Math.min(left, x); right = Math.max(right, x + 1);
          top = Math.min(top, y); bottom = Math.max(bottom, y + 1);
        }
      result.push({ suffix, span: Math.max(right - left, bottom - top) });
    }
    return result;
  });
  for (const size of sizes) expect(Math.abs(size.span - (size.suffix === 'HQ' ? 240 : size.suffix === 'Radar' ? 80 : 40))).toBeLessThan(4);
  expect(await page.evaluate(() => ART.units.find(unit => unit.id === "Facility_Cannon__standard").decals.map(layer => layer.name))).toContain('C');
  // Capture uses actual native SL assets; owned sites add blue/red light pixels.
  await expect.poll(() => page.evaluate(() => {
    const points = game.battlefield.points;
    const original = points.map(point => point.owner);
    const counts = [];
    for (const owner of [null, 0, 1]) {
      points.forEach(point => { point.owner = owner; });
      const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 300;
      const ctx = canvas.getContext('2d');
      const first = points[0];
      BattlefieldUI.draw(ctx, 200 - (first.x + .5) * 60, 150 - (first.y + .5) * 60, 60);
      const pixels = ctx.getImageData(0, 0, 400, 300).data;
      let blue = 0, red = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] > 100 && pixels[i + 2] > pixels[i] + 40) blue++;
        if (pixels[i + 3] > 100 && pixels[i] > pixels[i + 2] + 40) red++;
      }
      counts.push({ blue, red });
    }
    points.forEach((point, i) => { point.owner = original[i]; });
    return counts[1].blue > counts[0].blue + 10 && counts[2].red > counts[0].red + 10;
  })).toBe(true);
  for (const width of [1600, 1000, 700, 390, 844]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 844 ? 390 : 1000 });
    for (const language of ['zh', 'en', 'ja']) {
      await page.evaluate(language => { I18n.setLanguage(language); update(); }, language);
      await expect.poll(() => page.evaluate(() => {
        const hud = document.querySelector('#battlefieldStatus').getBoundingClientRect();
        const phase = document.querySelector('.hud-phase-controls').getBoundingClientRect();
        const controls = document.querySelector('.hud-top-controls').getBoundingClientRect();
        const overlap = rect => rect.left < hud.right && rect.right > hud.left && rect.top < hud.bottom && rect.bottom > hud.top;
        return overlap(phase) || overlap(controls) ||
          (phase.left < controls.right && phase.right > controls.left && phase.top < controls.bottom && phase.bottom > controls.top);
      })).toBe(false);
      const before = await page.locator('.hud-phase-controls').boundingBox();
      await page.locator('#phaseTitle').evaluate(el => { el.textContent = 'AI'; });
      const after = await page.locator('.hud-phase-controls').boundingBox();
      expect(after.width).toBe(before.width);
      expect(after.height).toBe(before.height);
      expect(after.width).toBe(88);
      expect(after.height).toBe(36);
    }
  }
  expect(errors).toEqual([]);
});
