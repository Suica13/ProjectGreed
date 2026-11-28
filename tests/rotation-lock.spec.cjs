const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
const url=pathToFileURL(path.resolve('public/client.html')).href;
for(const native of [false,true])test('rotation lock persists and unlocks '+(native?'native bridge':'browser'),async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width:390,height:844});
 await page.addInitScript(native=>{
  window.rotationCalls=[];
  Object.defineProperty(screen.orientation,'type',{value:'landscape-secondary',configurable:true});
  if(native)window.ProjectGreedAndroid={setRotationLock:value=>rotationCalls.push(value)};
  else {screen.orientation.lock=async value=>rotationCalls.push(value);screen.orientation.unlock=()=>rotationCalls.push('');document.documentElement.requestFullscreen=async()=>{};}
 },native);
 await page.goto(url);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Rotation');await page.locator('#profileOnboardingConfirm').click();
 await page.locator('#shellSettings').click();
 const toggle=page.locator('#settingsRotationLock');await expect(toggle).toBeVisible();await toggle.check();
 await expect(toggle).toBeEnabled();expect(await page.evaluate(()=>rotationCalls.at(-1))).toBe('landscape-secondary');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('projectgreed.settings')).rotationLock)).toBe('landscape-secondary');
 await page.reload();await page.waitForFunction(()=>assetsReady);await page.locator('#shellSettings').click();
 await expect(toggle).toBeChecked();expect(await page.evaluate(()=>rotationCalls.at(-1))).toBe('landscape-secondary');
 await toggle.uncheck();await expect(toggle).toBeEnabled();expect(await page.evaluate(()=>rotationCalls.at(-1))).toBe('');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('projectgreed.settings')).rotationLock)).toBe('');
});
test('unsupported orientation lock stays off with an explanation',async({page})=>{
 test.setTimeout(90000);await page.addInitScript(()=>{screen.orientation.lock=async()=>{throw Error('unsupported')};document.documentElement.requestFullscreen=async()=>{};});
 await page.goto(url);await page.waitForFunction(()=>assetsReady);await page.locator('#profileCompanyName').fill('Unsupported');await page.locator('#profileOnboardingConfirm').click();await page.locator('#shellSettings').click();
 await page.locator('#settingsRotationLock').click();await expect(page.locator('#settingsRotationLock')).not.toBeChecked();await expect(page.locator('#settingsRotationStatus')).toContainText('无法锁定');
});
