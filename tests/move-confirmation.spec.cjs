const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("direct map clicks preview moves, cancel immediately, and reveal enemies only on confirmation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.evaluate(() => {
    const original = createRoomEngine;
    createRoomEngine = (options) =>
      (window.moveTestEngine = original({ ...options, aiDelayMs: 100000 }));
  });
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await page.locator("#confirmDeployment").click();
  await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
  await page.evaluate(() => {
    const room = moveTestEngine.rooms.get("OFFLINE");
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    room.game = Rules.create(
      false,
      1,
      [
        [entry, entry, entry],
        [entry, entry, entry],
      ],
      false,
      room.settings,
    );
    for (const unit of room.game.units) {
      Object.assign(unit, {
        x: unit.team ? 45 : 0,
        y: 1 + Number(unit.id.split("-")[1]),
        hp: 10000,
      });
    }
    Object.assign(room.game.units[0], { x: 4, y: 8 });
    Object.assign(
      room.game.units.find((unit) => unit.id === "1-0"),
      { x: 19, y: 8 },
    );
    room.game.tiles = room.game.tiles.map((row) => row.map(() => "plain"));
    room.phase = "idle";
    room.lastEvent = null;
    Net.request("sync");
  });
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  const originalIntel = await page.evaluate(() => JSON.stringify(game.intel));
  async function cellClick(x, y) {
    const point = await page.evaluate(
      ({ x, y }) => {
        drawMap(performance.now());
        const point = mapPosition(x, y),
          box = byId("map").getBoundingClientRect();
        return { x: box.left + point.x, y: box.top + point.y };
      },
      { x, y },
    );
    await page.mouse.click(point.x, point.y);
  }
  await cellClick(4, 8);
  const beforeRange = await page.evaluate(() => {
    drawMap(performance.now());
    return Math.max(...[...mapRangeCache.attackArea].map((cell) => Number(cell.split(",")[0])));
  });
  await cellClick(10, 8);
  await expect(page.locator("#hudConfirmMove")).toBeEnabled();
  expect(await page.evaluate(() => getUnit("0-0").x)).toBe(4);
  expect(await page.evaluate(() => JSON.stringify(game.intel))).toBe(originalIntel);
  expect(await page.evaluate(() => !!getUnit("1-0"))).toBe(false);
  const previewRange = await page.evaluate(() => {
    drawMap(performance.now());
    return Math.max(...[...mapRangeCache.attackArea].map((cell) => Number(cell.split(",")[0])));
  });
  expect(previewRange).toBe(beforeRange + 6);
  await expect(page.locator("#endTurn")).toBeDisabled();
  const layout = await page.evaluate(() => ({
    cancel: byId("hudCancelAction").getBoundingClientRect().toJSON(),
    confirm: byId("hudConfirmMove").getBoundingClientRect().toJSON(),
  }));
  expect(layout.cancel.x).toBeLessThan(layout.confirm.x);
  expect(layout.cancel.width).toBe(layout.confirm.width);
  expect(layout.cancel.height).toBe(layout.confirm.height);
  await page.locator("#hudCancelAction").click();
  await expect(page.locator("#hudConfirmMove")).toBeHidden();
  expect(await page.evaluate(() => getUnit("0-0").pendingMove || null)).toBe(null);
  expect(await page.evaluate(() => PlanningUI.motion(getUnit("0-0"), performance.now()))).toBe(
    null,
  );
  expect(await page.evaluate(() => getUnit("0-0").x)).toBe(4);
  expect(
    await page.evaluate(() => {
      drawMap(performance.now());
      return Math.max(...[...mapRangeCache.attackArea].map((cell) => Number(cell.split(",")[0])));
    }),
  ).toBe(beforeRange);
  await cellClick(10, 8);
  await expect(page.locator("#hudConfirmMove")).toBeEnabled();
  await page.locator("#hudConfirmMove").click();
  await expect.poll(() => page.evaluate(() => getUnit("0-0").x)).toBe(10);
  await expect(page.locator("#hudConfirmMove")).toBeHidden();
  expect(await page.evaluate(() => !!getUnit("1-0"))).toBe(true);
  expect(await page.evaluate(() => game.intel.detectedIds.includes("1-0"))).toBe(true);
  await page.evaluate(() => {
    const room = moveTestEngine.rooms.get("OFFLINE");
    room.game.units.find((unit) => unit.id === "1-0").x = 12;
    Net.request("sync");
  });
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  await cellClick(12, 8);
  await expect.poll(() => page.evaluate(() => mode)).toBe("attack-weapons");
  expect(errors).toEqual([]);
});
