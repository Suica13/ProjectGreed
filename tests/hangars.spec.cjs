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
for (const width of [1440, 390])
test(`hangar AI entry switch defaults on and toggles without blocking manual boarding at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await fixture(page);
  await page.evaluate(() => HangarUI.open(getUnit("0-0")));
  const toggle = page.locator('#hangarDialog [data-hangar-ai-access="0-0"]');
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.equal(await page.evaluate(() => getUnit("0-0").allowAIBoarding), true);
  await toggle.click();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert(await page.evaluate(() => {
    const carrier = getUnit("0-0"), passenger = getUnit("0-1");
    return Rules.hangars.canEmbark(game, passenger, carrier, Rules.hangars.of(carrier)[0].id);
  }));
});

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
  await page.screenshot({ path: "tmp/verification/screenshots/hangar-preview.png" });
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
    MapCamera.focus(p.x, p.y, { preserveZoom: true });
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
  await page.evaluate(() => {
    const carrier = getUnit("0-0");
    Rules.hangars.embark(game, getUnit("0-1"), carrier, Rules.hangars.of(carrier)[0].id);
    update();
  });
  await page.locator('#deploymentRoster [data-unit-id="0-0"]').click();
  await page.locator('#hudDeploymentHangar').click();
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

test("deployment passenger selection can return to the carrier without launching",async({page})=>{
 await fixture(page,true);
 await page.evaluate(()=>{
  const c=getUnit("0-0"),u=getUnit("0-1");
  Rules.hangars.embark(game,u,c,Rules.hangars.of(c)[0].id);
  select(c.id);HangarUI.open(c);
 });
 await page.locator('[data-cargo-id="0-1"] button:not([data-inspect-cargo])').click();
 assert.equal(await page.evaluate(()=>selected),"0-1");
 assert.equal(await page.evaluate(()=>Rules.onMap(getUnit("0-1"))),false);
 assert.equal(await page.evaluate(()=>!!getUnit("0-1").pendingMove),false);
 await page.locator('#deploymentRoster [data-unit-id="0-0"]').click();
 await page.locator('#hudDeploymentHangar').click();
 assert.equal(await page.evaluate(()=>selected),"0-0");
 assert(await page.locator('#hangarDialog').isVisible());
 assert.equal(await page.evaluate(()=>!!getUnit("0-1").embarked),true);
});

for (const width of [390,1280]) test(`loaded APC boards through its own hangar and shows internal capacity after EN (${width}px)`,async({page})=>{
  await page.setViewportSize({width,height:900});
  await fixture(page);
  await page.evaluate(()=>{
    const u=game.units[1], p=game.units[2];
    u.model=Object.keys(UnitModels).find(id=>id.startsWith("Type74__"));
    p.model=Object.keys(UnitModels).find(id=>id.startsWith("Army_Squad_EFSF_0079_N_G_A__"));
    Object.assign(u,{hp:Rules.modelOf(u).hp,en:Rules.modelOf(u).en});
    Object.assign(p,{x:u.x-1,y:u.y,hp:Rules.modelOf(p).hp});
    Rules.hangars.embark(game,p,u,Rules.hangars.of(u)[0].id);
    HangarUI.open(u);
  });
  await page.locator('[data-board-carrier="0-1"]').click();
  assert.equal(await page.evaluate(()=>mode),"hangar-board");
  await page.evaluate(()=>{const c=game.units[0];HangarUI.click(Rules.cells(c)[0]);});
  await page.locator('[data-board-id="0-1"]').first().click();
  await page.evaluate(()=>{selected="0-0";HangarUI.open(game.units[0]);});
  const text=await page.locator('[data-cargo-id="0-1"] .hangar-unit-info small').textContent();
  assert.match(text,/EN.*格纳库 1 \/ 1 容量点/);
  assert.equal(await page.evaluate(()=>game.units[2].embarked.carrierId),"0-1");
});

for (const width of [1440, 390]) test(`cargo transfer to nested SFS and back at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  await fixture(page);
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.evaluate(()=>{
    const [ship,ms,sfs]=game.units;
    sfs.model=Object.keys(UnitModels).find(id=>id.startsWith("DodaiYS__"));
    Object.assign(sfs,{hp:Rules.modelOf(sfs).hp,en:Rules.modelOf(sfs).en});
    const h=Rules.hangars.of(ship)[0];
    for (const u of [ms,sfs]) u.embarked={carrierId:ship.id,hangarId:h.id,boardRound:0};
    Rules.hangars.sync(game);HangarUI.open(ship);
  });
  const destination=page.locator('[data-transfer-cargo="0-1"]');
  const sfsOption=await destination.locator('option').filter({hasText:"SFS"}).getAttribute("value");
  await destination.selectOption(sfsOption);
  assert.equal(await page.evaluate(()=>getUnit("0-1").embarked.carrierId),"0-2");
  await page.locator('[data-open-cargo-hangar="0-2"]').click();
  assert(await page.locator('[data-cargo-id="0-1"]').isVisible());
  const transfer=page.locator('[data-transfer-cargo="0-1"]');
  const rect=await transfer.boundingBox();assert(rect.x>=0&&rect.x+rect.width<=width);
  await page.screenshot({path:`tmp/verification/screenshots/hangar-transfer-${width}.png`});
  await transfer.selectOption("0");
  assert.equal(await page.evaluate(()=>getUnit("0-1").embarked.carrierId),"0-0");
  await page.getByRole("button",{name:"返回上层格纳库",exact:true}).click();
  assert(await page.locator('[data-cargo-id="0-1"]').isVisible());
  assert.deepEqual(errors,[]);
});

for (const width of [1440, 390])
test(`cargo multiselection preserves scroll and playback follows log filter at ${width}px`, async ({page}) => {
  await page.setViewportSize({width,height:700});
  await fixture(page);
  await page.evaluate(() => {
    const ship = getUnit("0-0"), prototype = getUnit("0-1");
    game.units = [ship, ...Array.from({length:6}, (_,i) => ({
      ...structuredClone(prototype), id:"cargo-scroll-"+i,
      embarked:{carrierId:ship.id,hangarId:Rules.hangars.of(ship)[Math.floor(i/3)].id,boardRound:0},
      acted:false,
    }))];
    Rules.hangars.sync(game); HangarUI.open(ship);
    byId("mapCombatControls").hidden = false;
  });
  const content=page.locator("#hangarDialog .hangar-content");
  const icon=page.locator('[data-cargo-id="cargo-scroll-5"] img');
  await icon.scrollIntoViewIfNeeded();
  const before=await content.evaluate(el=>el.scrollTop);
  assert(before>0); await icon.click();
  assert.equal(await page.locator('[data-cargo-id="cargo-scroll-5"] img').getAttribute("aria-pressed"),"true");
  assert(Math.abs((await content.evaluate(el=>el.scrollTop))-before)<2);
  await page.locator('[data-cargo-id="cargo-scroll-4"] img').click();
  assert.equal(await page.locator('#hangarDialog img[aria-pressed="true"]').count(),2);
  assert((await content.evaluate(el=>el.scrollTop))>0);
  assert(await page.evaluate(()=>byId("battleLogView").nextElementSibling===byId("mapCombatControls") && !byId("mapCombatControls").closest(".map-camera-controls")));
});
