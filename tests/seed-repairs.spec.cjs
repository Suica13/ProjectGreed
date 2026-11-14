const {test,expect}=require('@playwright/test');
const {pathToFileURL}=require('node:url');
const path=require('node:path');

test('BaCUE and Skygrasper render only their selected native equipment; faction colors match technology',async({page})=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
  await page.waitForFunction(()=>assetsReady);
  const result=await page.evaluate(async()=>{
    const ids=['TMF_A_802__standard','TMF_A_802__missile','FX_550__main_1','FX_550__main_2','FX_550__main_3'];
    await SpriteRenderer.ensureModels(ids);
    const visible=Object.fromEntries(ids.map(id=>[id,SpriteRenderer.visibleLayers(id,null,true,false,'Common_Idle',0).map(l=>l.texture)]));
    const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=240;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#243746';ctx.fillRect(0,0,1000,240);
    ids.forEach((id,i)=>{
      SpriteRenderer.draw(ctx,id,100+i*200,120,2,0,'Common_Idle',0);
      ctx.fillStyle='white';ctx.font='12px sans-serif';ctx.fillText(id,15+i*200,225);
    });
    document.body.replaceChildren(canvas);
    const colors=Object.fromEntries(Rules.factions.map(f=>{
      const model=Rules.catalog.prefabs.find(p=>p.faction===f);
      const tags=UnitPreview.unitTags(model,{limit:8});
      return [f,{actual:tags.querySelector('[data-faction="'+f+'"]').style.color,expected:Rules.factionInfo[f].color}];
    }));
    return {visible,colors,image:canvas.toDataURL()};
  });
  expect(result.visible.TMF_A_802__standard).toContain('TMF_A_802_Railgun_1.png');
  expect(result.visible.TMF_A_802__standard).not.toContain('TMF_A_802_MS_1.png');
  expect(result.visible.TMF_A_802__standard).not.toContain('TMF_A_802_Head_2.png');
  expect(result.visible.TMF_A_802__missile).toContain('TMF_A_802_MS_1.png');
  expect(result.visible.TMF_A_802__missile).not.toContain('TMF_A_802_Railgun_1.png');
  expect(result.visible.FX_550__main_1.some(t=>t.includes('AILE'))).toBeTruthy();
  expect(result.visible.FX_550__main_1.some(t=>t.includes('Launcher')||t.includes('Sword'))).toBeFalsy();
  expect(result.visible.FX_550__main_2.some(t=>t.includes('Launcher'))).toBeTruthy();
  expect(result.visible.FX_550__main_2.some(t=>t.includes('AILE')||t.includes('Sword'))).toBeFalsy();
  expect(result.visible.FX_550__main_3.some(t=>t.includes('Sword'))).toBeTruthy();
  for(const color of Object.values(result.colors)) {
    const hex=color.expected.slice(1);
    expect(color.actual).toBe(`rgb(${parseInt(hex.slice(0,2),16)}, ${parseInt(hex.slice(2,4),16)}, ${parseInt(hex.slice(4,6),16)})`);
  }
  await page.screenshot({path:'tmp/verification/screenshots/seed-loadout-repairs.png'});
  expect(errors).toEqual([]);
});
