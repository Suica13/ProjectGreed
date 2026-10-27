const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("map renders stationary aircraft thrust and all stationary space units without startup flashes", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const samples = await page.evaluate(async () => {
    await SpriteRenderer.load();
    Net.leave();
    game = Rules.create(false, 1, [
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
      [{ unitId: "RGM_79", kitId: "machine_gun" }],
    ]);
    const u = game.units[0];
    game.units[1].hp = 0;
    Object.assign(u, { x: 10, y: 10, acted: true, moved: true });
    selected = null;
    phase = "idle";
    mode = "select";
    setPageView("game");
    const ctx = byId("map").getContext("2d"),
      original = ctx.drawImage,
      samples = [];
    const burst = SpriteRenderer.images[ART.effects.Boost_Start.asset];
    try {
      for (const id of ["RGM_79", "FF_X7", "Type61", "SalamisClass"]) {
        u.model = Object.keys(UnitModels).find((k) => UnitModels[k].prefabId === id);
        const layer = SpriteRenderer.models[u.model].decals.find((l) =>
            UnitModels[u.model].ship ? l.visibleWhen?.thrustActive : l.visibleWhen?.sustainedThrust,
          ),
          image = SpriteRenderer.images[layer.asset];
        for (const environment of ["ground", "space"]) {
          game.environment = u.environment = environment;
          let loops = 0,
            starts = 0;
          ctx.drawImage = function (img, ...args) {
            if (img === image) loops++;
            if (img === burst) starts++;
            return original.call(this, img, ...args);
          };
          drawMap(performance.now());
          samples.push({ id, environment, loops, starts });
        }
      }
    } finally {
      ctx.drawImage = original;
    }
    return samples;
  });
  for (const s of samples) {
    expect(s.starts).toBe(0);
    expect(s.loops).toBe(s.environment === "space" || s.id === "FF_X7" ? 1 : 0);
  }
  expect(errors).toEqual([]);
});

test("aircraft bob gently at rest and in motion; reverse thrust stays on except helicopters", async ({ page }) => {
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    const samples = [];
    for (const [id, flying] of [["Dopp", false], ["Medea", false], ["EF_Heli", false], ["ZN_Heli", false], ["RGM_79", true], ["Type61", false]]) {
      const model = Object.keys(UnitModels).find(key => UnitModels[key].prefabId === id);
      const offsets = Array.from({ length: 30 }, (_, i) => SpriteRenderer.flightOffset(model, i * 100, flying));
      const reverse = moving => SpriteRenderer.visibleLayers(model, null, true, moving, null, 0, false, {}, false, false, "ground", null, null, flying).some(layer => layer.visibleWhen?.sustainedThrust);
      const translations = [], context = new Proxy({}, { get: (_, key) => key === "translate" ? (x,y) => translations.push([x,y]) : () => {}, set: () => true });
      SpriteRenderer.draw(context, model, 100, 200, 2, 0, null, 0, null, true, true, false, {}, 0, false, false, "ground", null, null, flying);
      samples.push({ id, min: Math.min(...offsets), max: Math.max(...offsets), still: reverse(false), moving: reverse(true), translated: translations[0], space: SpriteRenderer.flightOffset(model, 1234, flying, "space") });
    }
    return samples;
  });
  for (const sample of result) {
    if (sample.id === "Type61") expect(sample.max - sample.min).toBe(0);
    else { expect(sample.max - sample.min).toBeGreaterThan(1); expect(sample.min).toBeGreaterThanOrEqual(-1.4); expect(sample.max).toBeLessThanOrEqual(1.4); }
    const thrust = !["EF_Heli", "ZN_Heli", "Type61"].includes(sample.id);
    expect(sample.still, sample.id).toBe(thrust); expect(sample.moving, sample.id).toBe(thrust);
    expect(sample.translated[0]).toBe(100); expect(Math.abs(sample.translated[1] - 200)).toBeLessThanOrEqual(2.8);
    expect(sample.space).toBe(0);
  }
  expect(errors).toEqual([]);
});

test("native aircraft engines stay visible and animate at rest in atmosphere, excluding helicopters", async ({page}) => {
  const errors=[]; page.on("pageerror",error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href); await page.waitForFunction(()=>assetsReady);
  const samples=await page.evaluate(()=>{
    const samples=[];
    for(const id of ["FF_4","FF_6","FF_B2","FF_S3","FF_X7","Dopp","Gattle","DodaiYS","Medea","GawClass","EF_Heli","ZN_Heli","Type61"]) {
      const model=Object.keys(UnitModels).find(key=>UnitModels[key].prefabId===id);
      const native=SpriteRenderer.models[model].decals.filter(layer=>layer.visibleWhen?.thrustActive);
      const drawAt=time=>{
        const calls=[], ctx=new Proxy({}, {get:(_,key)=>key==="drawImage" ? (image,sx,sy)=>calls.push({layer:native.find(layer=>SpriteRenderer.images[layer.asset]===image)?.name,sx,sy}) : ()=>{},set:()=>true});
        const original=performance.now; performance.now=()=>time;
        try { SpriteRenderer.draw(ctx,model,100,100,2,0,null,0,null,true,true,false,{},0,false,true,"ground"); }
        finally {performance.now=original;}
        return calls.filter(call=>call.layer);
      };
      samples.push({id,native:native.length,first:drawAt(1000),next:drawAt(1350)});
    }
    return samples;
  });
  for(const sample of samples) {
    if(["EF_Heli","ZN_Heli","Type61"].includes(sample.id)) {expect(sample.first,sample.id).toEqual([]);continue;}
    expect(sample.native,sample.id).toBeGreaterThan(0);
    expect(sample.first.length,sample.id).toBe(sample.native);
    expect(sample.next.length,sample.id).toBe(sample.native);
    expect(sample.next.some((call,i)=>call.sx!==sample.first[i].sx||call.sy!==sample.first[i].sy),sample.id).toBe(true);
  }
  expect(errors).toEqual([]);
});
