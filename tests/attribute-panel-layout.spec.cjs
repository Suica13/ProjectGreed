const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('attribute tabs keep equal geometry and encyclopedia actions are usable '+width,async({page})=>{
 test.setTimeout(90000);await page.setViewportSize({width,height:960});const errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 await page.evaluate(()=>{I18n.setLanguage('zh');Economy.creditActivity({id:'attribute-layout',matchId:'attribute-layout',money:0,supplies:0,inventory:{RGM_79:1}});});
 await page.locator('#shellHangar').click();await page.locator('#warehouseBays [data-slot="0"]').click();
 async function checkTabs(root,prefix){
  const block=root.locator('.unit-attribute-block'),bounds=()=>block.evaluate(node=>{const panels=[...node.querySelectorAll('.unit-attribute-page')].map(p=>p.getBoundingClientRect());return {height:node.getBoundingClientRect().height,first:panels[0].height,second:panels[1].height,overflow:node.scrollWidth>node.clientWidth+1};});
  const before=await bounds();expect(before.first).toBeGreaterThan(200);expect(Math.abs(before.first-before.second)).toBeLessThan(1);expect(before.overflow).toBe(false);
  const primary=root.locator('#'+prefix+'PrimaryAttributes'),secondary=root.locator('#'+prefix+'SecondaryAttributes');
  await expect(primary).toContainText('伤害加成');await expect(primary).toContainText('防护与结构');
  await expect(primary).not.toContainText('适应性');await expect(secondary).toContainText('适应性');
  for(const label of ['生产周期','移动方式']){await expect(primary).toContainText(label);await expect(secondary).not.toContainText(label);}
  const placement=await primary.evaluate(node=>{const groups=[...node.children].map(n=>n.getBoundingClientRect());return {right:groups[3].x>groups[2].x,sameRow:Math.abs(groups[3].y-groups[2].y)<1};});expect(placement).toEqual({right:true,sameRow:true});
  await block.getByRole('button',{name:'次要属性',exact:true}).click();
  await expect(primary).toBeHidden();await expect(secondary).toBeVisible();await expect(secondary).not.toContainText('防护与结构');
  const after=await bounds();expect(after.height).toBe(before.height);expect(after.first).toBe(after.second);
  await block.getByRole('button',{name:'技能列表',exact:true}).click();await expect(root.locator('#'+prefix+'SkillList')).toBeVisible();await expect(root.locator('#'+prefix+'SkillList')).toContainText('技能与机制');expect((await bounds()).height).toBe(before.height);
  await page.screenshot({path:`tmp/verification/screenshots/attributes-${prefix}-${width}.png`});await block.getByRole('button',{name:'主要属性',exact:true}).click();
 }
 await checkTabs(page.locator('#warehouseDialog'),'warehouse');await page.locator('#warehouseOpenCatalog').click();await checkTabs(page.locator('#formationUnitDetail'),'formation');
 await page.locator('#closeFormationDetail').click();await page.locator('#warehouseClose').click();await page.locator('#shellEncyclopedia').click();
 const card=page.locator('#encyclopediaList .encyclopedia-unit[data-unit-id="RGM_79"]');await card.scrollIntoViewIfNeeded();
 const layout=await card.evaluate(node=>{const c=node.getBoundingClientRect(),icon=node.querySelector('.encyclopedia-unit-identity').getBoundingClientRect(),button=node.querySelector('.encyclopedia-unit-actions button').getBoundingClientRect(),status=node.querySelector('.encyclopedia-unit-status').getBoundingClientRect();return {center:Math.abs(icon.y+icon.height/2-c.y-c.height/2),iconX:icon.x,buttonX:button.x,height:button.height,width:button.width,above:status.bottom<=button.y,overflow:node.scrollWidth>node.clientWidth+1};});
 expect(layout.center).toBeLessThan(2);expect(layout.iconX).toBeLessThan(layout.buttonX);expect(layout.height).toBeGreaterThanOrEqual(44);expect(layout.width).toBeGreaterThanOrEqual(70);expect(layout.above).toBe(true);expect(layout.overflow).toBe(false);
 await page.screenshot({path:`tmp/verification/screenshots/encyclopedia-actions-${width}.png`});await card.getByRole('button',{name:'详细',exact:true}).click();await expect(page.locator('#formationUnitDetail')).toBeVisible();
 await page.evaluate(()=>Formation.previewUnit('RX_78_2'));await page.locator('#formationUnitDetail').getByRole('button',{name:'技能列表',exact:true}).click();
  await expect(page.locator('#formationSkillList')).toBeVisible();await expect(page.locator('#formationDetailMechanics')).toContainText('学习型电脑');await expect(page.locator('#formationDetailMechanics')).toContainText('驾驶员经验获取');
 await page.locator('#formationSkillList').scrollIntoViewIfNeeded();
 const skillBounds=await page.locator('#formationSkillList').evaluate(node=>({height:node.clientHeight,overflow:node.scrollWidth>node.clientWidth+1}));expect(skillBounds.height).toBeGreaterThan(200);expect(skillBounds.overflow).toBe(false);
 await page.screenshot({path:`tmp/verification/screenshots/unit-skills-${width}.png`});expect(errors).toEqual([]);
});
