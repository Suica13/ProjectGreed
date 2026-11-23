const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
test.use({isMobile:true,hasTouch:true});
for(const viewport of [{width:390,height:640},{width:390,height:844},{width:740,height:420}])
 test(`phone workshop scroll reveals preview and production at ${viewport.width}x${viewport.height}`,async({page,context})=>{
  test.setTimeout(60000);await page.setViewportSize(viewport);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
  await page.locator('#profileCompanyName').fill('Mobile factory');await page.locator('#profileOnboardingConfirm').click();
  await page.evaluate(()=>{I18n.setLanguage('zh');Economy.creditActivity({id:'mobile-factory-wallet',matchId:'mobile-factory-wallet',money:1000000,supplies:1000000,licenses:{RX_78_2:true},inventory:{}});ProductionUI.openUnit('RX_78_2');});
  const panel=page.locator('#productionScreen > .production-dialog');
  await expect(panel).toHaveCSS('overflow-y','auto');
  const metrics=await panel.evaluate(n=>({client:n.clientHeight,scroll:n.scrollHeight}));expect(metrics.scroll).toBeGreaterThan(metrics.client);
  const cdp=await context.newCDPSession(page),box=await panel.boundingBox();
  const swipe=async(ratio=.5)=>{
    const x=Math.floor(box.x+box.width*ratio),y=Math.floor(box.y+box.height*.8),distance=Math.floor(box.height*.6);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
    for(let i=1;i<=12;i++){
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y-distance*i/12}]});
      await page.waitForTimeout(20);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  };
  await swipe(.98);await expect.poll(()=>panel.evaluate(n=>n.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator('#productionInfo')).toHaveCSS('overflow-y','visible');
  const produce=page.locator('#produceUnit');
  for(let i=0;i<35;i++){
    if(await produce.evaluate(n=>{const a=n.getBoundingClientRect(),b=n.closest('.production-dialog').getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;}))break;
    await swipe();
  }
  await expect(produce).toBeInViewport();await expect(produce).toBeEnabled();
  expect(await produce.evaluate(n=>{const a=n.getBoundingClientRect(),b=n.closest('.production-dialog').getBoundingClientRect();return a.top>=b.top&&a.bottom<=b.bottom;})).toBe(true);
  await page.screenshot({path:`tmp/verification/screenshots/production-scroll-order-${viewport.width}-${viewport.height}.png`});
  const before=await page.evaluate(()=>({supplies:Economy.snapshot().supplies,price:Economy.productionOffer('RX_78_2',Economy.defaultKit('RX_78_2')).supplies}));
  await produce.click();expect(await page.evaluate(()=>Economy.snapshot().supplies)).toBe(before.supplies-before.price);
  expect(errors).toEqual([]);
 });
