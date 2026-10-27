const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server.js");
async function lobby(page, port, name) {
  await page.goto("http://127.0.0.1:" + port);
  await page.locator("#playerId").fill(name);
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await page.locator("#serverAddress").fill("127.0.0.1:" + port);
  await page.locator("#connectServer").click();
  await expect(page.locator("#lobby")).toBeVisible();
}
test("friendly owner roster hides enemies, shows names, HP/EN/status and focuses units; spectators see all", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    watch = await context.newPage(),
    errors = [];
  for (const p of [page, watch]) p.on("pageerror", (e) => errors.push(e.message));
  try {
    await lobby(page, address.port, "Player01");
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("ROSTER");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
    await waitForRoomSettings(page);
    for (const seat of [1, 2, 3]) await page.locator("#addAI" + seat).click();
    await lobby(watch, address.port, "Observer");
    await watch.locator(".room-card").filter({ hasText: "ROSTER" }).getByRole("button").click();
    await expect.poll(() => watch.evaluate(() => Net.seat)).toBeNull();
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#deploymentPanel")).toBeVisible();
    await expect(watch.locator("#deploymentPanel")).toBeVisible();
    await expect(page.locator(".roster-owner")).toHaveCount(2);
    await expect(watch.locator(".roster-owner")).toHaveCount(4);
    await expect(page.locator("#enemies .roster-unit")).toHaveCount(0);
    const roster = await page
      .locator(".roster-unit")
      .evaluateAll((rows) => rows.map((row) => getUnit(row.dataset.unitId).team));
    expect(roster.every((team) => team === 0)).toBe(true);
    await expect(
      page.locator('.roster-owner[data-owner-seat="0"] .roster-owner-heading'),
    ).toHaveText("Player013/3");
    await expect(
      page.locator('.roster-owner[data-owner-seat="2"] .roster-owner-heading'),
    ).toContainText("AI 3");
    const unit = page.locator('.roster-unit[data-unit-id="0-0"]');
    await expect(unit.locator(".roster-unit-name")).toHaveText("吉姆");
    await expect(unit.locator(".roster-unit-name")).not.toContainText("RGM");
    const room = app.rooms.get("ROSTER"),
      own = room.game.units.find((u) => u.id === "0-0");
    own.en = 25;
    own.hp = Math.floor(require("../shared/rules.js").modelOf(own).hp / 2);
    own.moved = true;
    room.game.units.find((u) => u.id === "0-2").hp = 0;
    room.log.unshift("战斗LOG同步测试");
    await page.evaluate(() => Net.request("sync"));
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBeNull();
    await watch.evaluate(() => Net.request("sync"));
    await expect.poll(() => watch.evaluate(() => Net.awaiting)).toBeNull();
    await expect(unit.locator(".en-track")).toHaveAttribute("aria-valuenow", "25");
    await expect(unit.locator(".en-fill")).toHaveCSS("background-color", "rgb(243, 212, 94)");
    await expect(unit.locator(".en-fill")).toHaveCSS("width", /./);
    await expect(unit.locator(".roster-status")).toHaveText("已移动 · 可攻击");
    await expect(page.locator('.roster-owner[data-owner-seat="0"] .roster-owner-count')).toHaveText(
      "2/3",
    );
    const bars = await unit.evaluate((row) => {
      const hp = row.querySelector(".hp-track").getBoundingClientRect(),
        en = row.querySelector(".en-track").getBoundingClientRect(),
        status = row.querySelector(".roster-status").getBoundingClientRect();
      return {
        hp: hp.bottom,
        en: en.top,
        enBottom: en.bottom,
        status: status.top,
        width: parseFloat(row.querySelector(".en-fill").style.width),
      };
    });
    expect(bars.hp).toBeLessThan(bars.en);
    expect(bars.enBottom).toBeLessThan(bars.status);
    expect(bars.width).toBe(25);
    await page.evaluate(() => {
      MapCamera.setZoom(3);
      const enemy = game.units.find((u) => u.team === 1);
      MapCamera.focus(enemy.x, enemy.y);
    });
    expect(
      await page.evaluate(() => mapPosition(getUnit("0-0").x, getUnit("0-0").y).x),
    ).toBeLessThan(0);
    await unit.click();
    const focus = await page.evaluate(() => ({
      selected,
      p: mapPosition(getUnit("0-0").x, getUnit("0-0").y),
      w: byId("map").getBoundingClientRect().width,
      h: byId("map").getBoundingClientRect().height,
    }));
    expect(focus.selected).toBe("0-0");
    expect(focus.p.x).toBeGreaterThan(0);
    expect(focus.p.x).toBeLessThan(focus.w);
    expect(focus.p.y).toBeGreaterThan(0);
    expect(focus.p.y).toBeLessThan(focus.h);
    await page.screenshot({ path: ".openai/owner-roster-en.png" });
    await watch.screenshot({ path: ".openai/spectator-owner-roster.png" });
    await page.locator("#roomSettings").click();
    await expect(page.locator("#roomMainMenu")).toHaveText("返回战斗");
    await expect(page.locator("#roomReturn")).toHaveCount(0);
    await page.locator("#roomShowLog").click();
    await expect(page.locator("#roomCombatLog")).toContainText("战斗LOG同步测试");
    room.log.unshift("房间内实时LOG更新");
    await page.evaluate(() => Net.request("sync"));
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBeNull();
    await watch.evaluate(() => Net.request("sync"));
    await expect.poll(() => watch.evaluate(() => Net.awaiting)).toBeNull();
    await expect(page.locator("#roomCombatLog")).toContainText("房间内实时LOG更新");
    await page.locator("#roomShowChat").click();
    await page.locator("#roomChatInput").fill("房间聊天保留");
    await page.locator("#roomChatSend").click();
    await expect(page.locator("#roomChatLines")).toContainText("房间聊天保留");
    await page.locator("#roomShowLog").click();
    await expect(page.locator("#roomCombatLog")).toBeVisible();
    await page.screenshot({ path: ".openai/room-combat-log.png" });
    await page.locator("#roomMainMenu").click();
    await expect(page.locator("#gameScene")).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    await watch.close();
    await page.close();
    await app.close();
  }
});
test("native ban dropdowns toggle multiple tags, clear all and apply independently to teams", async ({
  page,
}) => {
  const { pathToFileURL } = require("node:url"),
    path = require("node:path");
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator('#roomTagRestrictions input[type="checkbox"]')).toHaveCount(0);
  const factions = page.locator("#roomBan-bannedFactions");
  await factions.selectOption("EFSF");
  await factions.selectOption("ZEON");
  await waitForRoomSettings(page);
  expect(await page.evaluate(() => Net.snapshot.settings.bannedFactions)).toEqual(["EFSF", "ZEON"]);
  await factions.selectOption("EFSF");
  await waitForRoomSettings(page);
  expect(await page.evaluate(() => Net.snapshot.settings.bannedFactions)).toEqual(["ZEON"]);
  await factions.selectOption("NONE");
  await waitForRoomSettings(page);
  expect(await page.evaluate(() => Net.snapshot.settings.bannedFactions)).toEqual([]);
  await page.locator(".team-slot").first().locator("summary").click();
  await page.locator("#teamBan-0-bannedEras").selectOption("0079");

  expect(await page.evaluate(() => Net.snapshot.settings.teamRestrictions[0].bannedEras)).toEqual([
    "0079",
  ]);
  expect(await page.evaluate(() => Net.snapshot.settings.teamRestrictions[1].bannedEras)).toEqual(
    [],
  );
  await expect(page.locator("#startRoomGame")).toBeDisabled();
});
test("red-side offline player sees only red allies and owner groups remain bounded on mobile", async ({
  page,
}) => {
  const { pathToFileURL } = require("node:url"),
    path = require("node:path"),
    errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
  await waitForRoomSettings(page);
  await page.locator("#removeAI1").click();
  await page.locator("#chooseSeat1").click();
  for (const seat of [0, 2, 3]) await page.locator("#addAI" + seat).click();
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  const teams = await page
    .locator(".roster-unit")
    .evaluateAll((rows) => rows.map((row) => getUnit(row.dataset.unitId).team));
  expect(teams.length).toBe(12);
  expect(teams.every((team) => team === 1)).toBe(true);
  await expect(page.locator(".roster-owner").first()).toHaveAttribute("data-owner-seat", "1");
  await page.setViewportSize({ width: 430, height: 900 });
  const size = await page.evaluate(() => ({
    roster: byId("unitRoster").getBoundingClientRect().height,
    width: document.documentElement.scrollWidth,
  }));
  expect(size.roster).toBeLessThanOrEqual(201);
  expect(size.width).toBeLessThanOrEqual(430);
  await expect(page.locator(".roster-owner-heading").first()).toBeVisible();
  await page.locator('.roster-unit[data-unit-id="1-0"]').click();
  expect(await page.evaluate(() => selected)).toBe("1-0");
  expect(await page.evaluate(() => MapCamera.zoom)).toBeGreaterThanOrEqual(1.75);
  await page.screenshot({ path: ".openai/mobile-friendly-roster.png" });
  expect(errors).toEqual([]);
});
