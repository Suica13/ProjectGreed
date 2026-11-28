const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('node:url'),path=require('node:path');
for(const width of [1440,390])test('sniper and irradiation cards include unit and linear pilot shooting '+width,async({page})=>{
 test.setTimeout(120000);await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);await page.waitForFunction(()=>assetsReady);
 const result=await page.evaluate(()=>{
  const [id,m]=Object.entries(UnitModels).find(([,m])=>m.weapons.some(w=>w.category==='sniper'&&!w.special));
  const w=m.weapons.find(w=>w.category==='sniper'&&!w.special),unit={id:'test',model:id,hp:m.hp,en:m.en,x:5,y:5,pilot:{stats:PilotSystem.baseStats()}};
  const one=WeaponInfo.summary(w,{unit}).textContent;unit.pilot.stats.shooting=200;const card=WeaponInfo.summary(w,{unit});
  const host=document.createElement('div');host.style.cssText='position:fixed;inset:20px;z-index:999999;background:#112;color:white;overflow:auto';host.append(card);document.body.append(host);
  const [beamId,beamModel]=Object.entries(UnitModels).find(([,m])=>m.prefabId==='RX_78_4_Bst');
  const beam={...unit,model:beamId,hp:beamModel.hp,en:beamModel.en};const skill=Rules.unitSkills(beam).find(s=>s.type==='irradiation');
  const description=SkillControls.description(skill,beam);host.append(document.createTextNode(description));
  const model=Rules.modelOf(beam),expected=Rules.roundDamage(Object.values(skill.damageComponents).reduce((s,n)=>s+n,0)*(1+model.attackBonuses.shooting/100)*2);
  return {one,two:card.textContent,description,expected:expected.toLocaleString(),ratio:PilotSystem.weaponDamageModifier(Rules.modelOf(unit).pilotModifiers,w),counts:[5,6,7,8,9,10].map(n=>ContractMode.config(n).initialEnemyCount)};
 });
 expect(result.ratio).toBe(2);expect(result.two).not.toBe(result.one);expect(result.description).toContain(result.expected);expect(result.counts).toEqual([30,33,36,39,42,45]);expect(errors).toEqual([]);
 await page.screenshot({path:`tmp/verification/screenshots/shooting-balance-${width}.png`});
});
