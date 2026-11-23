const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
test('standalone browser loads shared talents and displays stable roster and command descriptions',async({page})=>{
  test.setTimeout(90000);
  const errors=[]; page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  const result=await page.evaluate(()=>{
    I18n.setLanguage('zh');
    const p=PilotSystem.createCustom('custom-browser-talents','天赋测试',PilotSystem.catalog.portraits[0].id);
    const old=PilotSystem.custom({...p,level:0,reincarnations:2,talents:undefined,talentSlotsUnlocked:undefined});
    const summary=SkillControls.pilotSummary(old);
    const entry={unitId:'RGM_79',kitId:'machine_gun'};
    const g=Rules.create(false,123,[[entry],[entry]]);
    const unit=g.units[0];unit.pilot={...p,stats:{...p.stats,leadership:101}};
    const aceSource=PilotSystem.catalog.aces.find(source=>source.price),ace=PilotSystem.createAce(aceSource.id);
    return {count:PilotSystem.talents.catalog.length,fresh:p.talents.length,ids:old.talents,
      commander: PilotSystem.generalPMC('pmc-general-browser',true).stats.leadership,
      aceLeadership:ace.stats.leadership,aceExpected:Math.round(Math.round(aceSource.baseStats.leadership)*1.25),
      aceReload:PilotSystem.custom(JSON.parse(JSON.stringify(ace))).stats.leadership,
      reread:PilotSystem.custom(JSON.parse(JSON.stringify(old))).talents,
      badges:summary.querySelectorAll('[data-pilot-talent]').length,
      command:SkillControls.commandAbilities(Rules.modelOf(unit),unit)};
  });
  expect(result.count).toBe(45);expect(result.fresh).toBe(0);expect(result.badges).toBe(3);
  expect(result.reread).toEqual(result.ids);
  expect(result.command[0].description).toContain('指挥高于100');
  expect(result.commander).toBeGreaterThanOrEqual(115);expect(result.commander).toBeLessThanOrEqual(135);
  expect(result.aceLeadership).toBe(result.aceExpected);expect(result.aceReload).toBe(result.aceLeadership);
  expect(errors).toEqual([]);
});
