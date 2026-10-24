const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
test("faction cards filter and offline encounter uses room preparation without network access", async ({
  page,
}) => {
  const errors = [],
    sockets = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (s) => sockets.push(s.url()));
  await page.route("**/*", (route) =>
    /^https?:/.test(route.request().url()) ? route.abort() : route.continue(),
  );
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await expect(page.locator("#startAI,#startHotseat")).toHaveCount(0);
  await page.locator("#openFormation").click();
  await expect(page.locator(".catalog-unit")).toHaveCount(11);
  await expect(page.locator(".catalog-unit img")).toHaveCount(11);
  await page.screenshot({ path: ".openai/faction-formation.png" });
  await page.locator("#formationFaction").selectOption("ZEON");
  await expect(page.locator(".catalog-unit")).toHaveCount(6);
  await expect(page.locator(".catalog-unit .faction-tag")).toHaveText(Array(6).fill("ZEON"));
  await page.locator('[data-unit-id="MS_06F"]').click();
  await page.locator("#addFormationUnit").click();
  await expect(page.locator(".formation-row").last()).toContainText("ZEON");
  await page.locator("#formationFaction").selectOption("EFSF");
  await expect(page.locator(".catalog-unit")).toHaveCount(5);
  await page.locator("#saveFormation").click();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#roomPreparation")).toBeVisible();
  await expect(page.locator("#roomTitle")).toHaveText("离线遭遇战房间");
  expect(await page.evaluate(() => Net.local)).toBe(true);
  await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
  await page.locator("#roomCostLimit").fill("4000");
  await waitForRoomSettings(page);
  await expect(page.locator("#addAI2")).toBeVisible();
  await page.locator("#addAI2").click();
  await expect(page.locator("#removeAI2")).toBeVisible();
  await page.locator("#addAI3").click();
  await expect(page.locator("#removeAI3")).toBeVisible();
  await page.locator("#toggleReady").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  expect(await page.evaluate(() => game.deployment)).toEqual([false, true, true, true]);
  await page.locator("#confirmDeployment").click();
  await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
  expect(await page.evaluate(() => Net.canAct())).toBe(true);
  expect(sockets).toEqual([]);
  expect(errors).toEqual([]);
  await page.screenshot({ path: ".openai/offline-encounter.png" });
  await page.evaluate(() => Net.leave());
});

test("offline room resolves a real battle, returns to preparation and starts another match", async ({
  page,
}) => {
  const errors = [],
    sockets = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("websocket", (s) => sockets.push(s.url()));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  // Capture the in-memory engine solely in this test to stage a decisive encounter.
  await page.evaluate(() => {
    const original = createRoomEngine;
    createRoomEngine = (options) => {
      window.testRoomEngine = original({ ...options, aiDelayMs: 20 });
      return testRoomEngine;
    };
  });
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#toggleReady")).toBeVisible();
  await page.locator("#toggleReady").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#confirmDeployment")).toBeVisible();
  await page.locator("#confirmDeployment").click();
  await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
  const oldMatch = await page.evaluate(() => Net.snapshot.matchId);
  await page.evaluate(() => {
    const room = testRoomEngine.rooms.get("OFFLINE");
    const a = room.game.units.find((u) => u.ownerSeat === 0);
    const enemies = room.game.units.filter((u) => u.ownerSeat === 1);
    for (const u of enemies) u.hp = 0;
    const b = enemies[0];
    Object.assign(a, { x: 3, y: 5 });
    Object.assign(b, { x: 4, y: 5, hp: 1, shield: 0 });
    room.game.seed = 0;
    room.game.tiles[5][3] = room.game.tiles[5][4] = "plain";
    Net.request("sync");
  });
  await expect
    .poll(() => page.evaluate(() => game.units.filter((u) => u.team === 1 && u.hp > 0).length))
    .toBe(1);
  await page.evaluate(() => {
    const a = game.units.find((u) => u.ownerSeat === 0);
    const b = game.units.find((u) => u.ownerSeat === 1 && u.hp > 0);
    beginAttack(
      a,
      b,
      UnitModels[a.model].weapons.find((w) => w.type === "melee"),
    );
  });
  await expect(page.locator("#battle")).toBeVisible();
  await page.locator("#skipBattle").click();
  await page.locator("#continueBattle").click();
  await expect(page.locator("#victory")).toBeVisible();
  await expect(page.locator("#victoryCountdown")).toContainText("返回房间");
  await page.locator("#playAgain").click();
  await expect(page.locator("#roomPreparation")).toBeVisible();
  await expect(page.locator("#removeAI1")).toBeVisible();
  expect(await page.evaluate(() => Net.snapshot.members.find((m) => m.bot).ready)).toBe(true);
  await page.locator("#toggleReady").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  expect(await page.evaluate(() => Net.snapshot.matchId)).not.toBe(oldMatch);
  expect(await page.evaluate(() => game.units.every((u) => u.hp === UnitModels[u.model].hp))).toBe(
    true,
  );
  await page.evaluate(() => openMenu());
  expect(await page.evaluate(() => testRoomEngine.rooms.size)).toBe(0);
  expect(
    await page.evaluate(() => ({ active: Net.active, local: Net.local, frame: animationFrameId })),
  ).toEqual({ active: false, local: false, frame: null });
  expect(errors).toEqual([]);
  expect(sockets).toEqual([]);
});
