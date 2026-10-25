const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const start = async (page) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
};
test("EXAM button immediately switches to native form and returns after three own turns", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const base = await page.evaluate(() => {
    Net.leave();
    const p = ART.prefabs.find((p) => p.id === "RX_79_BD_1");
    game = Rules.create(
      false,
      1,
      [[{ unitId: p.id, kitId: p.weaponKits[0].id }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { costLimit: 5000, unitCostLimit: 2000 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    const u = game.units[0];
    Object.assign(u, { x: 17, y: 8, customName: "测试[A01]" });
    selected = u.id;
    phase = "idle";
    setPageView("game");
    update();
    MapCamera.setZoom(3);
    MapCamera.focus(17, 8, { preserveZoom: true });
    return u.model;
  });
  await page.locator('[data-unit-skill="EXAM"]').click();
  await expect(page.locator("#unitPanel")).toContainText("EXAM强化中");
  expect(await page.evaluate(() => game.units[0].en)).toBe(562.5);
  expect(await page.evaluate(() => game.units[0].model)).not.toBe(base);
  await page.screenshot({ path: ".openai/exam-native-form.png" });
  await page.evaluate(() => {
    for (let i = 0; i < 5; i++) Rules.end(game);
    update();
  });
  expect(await page.evaluate(() => game.units[0].model)).toBe(base);
  expect(await page.evaluate(() => game.units[0].en)).toBe(450);
  await expect(page.locator("#unitPanel")).not.toContainText("EXAM强化中");
  expect(errors).toEqual([]);
});
test("ship movement clicks use the hull centre even when destination overlaps its own footprint", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const click = await page.evaluate(() => {
    Net.leave();
    game = Rules.create(
      false,
      1,
      [
        [{ unitId: "SalamisClass", kitId: "standard" }],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ],
      false,
      { mapId: "asteroid_crossing_1v1", unitCostLimit: 2000 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    const u = game.units[0];
    Object.assign(u, { x: 12, y: 10, angle: 90 });
    Object.assign(game.units[1], { x: 25, y: 10 });
    selected = u.id;
    phase = "idle";
    mode = "move";
    setPageView("game");
    update();
    MapCamera.setZoom(3);
    MapCamera.focus(14, 10.5, { preserveZoom: true });
    drawMap(performance.now());
    const p = mapPosition(14, 10.5),
      r = byId("map").getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y };
  });
  await page.mouse.click(click.x, click.y);
  await expect
    .poll(() => page.evaluate(() => Rules.center(game.units[0])))
    .toEqual({ x: 14, y: 10.5 });
  expect(await page.evaluate(() => game.units[0].x)).toBe(13);
  await page.screenshot({ path: ".openai/ship-centre-movement.png" });
  expect(errors).toEqual([]);
});
