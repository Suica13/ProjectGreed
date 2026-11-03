const {test,expect}=require("@playwright/test");
const {pathToFileURL}=require("node:url"),path=require("node:path");
test("rendered left wrist bursts stay on the left through their final bullet",async({page})=>{
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result=await page.evaluate(async()=>{
    const rows=[];
    for(const prefab of ["RX_78NT_1","RX_78NT_1_FA","MS_14JG","AMX_101"]) {
      const model=Object.keys(Rules.models).find(id=>Rules.models[id].prefabId===prefab);
      await SpriteRenderer.ensureModels([model]);
      const w=Rules.models[model].weapons.find(w=>w.requiredParts.includes("leftArm")&&/ArmMG/.test(w.id));
      const unit={id:"left-test",model,hp:Rules.models[model].hp,en:1000,brokenParts:{rightArm:true}};
      const source={unit,x:100,y:100,angle:90,scale:1};
      for(let index=0;index<w.attack.shots.length;index++) {
        const event={weapon:w.id,shotIndices:[index]},slice=Rules.eventWeapon(unit,event),time=slice.attack.shots[0];
        const frame=WeaponEffects.firingPose(slice,source,event,time),pose=SpriteRenderer.pose(model,frame.clip,frame.time);
        const muzzle=SpriteRenderer.muzzle(model,slice,{...source,...frame},frame.clip,frame.time,0);
        rows.push({prefab,index,body:pose.Body.dir,left:pose.LeftArm.dir,finite:Number.isFinite(muzzle.x)&&Number.isFinite(muzzle.y)});
      }
    }
    return rows;
  });
  expect(result.length).toBeGreaterThanOrEqual(36);
  for(const row of result){expect(row.body).toBe(30);expect(row.left).toBe(0);expect(row.finite).toBe(true);}
});
