const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`contract route map is usable and synchronized at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.locator("#openSkirmish").click();
    await page.locator("#offlineRoomMode").selectOption("sweep");
    await page.locator("#createOfflineRoom").click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await page.evaluate(() =>
      Net.request("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] }),
    );
    await expect(page.locator("#confirmFinalFormation")).toBeVisible();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#sweepMission")).toBeVisible();
    await page.locator('[data-sweep-node="0:1"]').click();
    await expect(page.locator("#sweepConfirm")).toBeEnabled();
    await page.screenshot({ path: `tmp/verification/screenshots/sweep-map-${width}.png` });
    await page.locator("#sweepConfirm").click();
    await expect(page.locator("#sweepMission")).toBeHidden();
    await expect(page.locator("#deploymentRoster")).toBeVisible();
    expect(errors).toEqual([]);
  });

test("extraction credits banked loot only once and displays recovered chassis in the normal results", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    const original = createRoomEngine;
    createRoomEngine = (options) =>
      (window.sweepTestEngine = original({ ...options, aiDelayMs: 999999 }));
  });
  await page.locator("#openSkirmish").click();
  await page.locator("#offlineRoomMode").selectOption("sweep");
  await page.locator("#createOfflineRoom").click();
  await page.evaluate(() =>
    Net.request("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] }),
  );
  await page.locator("#confirmFinalFormation").click();
  await page.locator('[data-sweep-node="0:1"]').click();
  await page.locator("#sweepConfirm").click();
  const before = await page.evaluate(() => ({
    money: Economy.snapshot().money,
    inventory: Economy.quantity("RGZ_91"),
  }));
  await page.locator("#confirmDeployment").click();
  await page.evaluate(() => {
    const room = [...sweepTestEngine.rooms.values()][0];
    room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
    room.game.winner = 0;
    room.phase = "finished";
    const host = room.seats[0];
    room.sweep.pending[host.id].inventory.RGZ_91 = 1;
    sweepTestEngine.broadcast(room);
  });
  await expect(page.locator("#sweepMission")).toBeVisible();
  expect(await page.evaluate(() => Economy.snapshot().money)).toBe(before.money);
  expect(await page.evaluate(() => Economy.quantity("RGZ_91"))).toBe(before.inventory);
  await page.locator("#sweepExtract").click();
  await page.getByRole("dialog").getByRole("button", { name: "确认", exact: true }).click();
  await expect(page.locator("#victoryUnitIcons")).toContainText("获得单位库存");
  await expect
    .poll(() => page.evaluate(() => Economy.quantity("RGZ_91")))
    .toBe(before.inventory + 1);
  const paid = await page.evaluate(() => Economy.snapshot().money);
  expect(paid).toBeGreaterThan(before.money);
  await page.evaluate(() => sweepTestEngine.broadcast([...sweepTestEngine.rooms.values()][0]));
  expect(await page.evaluate(() => Economy.snapshot().money)).toBe(paid);
});
