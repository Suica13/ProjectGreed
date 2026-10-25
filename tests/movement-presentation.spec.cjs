const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");
test("native hover and red system sheets load, render and advance frames", async ({ page }) => {
  const errors=[];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result=await page.evaluate(async () => {
    await SpriteRenderer.load();
    const model=Object.keys(ART.models).find(k => k.startsWith("MS_09__"));
    const canvas=document.createElement("canvas"), ctx=canvas.getContext("2d");
    const calls=[], original=ctx.drawImage.bind(ctx);
    ctx.drawImage=(...args)=>{calls.push(args);original(...args)};
    const draw=(moving,onLand,time)=>{
      calls.length=0;
      SpriteRenderer.draw(ctx,model,100,100,1,90,null,time,null,true,true,moving,{},90,null,onLand);
      const hover=SpriteRenderer.models[model].decals.find(l=>l.name==="Hover");
      return calls.filter(c=>c[0]===SpriteRenderer.images[hover.asset]).map(c=>c[1]);
    };
    const stationary=draw(false,true,0), a=draw(true,true,0), b=draw(true,true,.15), space=draw(true,false,.15);
    const red=ART.units.filter(u=>u.id.includes("_EXAM__") || u.id.includes("_HADES__"));
    return {stationary,a,b,space,redLoaded:red.every(u=>u.decals.filter(l=>l.name.startsWith("System_Red_")).length===2 && u.decals.filter(l=>l.name.startsWith("System_Red_")).every(l=>SpriteRenderer.images[l.asset]?.complete))};
  });
  expect(result.stationary).toEqual([]);
  expect(result.space).toEqual([]);
  expect(result.a).toHaveLength(1);
  expect(result.b[0]).toBeGreaterThan(result.a[0]);
  expect(result.redLoaded).toBe(true);
  expect(errors).toEqual([]);
});
