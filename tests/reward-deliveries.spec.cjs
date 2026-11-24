const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
test('pending rewards flash the delivery button and accepting the last unit clears it',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.locator('#profileCompanyName').fill('Reward Delivery');await page.locator('#profileOnboardingConfirm').click();
 await page.locator('#shellHangar').click();await page.evaluate(()=>WarehouseUI.open());
 const button=page.locator('#warehouseDeliveries');await expect(button).not.toHaveClass(/has-deliveries/);
 await page.evaluate(()=>Economy.creditActivity({id:'delivery-ui',matchId:'delivery-ui',money:0,supplies:0,inventory:{RGM_79:1}}));
 await expect(button).toHaveClass(/has-deliveries/);await expect(button).toContainText('(1/200)');
 expect(await button.evaluate(el=>getComputedStyle(el).animationName)).toBe('warehouse-deliveries-pulse');
 await button.click();await expect(page.locator('.warehouse-delivery-list')).toContainText('吉姆');
 await page.evaluate(()=>Economy.receiveDeliveries());await expect(button).not.toHaveClass(/has-deliveries/);
 await expect(button).toContainText('(0/200)');
});
