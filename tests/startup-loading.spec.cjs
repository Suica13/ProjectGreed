const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const url = pathToFileURL(path.resolve('public/client.html')).href;
for (const viewport of [{width:844,height:390},{width:390,height:844}]) {
 test(`startup reports real progress and opens menu ${viewport.width}x${viewport.height}`, async ({page}) => {
  await page.setViewportSize(viewport);
  await page.addInitScript(() => {
   const NativeImage = Image;
   let first = true;
   window.Image = class extends NativeImage {
    set src(value) {
     if (first) { first = false; window.releaseTexture = () => { super.src = value; }; }
     else super.src = value;
    }
   };
  });
  await page.goto(url);
  await expect(page.locator('#resourceLoading')).toBeVisible();
  await expect(page.locator('#mobileLandscapeTip')).toHaveCount(0);
  await expect(page.locator('#start')).toBeHidden();
  await page.waitForFunction(() => byId('resourceProgress').value > 0);
  const progress = await page.locator('#resourceProgress').evaluate(el => ({value:el.value,max:el.max}));
  expect(progress.value).toBeGreaterThan(0);
  expect(progress.value).toBeLessThan(progress.max);
  await page.evaluate(() => window.releaseTexture());
  await page.waitForFunction(() => assetsReady);
  await expect(page.locator('#resourceLoading')).toBeHidden();
  await expect(page.locator('#start')).toBeVisible();
  expect(await page.locator('#resourceProgress').evaluate(el => el.value === el.max)).toBe(true);
  await page.locator('#openSkirmish').click();
  await expect(page.locator('#skirmishSetup')).toBeVisible();
 });
}
test('failed resource keeps menu blocked and offers reload', async ({page}) => {
 await page.addInitScript(() => {
  const NativeImage = Image;
  let first = true;
  window.Image = class extends NativeImage {
   set src(value) {
    if (first) { first = false; setTimeout(() => this.onerror?.(new Event('error')), 50); }
    else super.src = value;
   }
  };
 });
 await page.goto(url);
 await expect(page.locator('#resourceLoadingError')).toBeVisible();
 await expect(page.locator('#retryResourceLoading')).toBeVisible();
 await expect(page.locator('#resourceLoading')).toHaveAttribute('aria-busy','false');
 await expect(page.locator('#start')).toBeHidden();
 expect(await page.evaluate(() => assetsReady)).toBe(false);
});
