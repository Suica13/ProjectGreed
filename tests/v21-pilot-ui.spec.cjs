const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const P = require('../shared/pilots.js');
const pilot = P.custom({...P.createCustom('custom-ui-test','测试驾驶员',P.catalog.named[0].id,'EFSF'),level:2,experience:500});
const formation = [{unitId:'Medea',kitId:'standard'}, {unitId:'Type61',kitId:'standard',customPilot:pilot,preload:{carrierIndex:0,hangarId:'Hangar_1'}}];
async function open(page, viewport) {
  await page.setViewportSize(viewport);
  await page.addInitScript(({pilot,formation})=>{
    localStorage.setItem('projectgreed.combatFaction','EFSF');
    localStorage.setItem('projectgreed.custom-pilots.v2.EFSF',JSON.stringify({pilots:[pilot],awards:[]}));
    localStorage.setItem('projectgreed.custom-pilots.v2.migrated','EFSF');
    localStorage.setItem('slg-formations-v1.EFSF',JSON.stringify({version:3,squads:[{name:'头像编组',units:formation}]}));
  },{pilot,formation});
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  await page.evaluate(()=>I18n.setLanguage('zh'));
}
for(const viewport of [{width:390,height:844},{width:360,height:640},{width:844,height:390},{width:667,height:375},{width:1280,height:800}]) {
  test(`development header, page scrolling and tree ${viewport.width}x${viewport.height}`, async({page})=>{
    await open(page,viewport);
    await page.locator('#openDevelopment').click();
    const boxes=await page.locator('#developmentMain').evaluate(main=>{
      const header=main.querySelector('header'),tree=main.querySelector('.development-tree-scroll');
      return {bottom:Math.max(header.getBoundingClientRect().bottom,...[...header.children].map(e=>e.getBoundingClientRect().bottom)),treeTop:tree.getBoundingClientRect().top,treeHeight:tree.clientHeight};
    });
    expect(boxes.treeTop).toBeGreaterThanOrEqual(boxes.bottom);
    if(viewport.width<1000) {
      expect(boxes.treeHeight).toBeGreaterThanOrEqual(238);
      const scroll=await page.locator('#developmentScreen').evaluate(e=>{e.scrollTop=e.scrollHeight;return e.scrollTop;});
      expect(scroll).toBeGreaterThan(0);
      expect(await page.locator('.development-units').evaluate(e=>e.clientHeight)).toBeGreaterThanOrEqual(207);
      const rows=page.locator('.development-unit');
      await expect(rows.nth(3)).toBeInViewport();
    }
  });
}
test('faction rosters, explicit renaming, training confirm/cancel and uploaded portrait',async({page})=>{
  await open(page,{width:390,height:844});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('#openFormation').click();
  await page.locator('#formationPilotsTab').click();
  await expect(page.locator('.custom-pilot-card')).toHaveCount(1);
  await page.locator('#formationGroup').selectOption('ZEON');
  await expect(page.locator('.custom-pilot-card')).toHaveCount(0);
  await page.locator('#formationGroup').selectOption('EFSF');
  await page.locator('.custom-pilot-card').click();
  await expect(page.locator('#customPilotName')).toBeDisabled();
  await page.getByRole('button',{name:'强化射击',exact:true}).click();
  await expect(page.locator('#pilotTrainingActions')).toBeVisible();
  await page.locator('#finishCustomPilot').click();
  await page.locator('.custom-pilot-card').click();
  await expect(page.locator('#customPilotStats')).toContainText('射击 100');
  await page.locator('#renameCustomPilot').click();
  await page.locator('#customPilotName').fill('王牌[X29]');
  await page.locator('#renameCustomPilot').click();
  await expect(page.locator('#customPilotName')).toBeDisabled();
  await page.getByRole('button',{name:'强化射击',exact:true}).click();
  await page.locator('#confirmPilotTraining').click();
  await page.getByRole('button',{name:'强化射击',exact:true}).click();
  await page.locator('#cancelPilotTraining').click();
  await expect(page.locator('#customPilotStats')).toContainText('射击 101');
  await page.locator('#changeCustomPilotPortrait').click();
  await expect(page.locator('#customPilotPortraitPicker')).toBeVisible();
  await page.locator('#uploadPilotPortrait').setInputFiles(path.resolve(P.catalog.named[0].icon));
  await expect(page.locator('#customPilotPortraitPicker')).toBeHidden();
  const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('projectgreed.custom-pilots.v2.EFSF')).pilots[0]);
  expect(saved.uploadedPortrait).toMatch(/^data:image\/jpeg;base64,/);
  expect(saved.uploadedPortrait.length).toBeLessThanOrEqual(P.maxPortraitLength);
  expect(saved.stats.shooting).toBe(101);
  expect(saved.name).toBe('王牌[X29]');
  expect(saved.faction).toBe('EFSF');
  await page.locator('#finishCustomPilot').click();
  await page.locator('#formationUnitsTab').click();
  const icons=page.locator('#formationUnits img[src^="data:image/svg+xml"]');
  await expect(icons).toHaveCount(1);
  expect(await icons.first().evaluate(async img=>{await img.decode();return img.naturalWidth;})).toBe(64);
  expect(errors).toEqual([]);
});
test('unit overview integers and pilot grid; portraits in battlefield hangars',async({page})=>{
  await open(page,{width:844,height:390});
  await page.evaluate(({formation})=>{
    game=Rules.create(false,1,[formation,[{unitId:'Type61',kitId:'standard'}]],false,{costLimit:99999,unitCostLimit:99999});
    selected=game.units[1].id;phase='idle';setPageView('game');renderPanel();
  },{formation});
  await expect(page.locator('#unitPanel .unit-pilot-stats > div')).toHaveCount(8);
  await expect(page.locator('#unitPanel img[src^="data:image/svg+xml"]')).toHaveCount(1);
  expect(await page.locator('#unitPanel .stats').innerText()).not.toMatch(/\d+\.\d+/);
  await page.evaluate(()=>HangarUI.open(game.units[0]));
  await expect(page.locator('#hangarDialog')).toBeVisible();
  const icon=page.locator('#hangarDialog img[src^="data:image/svg+xml"]');
  await expect(icon).toHaveCount(1);
  expect(await icon.evaluate(async img=>{await img.decode();return img.naturalWidth;})).toBe(64);
});

test('research button unlocks technology, deducts points and persists after reload',async({page})=>{
 await open(page,{width:390,height:844});
 const target=await page.evaluate(()=>{
  Development.creditAward({id:'ui-research',matchId:'ui-match',faction:'EFSF',points:10000});
  return Development.nodes('EFSF').find(n=>n.points>0 && n.requires.every(id=>Development.unlockedTech('EFSF').includes(id)));
 });
 await page.locator('#openDevelopment').click();
 await page.locator(`[data-tech-id="${target.id}"]`).click();
 const button=page.locator('#developmentDetails').getByRole('button',{name:'开发',exact:true});
 await expect(button).toBeEnabled();await button.click();
 await expect(page.locator('#developmentPoints')).toHaveText(String(10000-target.points));
 await expect(page.locator(`[data-tech-id="${target.id}"]`)).toHaveAttribute('data-state','unlocked');
 await page.reload();await page.waitForFunction(()=>assetsReady);
 expect(await page.evaluate(id=>Development.unlockedTech('EFSF').includes(id),target.id)).toBe(true);
});
