const {test,expect}=require('@playwright/test'),{pathToFileURL}=require('url'),path=require('path');
test('built client exposes current percentage descriptions and real weapon damage',async({page})=>{
 test.setTimeout(120000);
 await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
 await page.waitForFunction(()=>assetsReady);
 const result=await page.evaluate(()=>{
  const base=Object.values(Rules.models).find(m=>!m.ship&&m.weapons.some(w=>WeaponClasses.classify(w)==='beam_rifle'));
  const source=base.weapons.find(w=>WeaponClasses.classify(w)==='beam_rifle');
  const changed=UnitPlugins.apply(base,['beam_generator']).weapons.find(w=>w.id===source.id);
  return {description:UnitPlugins.byId.get('beam_generator').description,actual:changed.damageComponents,expected:WeaponSequence.roundComponents(source.damageComponents,1.05)};
 });
 expect(result.description).toContain('+5%');expect(result.actual).toEqual(result.expected);
});
