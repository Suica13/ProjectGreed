const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  { createServer } = require("../server.js");
const url = pathToFileURL(path.resolve("public/client.html")).href;
async function offline(page) {
  await page.goto(url);
  await expect(page).toHaveTitle("ProjectGreed V11");
  await expect(page.locator("#start")).toContainText("V11");
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
}
test("exhausted offline turns wait for manual end and show three ordered right-to-left cutins with a center hold", async ({
  page,
}) => {
  await offline(page);
  await page.evaluate(() => {
    window.turnMessages = [];
    new MutationObserver(() => window.turnMessages.push(byId("turnCutinCard").textContent)).observe(
      byId("turnCutinCard"),
      { childList: true },
    );
    for (const u of game.units.filter((u) => u.team === 0 && Rules.onMap(u) && !u.acted))
      Rules.wait(game, u);
    window.exhaustedAt = performance.now();
    update();
  });
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => game.team)).toBe(0);
  await expect(page.locator("#turnCutin")).toBeHidden();
  await page.evaluate(() => endTurn());
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
    for (const u of game.units.filter((u) => u.team === 0 && Rules.onMap(u) && !u.acted))
      Rules.wait(game, u);
    update();
  });
  await page.evaluate(() => endTurn());
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
    const e = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[e], [e]], false, { fogMode: "disabled" });
    phase = "idle";
    game.tiles.forEach((row) => row.fill("plain"));
    Object.assign(game.units[0], { x: 11, y: 8 });
    Object.assign(game.units[1], { x: 18, y: 8 });
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
  const point = await page.evaluate(() => {
    const p = mapPosition(11, 8),
      canvas = byId("map");
    return {
      x: (p.x * canvas.clientWidth) / canvas.width,
      y: (p.y * canvas.clientHeight) / canvas.height,
    };
  });
  await page.mouse.click(box.x + point.x, box.y + point.y);
  await page.evaluate(() => {
    selected = game.units[0].id;
    update();
  });
  expect(await page.evaluate(() => selected)).toBe("0-0");
  await page.locator('[data-unit-command="move"]').click();
  await page.evaluate(() => Rules.move(game, game.units[0], 12, 8));

  await expect.poll(() => page.evaluate(() => [game.units[0].x, game.units[0].y])).toEqual([12, 8]);
  while (await page.locator("#mapZoomIn").isEnabled()) await page.locator("#mapZoomIn").click();
  await expect(page.locator("#mapZoomLabel")).toHaveText(
    String(await page.evaluate(() => Math.round(MapCamera.maxZoom * 100))) + "%",
  );
  await expect(page.locator("#mapZoomIn")).toBeDisabled();
  await page.locator("#mapZoomReset").click();
  await expect(page.locator("#mapZoomLabel")).toHaveText("50%");
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
    await other.locator("#toggleReady").click();
    await page.locator("#startRoomGame").click();
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

test("map shows HP and proportional yellow EN at every zoom, names only from 300 percent", async ({
  page,
}) => {
  await offline(page);
  const samples = await page.evaluate(() => {
    const e = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[e], [e]], false, { fogMode: "disabled" });
    phase = "idle";
    game.tiles.forEach((row) => row.fill("plain"));
    Object.assign(game.units[0], { x: 8, y: 8 });
    Object.assign(game.units[1], { x: 12, y: 8 });
    const canvas = byId("map"),
      ctx = canvas.getContext("2d");
    const fillText = ctx.fillText,
      fillRect = ctx.fillRect;
    const units = game.units.filter((u) => u.hp > 0);
    const unit = units[0],
      originalEn = unit.en;
    unit.en = Rules.modelOf(unit).en / 2;
    const samples = [];
    try {
      for (const zoom of [1, 2.999, 3, 5]) {
        MapCamera.setZoom(zoom);
        const names = [],
          energy = [],
          health = [];
        ctx.fillText = function (text, ...args) {
          if (units.some((u) => unitName(u) === text)) names.push(text);
          return fillText.call(this, text, ...args);
        };
        ctx.fillRect = function (x, y, width, height) {
          if (this.fillStyle === "#efd568") energy.push(width);
          if (["#ed9685", "#83d6ee"].includes(this.fillStyle) && height === 4) health.push(width);
          return fillRect.call(this, x, y, width, height);
        };
        drawMap(performance.now());
        samples.push({
          zoom: MapCamera.zoom,
          names: names.length,
          energy: energy.length,
          health: health.length,
          ratio: energy[0] / (mapGeo.tile * 0.72 * BattleScene.settings().mapBarScale),
          units: units.length,
        });
      }
    } finally {
      ctx.fillText = fillText;
      ctx.fillRect = fillRect;
      unit.en = originalEn;
    }
    MapCamera.focus(unit.x, unit.y);
    return samples;
  });
  for (const sample of samples) {
    expect(sample.energy).toBe(sample.units);
    expect(sample.health).toBe(sample.units);
    expect(sample.ratio).toBeCloseTo(0.5, 6);
    expect(sample.names).toBe(sample.zoom >= 3 ? sample.units : 0);
  }
  await expect(page.locator("#mapZoomLabel")).toHaveText("500%");
  await page.locator("#map").screenshot({ path: ".openai/map-500-percent-bars.png" });
});
