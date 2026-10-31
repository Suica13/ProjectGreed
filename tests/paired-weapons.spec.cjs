const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");

test("G3 dual bazooka keeps the surviving muzzle and hides the broken hand",async({page})=>{
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(()=>assetsReady);
  const result=await page.evaluate(async()=>{
    const [modelId,model]=Object.entries(UnitModels).find(([,m])=>m.prefabId==="RX_78_3"&&m.weapons.some(w=>w.id==="EF_HypeBazooka_Double"));
    const weapon=model.weapons.find(w=>w.id==="EF_HypeBazooka_Double");
    const rows=[];
    const unit={id:"g3",model:modelId,x:5,y:5,hp:model.hp,en:model.en,shield:model.shield.hp};
    await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({units:[unit]}));
    for(const broken of ["leftArm","rightArm"]) {
      unit.brokenParts={[broken]:true};
      const strikes=Rules.availableStrikes(unit,weapon);
      const pose=WeaponSequence.pose(weapon,strikes[0].at);
      const visible=SpriteRenderer.visibleLayers(modelId,weapon.id,true,false,pose.clip,pose.time,false,unit.brokenParts,true,false,"ground",weapon.id,pose.weaponDisplayIndex)
        .filter(layer=>/^EF_HypeBazooka_Double(?:_L)?$/.test(layer.name)).map(layer=>layer.name);
      const muzzle=SpriteRenderer.muzzle(modelId,weapon,{x:100,y:100,angle:90,scale:1},pose.clip,pose.time,strikes[0].muzzleIndex??weapon.attack.muzzleIndices[strikes[0].shotIndex]);
      rows.push({broken,usable:Rules.canUse(unit,weapon),shots:strikes.length,energy:Rules.weaponStats(weapon,unit).en,visible,muzzle});
    }
    return rows;
  });
  expect(result.map(row=>[row.usable,row.shots,row.energy])).toEqual([[true,1,45],[true,1,45]]);
  expect(result[0].visible).toEqual(["EF_HypeBazooka_Double"]);
  expect(result[1].visible).toEqual(["EF_HypeBazooka_Double_L"]);
  expect(result[0].muzzle).not.toEqual(result[1].muzzle);
  expect(errors).toEqual([]);
});
test("independent hand weapons render at their own muzzle after a position change", async ({
  page,
}, testInfo) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 650;
    document.body.append(canvas);
    Object.assign(canvas.style, { position: "fixed", inset: "0", zIndex: 99999 });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#152530";
    ctx.fillRect(0, 0, 1200, 650);
    const rows = [];
    for (const [row, id] of ["RX_78NT_1", "RX_78NT_1_FA"].entries()) {
      const [key, m] = Object.entries(UnitModels).find(
        ([key, m]) =>
          m.prefabId === id &&
          m.weapons.some((w) => w.id === (id === "RX_78XX" ? "EF_75mmMG_Double" : "Common_ArmMG")),
      );
      const w = m.weapons.find(
        (w) => w.id === (id === "RX_78XX" ? "EF_75mmMG_Double" : "Common_ArmMG"),
      );
      const hands = [w, m.weapons.find((a) => a.id === w.id + "_L")];
      const pose = WeaponSequence.pose(w, w.attack.shots[0]);
      const actor = { x: 200, y: 110 + row * 200, angle: 90, scale: 2.5 };
      const points = [0, 1].map((i) =>
        SpriteRenderer.muzzle(
          key,
          hands[i],
          actor,
          WeaponSequence.pose(hands[i], hands[i].attack.shots[0]).clip,
          WeaponSequence.pose(hands[i], hands[i].attack.shots[0]).time,
          0,
        ),
      );
      const shifted = { ...actor, x: actor.x + 17, y: actor.y - 29 };
      const translated = [0, 1].map((i) =>
        SpriteRenderer.muzzle(
          key,
          hands[i],
          shifted,
          WeaponSequence.pose(hands[i], hands[i].attack.shots[0]).clip,
          WeaponSequence.pose(hands[i], hands[i].attack.shots[0]).time,
          0,
        ),
      );
      for (const [col, broken] of [{}, { leftArm: true }, { rightArm: true }].entries())
        SpriteRenderer.draw(
          ctx,
          key,
          200 + col * 400,
          110 + row * 200,
          2.5,
          90,
          pose.clip,
          pose.time,
          w.id,
          false,
          true,
          false,
          broken,
        );
      const live = Rules.availableStrikes({ model: key, brokenParts: { leftArm: true } }, w);
      rows.push({
        id,
        points,
        sides: hands.map((hand) => hand.requiredParts),
        clips: hands.map((hand) => WeaponSequence.pose(hand, hand.attack.shots[0]).clip),
        translated,
        shots: live.length,
        ownBroken: Rules.availableStrikes({ model: key, brokenParts: { rightArm: true } }, w)
          .length,
        expected: w.shotCount,
        finite: points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y)),
      });
    }
    return rows;
  });
  for (const row of result) {
    expect(row.finite).toBe(true);
    expect(row.shots).toBe(row.expected);
    expect(row.ownBroken).toBe(0);
    expect(row.sides).toEqual([["rightArm"], ["leftArm"]]);
    expect(row.clips[0]).not.toBe(row.clips[1]);
    for (let i = 0; i < 2; i++) {
      expect(row.translated[i].x - row.points[i].x).toBeCloseTo(17);
      expect(row.translated[i].y - row.points[i].y).toBeCloseTo(-29);
    }
  }
  await page.screenshot({ path: testInfo.outputPath("independent-weapon-hands.png") });
  expect(errors).toEqual([]);
});
