const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  { createServer } = require("../server.js");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function offline(page) {
  await page.goto(url);
  await expect(page).toHaveTitle("ProjectGreed V0.2");
  await expect(page.locator("#start")).toContainText("V0.2");
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
}
test("exhausted offline turns wait a second and show three ordered right-to-left cutins with a center hold", async ({
  page,
}) => {
  await offline(page);
  await page.evaluate(() => {
    window.turnMessages = [];
    new MutationObserver(() => window.turnMessages.push(byId("turnCutinCard").textContent)).observe(
      byId("turnCutinCard"),
      { childList: true },
    );
    for (const u of game.units.filter((u) => u.team === 0)) Rules.wait(game, u);
    window.exhaustedAt = performance.now();
    update();
  });
  await page.waitForTimeout(600);
  expect(await page.evaluate(() => game.team)).toBe(0);
  await expect(page.locator("#turnCutin")).toBeVisible();
  expect(await page.evaluate(() => performance.now() - window.exhaustedAt)).toBeGreaterThanOrEqual(
    1000,
  );
  await expect(page.locator("#turnCutinCard")).toHaveText("队伍1结束回合");
  await expect(page.locator("#endTurn")).toBeDisabled();
  const positions = await page.evaluate(() => {
    const card = byId("turnCutinCard"),
      animation = card.getAnimations()[0],
      positions = [];
    animation.pause();
    for (const time of [50, 500, 800, 1100]) {
      animation.currentTime = time;
      positions.push(card.getBoundingClientRect().x);
    }
    animation.play();
    return { positions, center: (innerWidth - card.getBoundingClientRect().width) / 2 };
  });
  expect(positions.positions[0]).toBeGreaterThan(positions.center);
  expect(positions.positions[1]).toBeCloseTo(positions.center, 0);
  expect(positions.positions[2]).toBeCloseTo(positions.center, 0);
  expect(positions.positions[3]).toBeLessThan(0);
  await expect(page.locator("#turnCutin")).toBeHidden({ timeout: 6000 });
  expect(await page.evaluate(() => window.turnMessages)).toEqual([
    "队伍1结束回合",
    "回合2",
    "队伍2开始行动",
  ]);
  expect(await page.evaluate(() => [game.team, game.round, TurnFlow.active])).toEqual([
    1,
    2,
    false,
  ]);
});
test("a moved unit with an available attack keeps its turn; leaving cancels a pending automatic end", async ({
  page,
}) => {
  await offline(page);
  await page.evaluate(() => {
    const a = game.units[0],
      b = game.units.find((u) => u.team === 1);
    for (const u of game.units.filter((u) => u.team === 0)) u.moved = true;
    b.x = a.x + 2;
    b.y = a.y;
    update();
  });
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => game.team)).toBe(0);
  await page.evaluate(() => {
    for (const u of game.units.filter((u) => u.team === 0)) u.en = 0;
    update();
  });
  await page.locator("#netSettings").click();
  await page.locator("#confirmLeave").click();
  await page.waitForTimeout(1100);
  await expect(page.locator("#turnCutin")).toBeHidden();
  expect(await page.evaluate(() => [pageView, game.round])).toEqual(["menu", 1]);
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  await page.evaluate(() => {
    for (const u of game.units.filter((u) => u.team === 0)) Rules.wait(game, u);
    update();
  });
  await expect(page.locator("#turnCutin")).toBeVisible();
  // Leaving during an active animation also cancels all later segments.
  await page.evaluate(() => openMenu());
  await page.waitForTimeout(1300);
  await expect(page.locator("#turnCutin")).toBeHidden();
});
test("map zoom anchors the cursor, drag pans without moving units, and zoomed clicks select and move the correct cell", async ({
  page,
}) => {
  await offline(page);
  await page.evaluate(() => {
    Object.assign(game.units[0], { x: 11, y: 8 });
    game.tiles[8][11] = game.tiles[8][12] = "plain";
    selected = null;
    update();
  });
  const canvas = page.locator("#map"),
    box = await canvas.boundingBox();
  const cursor = { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
  const initial = await page.evaluate(() => ({ ...mapGeo }));
  await page.mouse.move(cursor.x, cursor.y);
  await page.mouse.wheel(0, -460);
  await expect.poll(() => page.evaluate(() => MapCamera.zoom)).toBeGreaterThan(1.9);
  const anchored = await page.evaluate(() => ({ ...mapGeo }));
  expect((cursor.x - box.x - anchored.ox) / anchored.tile).toBeCloseTo(
    (cursor.x - box.x - initial.ox) / initial.tile,
    3,
  );
  const before = await page.evaluate(() => game.units.map((u) => [u.x, u.y]));
  await page.mouse.down();
  await page.mouse.move(cursor.x + 65, cursor.y + 45, { steps: 8 });
  await page.mouse.up();
  expect(await page.evaluate(() => selected)).toBe(null);
  expect(await page.evaluate(() => game.units.map((u) => [u.x, u.y]))).toEqual(before);
  expect(await page.evaluate(() => mapGeo.ox)).toBeGreaterThan(anchored.ox + 50);
  const point = await page.evaluate(() => mapPosition(11, 8));
  await page.mouse.click(box.x + point.x, box.y + point.y);
  expect(await page.evaluate(() => selected)).toBe("0-0");
  const destination = await page.evaluate(() => mapPosition(12, 8));
  await page.mouse.click(box.x + destination.x, box.y + destination.y);
  await expect.poll(() => page.evaluate(() => [game.units[0].x, game.units[0].y])).toEqual([12, 8]);
  await page.locator("#mapZoomIn").click();
  await page.locator("#mapZoomIn").click();
  await expect(page.locator("#mapZoomLabel")).toHaveText("300%");
  await expect(page.locator("#mapZoomIn")).toBeDisabled();
  await page.locator("#mapZoomReset").click();
  await expect(page.locator("#mapZoomLabel")).toHaveText("100%");
  await expect(page.locator("#mapZoomOut")).toBeDisabled();
  await page.screenshot({ path: ".openai/projectgreed-map.png" });
});
test("both network teams see one cutin per authoritative turn and repeated snapshots do not replay it", async ({
  page,
  context,
}) => {
  const server = createServer({ host: "127.0.0.1", port: 0 }),
    address = await server.listen(),
    other = await context.newPage();
  try {
    for (const client of [page, other]) {
      await client.goto(`http://127.0.0.1:${address.port}`);
      await client.locator("#openSkirmish").click();
      await client.locator("#openRooms").click();
      await client.locator("#serverAddress").fill(`127.0.0.1:${address.port}`);
      await client.locator("#connectServer").click();
      await expect(client.locator("#lobby")).toBeVisible();
    }
    await page.locator("#roomCode").fill("CUTIN");
    await page.locator("#createRoom").click();
    await other
      .locator(".room-card")
      .filter({ hasText: "CUTIN" })
      .getByRole("button", { name: "加入", exact: true })
      .click();
    await page.locator("#toggleReady").click();
    await other.locator("#toggleReady").click();
    await page.locator("#confirmFinalFormation").click();
    await other.locator("#confirmFinalFormation").click();
    await page.locator("#confirmDeployment").click();
    await other.locator("#confirmDeployment").click();
    await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
    await page.evaluate(() => Net.request("end_turn"));
    for (const client of [page, other]) {
      await expect(client.locator("#turnCutinCard")).toHaveText("队伍1结束回合");
      await client.evaluate(() => {
        Net.applySnapshot(Net.snapshot);
        Net.applySnapshot(Net.snapshot);
      });
      await expect(client.locator("#endTurn")).toBeDisabled();
    }
    await expect(page.locator("#turnCutin")).toBeHidden({ timeout: 6000 });
    await expect(other.locator("#turnCutin")).toBeHidden();
    for (const client of [page, other]) {
      await client.evaluate(() => Net.applySnapshot(Net.snapshot));
      await expect(client.locator("#turnCutin")).toBeHidden();
      expect(await client.evaluate(() => game.round)).toBe(2);
    }
  } finally {
    await page.close();
    await other.close();
    await server.close();
  }
});
