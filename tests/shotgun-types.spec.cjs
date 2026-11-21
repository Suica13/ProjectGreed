const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('beam shotgun previews use corrected names, labels, icons and encyclopedia filters',async({page})=>{
  test.setTimeout(90000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
  await page.locator('#shellHangar').click();await page.evaluate(()=>{I18n.setLanguage('zh');Formation.previewUnit('RGM_79HC');});
  const weapon=page.locator('#formationDetailSlots .weapon-card[data-weapon-id="EF_BeamSprayGunE2"]');
  await expect(weapon.locator('.weapon-name')).toHaveText('光束霰弹枪');
  await expect(weapon.locator('.weapon-class-tag')).toHaveText('光束霰弹枪');
  await expect(weapon.locator('.weapon-type-icon')).toHaveAttribute('data-weapon-class','beam_shotgun');
  await weapon.locator('.weapon-type-icon').evaluate(image=>image.decode());
  await weapon.locator('.weapon-encyclopedia-link').click();
  await page.locator('#encyclopediaType').selectOption('beam_shotgun');
  await expect(page.locator('#encyclopediaList .weapon-type-icon').first()).toBeVisible();
  const classes=await page.locator('#encyclopediaList .weapon-type-icon').evaluateAll(images=>images.map(image=>image.dataset.weaponClass));
  expect(classes.length).toBeGreaterThan(5);expect(classes.every(kind=>kind==='beam_shotgun')).toBe(true);
  expect(errors).toEqual([]);
});
