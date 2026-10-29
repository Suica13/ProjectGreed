const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
async function fixture(page, html = "client.html", carrierId = "DodaiYS") {
  await page.goto(pathToFileURL(path.resolve("public", html)).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(async (carrierId) => {
    I18n.setLanguage("zh");
    Net.leave();
    TurnFlow.reset();
    session++;
    MapCombat.reset();
    AttackControls.reset();
    const e = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 73, [[e, e, e], [e]], false, {
      costLimit: 99999,
      unitCostLimit: 99999,
    });
    game.tiles.forEach((r) => r.fill("plain"));
    game.fogMode = "disabled";
    const [c, u, extra, enemy] = game.units;
    c.model = Object.keys(UnitModels).find((id) => id.startsWith(carrierId + "__"));
    Object.assign(c, { x: 10, y: 8, hp: Rules.modelOf(c).hp, en: Rules.modelOf(c).en });
    Object.assign(u, { x: 9, y: 8 });
    Object.assign(extra, { x: 9, y: 9 });
    Object.assign(enemy, { x: 12, y: 8 });
    await SpriteRenderer.ensureModels(game.units.map((u) => u.model));
    selected = u.id;
    weaponId = pending = battleView = moving = null;
    mode = "select";
    phase = "idle";
    byId("quick").checked = true;
    setPageView("game");
    update();
    MapCamera.focus(10, 8);
    drawMap(performance.now());
  }, carrierId);
}
async function cell(page, x, y) {
  const p = await page.evaluate(
    ({ x, y }) => {
      drawMap(performance.now());
      const r = byId("map").getBoundingClientRect();
      return {
        x: r.left + mapGeo.ox + (x + 0.5) * mapGeo.tile,
        y: r.top + mapGeo.oy + (y + 0.5) * mapGeo.tile,
      };
    },
    { x, y },
  );
  await page.mouse.click(p.x, p.y);
}
for (const html of ["client.html", "developer.html"])
  test(`${html}: boarding asks, cancels exactly, then selects and dismounts SFS passenger`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await fixture(page, html);
    await page.locator('[data-unit-command="move"]').click();
    await cell(page, 10, 8);
    await expect(page.locator("#gameDialog")).toBeVisible();
    expect(await page.evaluate(() => getUnit("0-1").x)).toBe(9);
    await page.locator("#gameDialog").getByRole("button", { name: "取消", exact: true }).click();
    expect(await page.evaluate(() => !!getUnit("0-1").pendingMove)).toBe(false);
    await page.locator('[data-unit-command="move"]').click();
    await cell(page, 10, 8);
    await expect(page.locator("#gameDialog")).toBeVisible();
    await page
      .locator("#gameDialog")
      .getByRole("button", { name: "确认搭载", exact: true })
      .click();
    expect(await page.evaluate(() => getUnit("0-1").embarked.exposed)).toBe(true);
    await page.evaluate(() => {
      Rules.end(game);
      Rules.end(game);
      select("0-0");
      update();
    });
    await expect(page.locator("#sfsPassengers")).toBeVisible();
    await page.locator('#sfsPassengers [data-unit-id="0-1"]').click();
    expect(await page.evaluate(() => selected)).toBe("0-1");
    const drawing = await page.evaluate(() => {
      const calls = [],
        draw = SpriteRenderer.draw;
      SpriteRenderer.draw = (ctx, id, x, y, ...args) => {
        calls.push({ id, x, y });
        return draw(ctx, id, x, y, ...args);
      };
      drawMap(performance.now());
      SpriteRenderer.draw = draw;
      return { calls, carrier: getUnit("0-0").model, passenger: getUnit("0-1").model };
    });
    expect(drawing.calls.findIndex((c) => c.id === drawing.carrier)).toBeLessThan(
      drawing.calls.findLastIndex((c) => c.id === drawing.passenger),
    );
    const p = await page.evaluate(() => Rules.hangars.launchCells(game, getUnit("0-1"))[0]);
    await page.locator('[data-unit-command="move"]').click();
    await cell(page, p.x, p.y);
    await expect(page.locator("#hudConfirmMove")).toBeEnabled();
    await page.locator("#hudConfirmMove").click();
    expect(await page.evaluate(() => !!getUnit("0-1").embarked)).toBe(false);
    expect(errors).toEqual([]);
  });
test("enemy SFS portrait changes the planned target to the exposed passenger", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await page.evaluate(() => {
    const c = getUnit("0-0"),
      rider = getUnit("0-2");
    c.team = rider.team = 1;
    c.ownerSeat = rider.ownerSeat = 1;
    rider.x = 10;
    rider.y = 9;
    game.team = 1;
    Rules.hangars.embark(game, rider, c, "SFS01");
    game.team = 0;
    select("0-1");
    AttackControls.start(getUnit(selected));
    update();
  });
  await cell(page, 10, 8);
  await expect(page.locator("#sfsPassengers")).toBeVisible();
  await page.locator('#sfsPassengers [data-unit-id="0-2"]').click();
  expect(await page.evaluate(() => AttackControls.draft(getUnit("0-1")).targetId)).toBe("0-2");
  expect(errors).toEqual([]);
});
test("moving onto a conventional hangar shows the same cancellable boarding dialog", async ({
  page,
}) => {
  await fixture(page, "client.html", "PegasusClass");
  await page.locator('[data-unit-command="move"]').click();
  await cell(page, 10, 8);
  await expect(page.locator("#gameDialog")).toBeVisible();
  await page.locator("#gameDialog").getByRole("button", { name: "取消", exact: true }).click();
  expect(
    await page.evaluate(() => ({ x: getUnit("0-1").x, board: !!getUnit("0-1").embarked })),
  ).toEqual({ x: 9, board: false });
});
test("SFS riders inherit altitude and idle facing but keep attack facing",async({page})=>{
 await fixture(page);
 const result=await page.evaluate(()=>{
   const [c,u]=game.units;
   const h=Rules.hangars.of(c).find(h=>h.kind==="sfs");
   u.embarked={carrierId:c.id,hangarId:h.id,exposed:true};
   u.x=c.x;u.y=c.y;c.angle=90;u.angle=180;
   game.tiles[c.y][c.x]="water";
   const pose=EnvironmentVisuals.pose(u,{x:c.x,y:c.y});
   const records=[];
   const original=SpriteRenderer.draw;
   SpriteRenderer.draw=function(ctx,id,x,y,scale,angle,...args){
     if(id===u.model) records.push({angle,alpha:ctx.globalAlpha});
     return original.call(this,ctx,id,x,y,scale,angle,...args);
   };
   drawMap(performance.now());
   SpriteRenderer.draw=original;
   const idle=records[0];
   const originalTarget=AttackControls.facingTarget;
   AttackControls.facingTarget=()=>game.units[3];
   const facing=PlanningUI.facing(u,90);
   const expected={...u};Rules.faceTarget(expected,game.units[3]);
   AttackControls.facingTarget=originalTarget;
   u.pendingMove={launch:true,x:c.x,y:c.y,angle:180};
   const dismount=EnvironmentVisuals.pose(u,{x:c.x,y:c.y});
   delete u.pendingMove;
   return {pose,idle,facing,expected:expected.angle,dismount};
 });
 expect(result.pose.alpha).toBe(1);
 expect(result.pose.environment).toBe("air");
 expect(result.idle.angle).toBe(90);
 expect(result.idle.alpha).toBe(1);
 expect(result.facing).toBe(result.expected);
 expect(result.dismount.environment).toBe("water");
});
