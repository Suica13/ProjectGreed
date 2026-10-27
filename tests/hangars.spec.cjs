const { test } = require("@playwright/test"),
  assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function fixture(page, deployment = false) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async (deployment) => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    Net.leave();
    TurnFlow.reset();
    session++;
    MapCombat.reset();
    AttackControls.reset();
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry, entry, entry], [entry]], false, {
      costLimit: 99999,
      unitCostLimit: 99999,
    });
    game.tiles.forEach((r) => r.fill("plain"));
    const c = game.units[0];
    c.model = Object.keys(UnitModels).find((id) => id.startsWith("PegasusClass__"));
    Object.assign(c, { x: 8, y: 8, hp: Rules.modelOf(c).hp, en: Rules.modelOf(c).en });
    game.units.slice(1).forEach((u, i) => Object.assign(u, { x: 7, y: 8 + i * 2 }));
    if (deployment) {
      game.deployment = [false, false];
      const p = Rules.deploymentCells(game, 0, c).find(
        (p) => p.x > 0 && Rules.fits(game, c, p.x, p.y, c.angle, false, 0),
      );
      Object.assign(c, p);
    }
    const hull = Rules.cells(c);
    game.units
      .filter((u) => u.team === 0 && u !== c)
      .forEach((u, i) => Object.assign(u, { x: hull[0].x - 1, y: hull[0].y + i }));
    selected = "0-1";
    weaponId = pending = battleView = moving = null;
    mode = "select";
    phase = deployment ? "deployment" : "idle";
    setPageView("game");
    update();
    MapCamera.focus(Rules.center(c).x, Rules.center(c).y);
    drawMap(performance.now());
  }, deployment);
}
test("hangar preview boards and launches existing units through visible controls", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page);
  await page.locator('[data-unit-command="hangar"]').click();
  const dialog = page.locator("#hangarDialog");
  assert(!(await dialog.isVisible()));
  assert.equal(await page.evaluate(() => mode), "hangar-board");
  assert.equal(await page.locator("#hudCancelAction").textContent(), "取消搭载");
  await clickCarrier(page);
  assert(await dialog.isVisible());
  assert.equal(await dialog.locator(".hangar-unit[data-board-id]").count(), 0);
  assert.equal(await dialog.locator("button[data-board-id]").count(), 2);
  await dialog.locator('[data-board-id="0-1"]').first().click();
  const boarded = await page.evaluate(() => ({
    embarked: getUnit("0-1").embarked,
    count: MapCombat.units().length,
    acted: getUnit("0-1").acted,
    originalCount: game.units.length,
  }));
  assert(boarded.embarked);
  assert(boarded.acted);
  assert.equal(boarded.count, boarded.originalCount - 1);
  await page.evaluate(() => {
    select("0-0");
    HangarUI.open(getUnit("0-0"));
  });
  assert.equal(await dialog.locator("[data-board-id]").count(), 0);
  await page.screenshot({ path: ".openai/hangar-preview.png" });
  assert(await dialog.locator('[data-cargo-id="0-1"] button:not([data-inspect-cargo])').isDisabled());
  await page.evaluate(() => {
    Rules.end(game);
    Rules.end(game);
    update();
  });
  await dialog.locator('[data-cargo-id="0-1"] button:not([data-inspect-cargo])').click();
  assert(!(await dialog.isVisible()));
  assert(await page.locator("#hudCancelAction").isVisible());
  assert.equal(await page.locator("#hudCancelAction").textContent(), "取消出击");
  const point = await page.evaluate(() => {
    const p = Rules.hangars.launchCells(game, getUnit("0-1")).find((p) => p.distance > 1);
    drawMap(performance.now());
    const r = byId("map").getBoundingClientRect();
    return {
      x: r.left + mapGeo.ox + (p.x + 0.5) * mapGeo.tile,
      y: r.top + mapGeo.oy + (p.y + 0.5) * mapGeo.tile,
    };
  });
  await page.evaluate(() => {
    const original = PlanningUI.move;
    PlanningUI.move = (event) => {
      window.launchMotionEvent = event;
      original(event);
    };
  });
  await page.mouse.click(point.x, point.y);
  const animation = await page.evaluate(() => {
    const u = getUnit("0-1"),
      event = window.launchMotionEvent;
    return {
      from: event.from,
      center: Rules.center(getUnit("0-0")),
      end: event.path.at(-1),
      destination: { x: u.pendingMove.x, y: u.pendingMove.y },
      moving: !!PlanningUI.motion(u, performance.now()),
    };
  });
  assert.deepEqual(animation.from, animation.center);
  assert.deepEqual(animation.end, animation.destination);
  assert(animation.moving);
  assert.equal(await page.evaluate(() => !!getUnit("0-1").embarked), true);
  assert.equal(await page.evaluate(() => selected), "0-1");
  await page.locator("#hudConfirmMove").click();
  assert.equal(await page.evaluate(() => !!getUnit("0-1").embarked), false);
  assert.equal(await page.evaluate(() => getUnit("0-1").moved), true);
  assert.equal(await page.evaluate(() => selected), "0-0");
  assert.deepEqual(errors, []);
});
test("deployment exposes hangar command and preloading keeps deployment confirmation valid", async ({
  page,
}) => {
  await fixture(page, true);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.locator('[data-unit-command="hangar"]').click();
  await clickCarrier(page);
  await page.locator('#hangarDialog [data-board-id="0-1"]').first().click();
  assert(!(await page.locator("#hangarDialog").isVisible()));
  await page.evaluate(() => {
    select("0-0");
    HangarUI.open(getUnit("0-0"));
  });
  assert(await page.locator('#hangarDialog [data-cargo-id="0-1"]').isVisible());
  await page.locator("#hangarDialog").getByRole("button", { name: "关闭", exact: true }).click();
  const result = await page.evaluate(() => {
    Rules.hangars.embark(
      game,
      getUnit("0-2"),
      getUnit("0-0"),
      Rules.hangars.of(getUnit("0-0"))[0].id,
    );
    Rules.confirmDeployment(game, 0);
    return game.deployment[0];
  });
  assert(result);
  assert.deepEqual(errors, []);
});

async function clickCarrier(page) {
  const point = await page.evaluate(() => {
    drawMap(performance.now());
    const c = Rules.center(getUnit("0-0")),
      r = byId("map").getBoundingClientRect();
    return {
      x: r.left + mapGeo.ox + (c.x + 0.5) * mapGeo.tile,
      y: r.top + mapGeo.oy + (c.y + 0.5) * mapGeo.tile,
    };
  });
  await page.mouse.click(point.x, point.y);
}


test("hangar shows resource maxima and opens live cargo status with bottom instructions",async({page})=>{
 await fixture(page);
 const expected=await page.evaluate(()=>{
  const c=getUnit("0-0"),u=getUnit("0-1"),m=Rules.modelOf(u);
  u.embarked={carrierId:c.id,hangarId:Rules.hangars.of(c)[0].id};
  u.hp=1234;u.en=12;u.brokenParts={rightArm:true};
  HangarUI.open(c);
  return {hp:formatNumber(m.hp),en:formatNumber(m.en)};
 });
 const row=page.locator('[data-cargo-id="0-1"]');
 assert((await row.textContent()).includes('HP 1,234 / '+expected.hp));
 assert((await row.textContent()).includes('EN 12 / '+expected.en));
 await page.locator('[data-inspect-cargo="0-1"]').click();
 const panel=page.locator('#hangarCargoStatus');
 assert(await panel.isVisible());
 assert((await panel.textContent()).includes('右臂'));
 await page.evaluate(()=>{getUnit("0-1").hp=2345;update();});
 assert((await panel.textContent()).includes('2,345'));
 assert.equal(await page.locator('#hangarDialog > .helper:not(.hangar-help)').count(),0);
 assert.equal(await page.locator('#hangarDialog > :last-child').getAttribute('class'),'hangar-help helper');
 await page.locator('#hangarStatusBack').click();
 assert(await page.locator('[data-cargo-id="0-1"]').isVisible());
});

test("cancel launch restores carrier focus and reopens remaining cargo",async({page})=>{
 await fixture(page,true);
 await page.evaluate(()=>{
  const c=getUnit("0-0"),u=getUnit("0-1");
  Rules.hangars.embark(game,u,c,Rules.hangars.of(c)[0].id);
  select(c.id);HangarUI.open(c);
 });
 await page.locator('[data-cargo-id="0-1"] button:not([data-inspect-cargo])').click();
 await page.evaluate(()=>{const p=Rules.hangars.launchCells(game,getUnit("0-1"))[0];HangarUI.click(p);});
 assert.equal(await page.evaluate(()=>selected),"0-1");
 assert.equal(await page.evaluate(()=>Rules.onMap(getUnit("0-1"))),false);
 assert(await page.locator('#hudConfirmMove').isVisible());
 const enabled=await page.locator('#hudUnitCommands button:enabled').count();
 assert.equal(enabled,0);
 await page.locator('#hudCancelAction').click();
 assert.equal(await page.evaluate(()=>selected),"0-0");
 assert(await page.locator('#hangarDialog').isVisible());
 assert.equal(await page.evaluate(()=>!!getUnit("0-1").embarked),true);
});
