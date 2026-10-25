const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("native lock stays white through the charge and turns red only for a valid next-turn shot", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    Net.leave();
    game = Rules.create(
      false,
      1,
      [
        [
          {
            unitId: "RGM_79_G_SP",
            kitId: Object.values(UnitModels).find((m) => m.prefabId === "RGM_79_G_SP").kitId,
          },
        ],
        [{ unitId: "RGM_79", kitId: "machine_gun" }],
      ],
      false,
      { costLimit: 99999, unitCostLimit: 10000 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    const [a, b] = game.units;
    Object.assign(a, { x: 10, y: 10 });
    Object.assign(b, { x: 14, y: 10, hp: 100000 });
    const w = Rules.modelOf(a).weapons.find((w) => w.special?.type === "snipe");
    a.snipeOrder = { target: b.id, weapon: w.id, readyRound: 3 };
    a.acted = true;
    battleView = null;
    phase = "idle";
    setPageView("game");
    MapCamera.setZoom(3);
    MapCamera.focus(12, 10, { preserveZoom: true });
    drawMap(performance.now());
    const ctx = byId("map").getContext("2d");
    PlanningUI.reset();
    const beginning = PlanningUI.sniperLocks(ctx, 0),
      waiting = PlanningUI.sniperLocks(ctx, 60000);
    Rules.end(game);
    const enemyTurn = PlanningUI.sniperLocks(ctx, 120000);
    Rules.end(game);
    const ready = PlanningUI.sniperLocks(ctx, 120100);
    drawMap(performance.now());
    const image = SpriteRenderer.images[ART.effects.SniperLock.asset];
    const ordinary = Rules.modelOf(a).weapons.find((v) => v.id === w.special.baseWeapon);
    return {
      beginning,
      waiting,
      enemyTurn,
      ready,
      imageReady: image.complete,
      frames: ART.effects.SniperLock.frames,
      speed: w.projectile.speed,
      ordinarySpeed: ordinary.projectile.speed,
    };
  });
  expect(result.beginning[0]).toMatchObject({ frame: 0, red: false });
  expect(result.waiting[0]).toMatchObject({ frame: 2, red: false });
  expect(result.enemyTurn[0]).toMatchObject({ frame: 2, red: false });
  expect(result.ready[0]).toMatchObject({ frame: 19, red: true });
  expect(result.imageReady).toBe(true);
  expect(result.frames).toBe(20);
  expect(result.speed).toBe(result.ordinarySpeed);
  expect(result.speed).toBeGreaterThan(1);
  await page.screenshot({ path: ".openai/sniper-lock-red.png" });
  expect(errors).toEqual([]);
});
