const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
test("Salamis can join a formation, deploy as a six-cell hull, rotate and display all module HP", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openFormation").click();
  await page.locator('[data-unit-id="SalamisClass"]').click();
  await page.locator("#addFormationUnit").click();
  await page
    .locator(".formation-row")
    .last()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await expect(page.locator("#formationDetailStats")).toContainText("战舰占地 2×3");
  await expect(page.locator("#formationDetailStats")).toContainText("炮塔模块 16");
  await page.locator("#closeFormationDetail").click();
  await page.locator("#saveFormation").click();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomMapSelect").selectOption("asteroid_crossing_1v1");
  await page.locator("#roomUnitCostLimit").fill("2000");
  await waitForRoomSettings(page);
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  const placement = await page.evaluate(() => {
    const u = game.units.find((u) => Rules.modelOf(u).ship);
    selected = u.id;
    const c = Rules.deploymentCells(game, 0).find(
      (c) =>
        Rules.fits(game, u, c.x, c.y, u.angle, false, 0) &&
        Rules.canRotate({ ...game, deployment: null }, { ...u, ...c }, 1),
    );
    if (!c) throw Error("no rotating deployment anchor");
    Net.request("deploy", { unitId: u.id, x: c.x, y: c.y });
    update();
    return { ...c, id: u.id };
  });
  await expect
    .poll(() => page.evaluate((id) => game.units.find((u) => u.id === id).x, placement.id))
    .toBe(placement.x);
  await page.evaluate((id) => {
    selected = id;
    update();
    const u = getUnit(id);
    MapCamera.setZoom(3);
    const c = Rules.center(u);
    MapCamera.focus(c.x, c.y, { preserveZoom: true });
  }, placement.id);
  await page.locator(".ship-modules summary").click();
  await expect(page.locator("[data-module]")).toHaveCount(16);
  await expect(page.locator('[data-ship-turn="1"]')).toBeEnabled();
  await expect(page.locator("#unitPartStatus")).toContainText("战舰占地 3×2");
  expect(
    await page.evaluate((id) => {
      const u = getUnit(id);
      return Rules.cells(u).every((c) => Rules.at(game, c.x, c.y)?.id === id);
    }, placement.id),
  ).toBe(true);
  await page.screenshot({ path: ".openai/salamis-deployment.png" });
  await page.locator("#confirmDeployment").click();
  await expect(page.locator("#deploymentPanel")).toBeHidden();
  await page.evaluate((id) => {
    selected = id;
    update();
  }, placement.id);
  await expect(page.locator('[data-ship-turn="-1"]')).toBeEnabled();
  await page.locator('[data-ship-turn="-1"]').click();
  await expect(page.locator("#unitPartStatus")).toContainText("战舰占地 2×3");
  await expect(page.locator('[data-ship-turn="1"]')).toBeDisabled();
  await expect(page.locator("#unitPanel .actions")).toContainText("撤回移动");
  await page.locator("#unitPanel .actions button", { hasText: "撤回移动" }).click();
  await expect(page.locator("#unitPartStatus")).toContainText("战舰占地 3×2");
  expect(errors).toEqual([]);
});

test("Salamis map volley uses independent turret muzzles and keeps the hull on its six cells", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    Net.leave();
    MapCombat.reset();
    game = Rules.create(
      false,
      4,
      [
        [{ unitId: "SalamisClass", kitId: "standard" }],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
        null,
        null,
      ],
      false,
      { mapId: "orbital_debris_2v2", unitCostLimit: 2000 },
    );
    game.tiles.forEach((row) => row.fill("plain"));
    const [a, b] = game.units;
    Object.assign(a, { x: 10, y: 8, angle: 0, shield: 0, dodgeSlot: 1 });
    Object.assign(b, { x: 14, y: 7, hp: 100000, shield: 0 });
    const actors = structuredClone([a, b]),
      weapon = Rules.modelOf(a).weapons[0],
      beforeCells = JSON.stringify(Rules.cells(a));
    const events = Rules.fight(game, a, b, weapon, "defend");
    const record = {
      id: "ship-volley",
      a: a.id,
      b: b.id,
      actors,
      events,
      before: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
    };
    setPageView("game");
    selected = a.id;
    phase = "battle";
    update();
    MapCombat.seed([record]);
    battleView = {
      ...record,
      index: 0,
      start: performance.now(),
      displayHp: { ...record.before },
      completed: false,
    };
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const f = MapCombat.frame;
    f.time = f.plan.shots[0].at + 0.04;
    MapCombat.suspend(battleView);
    MapCamera.setZoom(3);
    MapCamera.focus(11, 7, { preserveZoom: true });
    let flashes = 0;
    const draw = SpriteEffects.draw;
    SpriteEffects.draw = function (...args) {
      const value = draw(...args);
      if (f.weapon.muzzleEffects.includes(args[1]) && value) flashes++;
      return value;
    };
    drawMap(performance.now());
    SpriteEffects.draw = draw;
    return {
      angle: a.angle,
      cellsUnchanged: JSON.stringify(Rules.cells(a)) === beforeCells,
      flashes,
      shots: f.plan.shots.length,
      total: weapon.shotCount,
      origins: new Set(f.plan.shots.map((s) => `${s.origin.x},${s.origin.y}`)).size,
    };
  });
  expect(result.angle).toBe(0);
  expect(result.cellsUnchanged).toBe(true);
  expect(result.flashes).toBe(result.shots);
  expect(result.shots).toBeGreaterThan(0);
  expect(result.shots).toBeLessThan(result.total);
  expect(result.origins).toBe(result.shots);
  await page.screenshot({ path: ".openai/salamis-volley.png" });
  expect(errors).toEqual([]);
});
