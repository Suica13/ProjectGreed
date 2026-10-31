const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

test('weapon panels keep grade labels and equal Unit 4 wrist damage across languages', async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(() => assetsReady);
  for (const language of ['zh', 'en', 'ja']) {
    const result = await page.evaluate(language => {
      I18n.setLanguage(language);
      const model = UnitModels.RX_78_4__kit_1;
      const wrists = model.weapons.filter(w => /^Common_ArmBR_Pink/.test(w.id));
      const panel = document.createElement('div');
      for (const weapon of wrists) panel.append(WeaponInfo.summary(weapon));
      const rifle = model.weapons.find(w => w.category === 'beam_rifle' && !/Arm/.test(w.id));
      return {
        names: [...panel.querySelectorAll('.weapon-name')].map(n => n.textContent),
        totals: [...panel.querySelectorAll('.weapon-total-damage')].map(n => n.textContent),
        rifleScale: rifle.beamDamageScale,
        wristScales: wrists.map(w => w.beamDamageScale ?? 1),
      };
    }, language);
    expect(result.names).toHaveLength(2);
    for (const name of result.names) expect(name).toMatch(/Lv\.2$/);
    expect(result.totals).toEqual(['9,750', '9,750']);
    expect(result.rifleScale).toBe(1.5);
    expect(result.wristScales).toEqual([1, 1]);
  }
});
