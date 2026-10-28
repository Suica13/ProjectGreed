const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url'),path=require('node:path');
test('attack cell selection changes weapon availability and marks core without moving the hull',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 const result=await page.evaluate(()=>{
  const e={unitId:'RGM_79',kitId:'machine_gun'};
  game=Rules.create(false,1,[[e],[e]]);game.fogMode='disabled';game.tiles.forEach(r=>r.fill('plain'));
  const [a,b]=game.units;Object.assign(a,{x:3,y:4,en:99999});Object.assign(b,{model:'SalamisClass__standard',x:4,y:4,angle:0,hp:999999});
  phase='idle';mode='select';selected=a.id;session++;AttackControls.reset();
  for(const w of Rules.models[a.model].weapons){w.min=2;w.max=3;}
  const near=AttackControls.canTarget(a,{...b,aimCell:{x:4,y:4}});
  AttackControls.choose(a,{...b,aimCell:{x:4,y:5}});
  const panel=document.createElement('div');panel.id='testAttackCells';document.body.append(panel);
  AttackControls.render(panel,a,true);
  return {near,draft:AttackControls.draft(a).aimCell,core:Rules.weakPoint(b,AttackControls.draft(a).aimCell)};
 });
 expect(result).toEqual({near:false,draft:{x:4,y:5},core:true});
 const select=page.locator('#testAttackCells .attack-cell-select');
 await expect(select).toHaveValue('4,5');await expect(select.locator('option:checked')).toContainText('弱点 ×1.5');
 await select.selectOption('4,6');
 expect(await page.evaluate(()=>AttackControls.draft(game.units[0]).aimCell)).toEqual({x:4,y:6});
});
test('production developed ordering groups unlocked units then ascending COST',async({page})=>{
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>I18n.setLanguage('zh'));await page.locator('#openProduction').click();
 await expect(page.locator('#productionSort')).toHaveCount(0);
 const rows=await page.locator('#productionList .production-unit').evaluateAll(nodes=>nodes.map(n=>{
 const p=Rules.catalog.prefabs.find(p=>p.id===n.dataset.unitId);
 return {developed:Development.allows(PlayerProfile.faction(),p.id),cost:Math.min(...p.weaponKits.map(k=>p.stats.cost+k.cost))};
 }));
 expect(rows.length).toBeGreaterThan(1);expect(rows).toEqual([...rows].sort((a,b)=>Number(b.developed)-Number(a.developed)||a.cost-b.cost));
});
