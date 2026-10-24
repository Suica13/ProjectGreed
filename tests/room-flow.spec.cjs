const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  { createServer } = require("../server.js");
const fileURL = pathToFileURL(path.resolve("public/client.html")).href;
async function connect(page, address, name) {
  await page.goto("http://127.0.0.1:" + address.port);
  await page.locator("#playerId").fill(name);
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
  await page.locator("#connectServer").click();
  await expect(page.locator("#lobby")).toBeVisible();
}
async function join(page, room) {
  await page.locator(".room-card").filter({ hasText: room }).getByRole("button").click();
  await expect(page.locator("#roomPreparation")).toBeVisible();
}
async function startMatch(a, b) {
  await a.locator("#toggleReady").click();
  await b.locator("#toggleReady").click();
  await a.locator("#confirmFinalFormation").click();
  await b.locator("#confirmFinalFormation").click();
  await a.locator("#confirmDeployment").click();
  await b.locator("#confirmDeployment").click();
  await expect.poll(() => a.evaluate(() => phase)).toBe("idle");
}
async function finishMatch(app, room, pages, noEffects = false) {
  const g = app.rooms.get(room).game,
    a = g.units.find((u) => u.id === "0-0"),
    b = g.units.find((u) => u.id === "1-0");
  for (const unit of g.units.filter((u) => u.team === 1)) unit.hp = 0;
  Object.assign(a, { x: 2, y: 4, acted: false, en: 100 });
  Object.assign(b, { x: 4, y: 4, hp: 1, shield: 0 });
  g.tiles[4][2] = g.tiles[4][4] = "plain";
  g.seed = 1;
  if (noEffects)
    for (const page of pages)
      await page.evaluate(() => {
        MapEffects.capture = () => {};
      });
  await pages[0].evaluate(() =>
    Net.request("attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_BeamSprayGun" }),
  );
  await expect(pages[1].locator("#reaction")).toBeVisible();
  await pages[1].locator("#responseDefend").click();
  await pages[1].locator("#confirmResponse").click();
  for (const page of pages) {
    await expect(page.locator("#battle")).toBeVisible();
    await page.locator("#skipBattle").click();
  }
  for (const page of pages.slice(2)) await page.locator("#continueBattle").click();
  await pages[0].locator("#continueBattle").click();
  await pages[1].locator("#continueBattle").click();
  for (const page of pages) await expect(page.locator("#victory")).toBeVisible({ timeout: 7000 });
}
test("nine-unit rosters and long logs scroll inside a bounded desktop viewport", async ({
  page,
}) => {
  await page.goto(fileURL);
  await page.locator("#openFormation").click();
  await page.locator('[data-unit-id="MS_06F"]').click();
  for (let i = 0; i < 6; i++) await page.locator("#addFormationUnit").click();
  await page.locator("#saveFormation").click();
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  await expect(page.locator(".roster-unit")).toHaveCount(18);
  await page.locator("#allies .roster-unit").first().click();
  await page.evaluate(() => {
    for (let i = 0; i < 100; i++) addLog("滚动日志 " + i);
  });
  for (const size of [
    { width: 1600, height: 1000 },
    { width: 1366, height: 768 },
  ]) {
    await page.setViewportSize(size);
    const geometry = await page.evaluate(() => {
      const box = (id) => {
        const r = byId(id).getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, height: r.height };
      };
      return {
        body: document.documentElement.scrollHeight,
        viewport: innerHeight,
        map: box("mapWrap"),
        log: box("log"),
        roster: byId("unitRoster").scrollHeight > byId("unitRoster").clientHeight,
      };
    });
    expect(geometry.body).toBeLessThanOrEqual(geometry.viewport + 1);
    expect(geometry.map.height).toBeGreaterThan(150);
    expect(geometry.log.bottom).toBeLessThanOrEqual(geometry.viewport);
    expect(geometry.roster).toBe(true);
  }
  await page.locator("#unitRoster").hover();
  await page.mouse.wheel(0, 800);
  await expect
    .poll(() => page.locator("#unitRoster").evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  await page.locator("#showChat").click();
  await expect(page.locator("#log")).toBeHidden();
  await expect(page.locator("#chatPanel")).toBeVisible();
  await expect(page.locator("#chatSend")).toBeDisabled();
  await page.locator("#showLog").click();
  await expect(page.locator("#log")).toBeVisible();
  await page.screenshot({ path: ".openai/desktop-scroll-console.png" });
});
test("player IDs persist and repeated room leave/connect cycles keep the endpoint parser callable", async ({
  page,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  try {
    await page.goto("http://127.0.0.1:" + address.port);
    await page.locator("#playerId").fill("Alice");
    let navigations = 0;
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) navigations++;
    });
    for (let i = 0; i < 3; i++) {
      await page.locator("#openSkirmish").click();
      await page.locator("#openRooms").click();
      await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
      await page.locator("#connectServer").click();
      await expect(page.locator("#lobby")).toBeVisible();
      await page.locator("#roomCode").fill("RETRY" + i);
      await page.locator("#createRoom").click();
      await expect(page.locator("#roomPreparation")).toBeVisible();
      await expect(page.locator("#teamSlots")).toContainText("Alice");
      expect(await page.evaluate(() => typeof Net.endpoint)).toBe("function");
      await page.locator("#roomMainMenu").click();
      await page.locator("#confirmLeave").click();
      await expect(page.locator("#start")).toBeVisible();
      await expect.poll(() => app.rooms.size).toBe(0);
    }
    expect(navigations).toBe(0);
    await page.reload();
    await expect(page.locator("#playerId")).toHaveValue("Alice");
  } finally {
    await page.close();
    await app.close();
  }
});
test("room chat survives view changes; finished clients reconnect and the host returns everyone for another match", async ({
  page,
  context,
}) => {
  test.setTimeout(45000);
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    red = await context.newPage(),
    watch = await context.newPage(),
    pages = [page, red, watch],
    errors = [];
  try {
    for (const client of pages) client.on("pageerror", (error) => errors.push(error.message));
    await connect(page, address, "Alice");
    await page.locator("#roomCode").fill("FLOW");
    await page.locator("#createRoom").click();
    await connect(red, address, "Bob");
    await join(red, "FLOW");
    await connect(watch, address, "Watcher");
    await join(watch, "FLOW");
    await expect.poll(() => page.evaluate(() => Net.snapshot.members.length)).toBe(3);
    const revision = await page.evaluate(() => Net.revision);
    await page.locator("#roomChatInput").fill("<b>Hello</b> 主菜单");
    await page.locator("#roomChatInput").press("Enter");
    for (const client of pages)
      await expect(client.locator("#roomChatLines")).toContainText("<b>Hello</b> 主菜单");
    expect(await page.locator("#roomChatLines b").count()).toBe(0);
    expect(await page.evaluate(() => Net.revision)).toBe(revision);
    await startMatch(page, red);
    for (const client of pages) await client.locator("#showChat").click();
    await watch.locator("#chatInput").fill("Watching");
    await watch.locator("#chatInput").press("Enter");
    await expect(page.locator("#chatLines")).toContainText("Watching");
    await watch.locator("#roomSettings").click();
    await expect(watch.locator("#roomChatLines")).toContainText("Watching");
    await watch.locator("#roomMainMenu").click();
    await expect(watch.locator("#chatLines")).toContainText("Watching");
    await finishMatch(app, "FLOW", pages);
    const matchId = app.rooms.get("FLOW").matchId,
      returnAt = app.rooms.get("FLOW").returnAt;
    await expect(page.locator("#playAgain")).toBeEnabled();
    await expect(red.locator("#playAgain")).toBeDisabled();
    await expect(page.locator("#victoryCountdown")).toContainText("秒后所有人返回房间");
    await red.evaluate(() => Net.socket.close());
    await expect.poll(() => page.evaluate(() => Net.snapshot.connected[1])).toBe(false);
    await expect
      .poll(
        () => red.evaluate(() => Net.socket?.readyState === WebSocket.OPEN && !Net.connecting),
        { timeout: 7000 },
      )
      .toBe(true);
    await expect.poll(() => page.evaluate(() => Net.snapshot.connected[1])).toBe(true);
    expect(app.rooms.get("FLOW").returnAt).toBe(returnAt);
    expect(await red.evaluate(() => typeof Net.endpoint)).toBe("function");
    await page.evaluate(() => openMenu());
    await expect.poll(() => red.evaluate(() => Net.snapshot.hostId === Net.memberId)).toBe(true);
    await expect(red.locator("#playAgain")).toBeEnabled();
    await red.locator("#playAgain").click();
    for (const client of [red, watch]) {
      await expect(client.locator("#roomPreparation")).toBeVisible();
      await expect(client.locator("#victory")).toBeHidden();
    }
    await connect(page, address, "Alice");
    await join(page, "FLOW");
    await expect(page.locator("#roomPreparation")).toBeVisible({ timeout: 7000 });
    expect(app.rooms.get("FLOW").started).toBe(false);
    await expect(page.locator("#roomChatLines")).toContainText("Watching");
    await startMatch(page, red);
    expect(app.rooms.get("FLOW").matchId).not.toBe(matchId);
    expect(errors).toEqual([]);
  } finally {
    for (const client of pages) await client.close();
    await app.close();
  }
});
test("the server countdown returns every client without a return request", async ({
  page,
  context,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0, resultReturnMs: 1400 }),
    address = await app.listen(),
    red = await context.newPage();
  try {
    await connect(page, address, "Alice");
    await page.locator("#roomCode").fill("AUTO");
    await page.locator("#createRoom").click();
    await connect(red, address, "Bob");
    await join(red, "AUTO");
    await startMatch(page, red);
    await finishMatch(app, "AUTO", [page, red], true);
    for (const client of [page, red]) {
      await expect(client.locator("#roomPreparation")).toBeVisible({ timeout: 5000 });
      expect(await client.evaluate(() => [Net.snapshot.started, Net.snapshot.returnAt])).toEqual([
        false,
        null,
      ]);
      expect(await client.evaluate(() => animationFrameId)).toBe(null);
    }
    expect(app.rooms.get("AUTO").phase).toBe("waiting");
  } finally {
    await page.close();
    await red.close();
    await app.close();
  }
});

test("the host seat panel returns every player and spectator to the same room during combat", async ({
  page,
  context,
}) => {
  test.setTimeout(60000);
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    guest = await context.newPage(),
    spectator = await context.newPage(),
    pages = [page, guest, spectator];
  try {
    await connect(page, address, "Host");
    await page.locator("#roomCode").fill("BACKROOM");
    await page.locator("#createRoom").click();
    await expect(page.locator("#returnAllToRoom")).toBeHidden();
    await connect(guest, address, "Guest");
    await join(guest, "BACKROOM");
    await connect(spectator, address, "Watcher");
    await join(spectator, "BACKROOM");
    await startMatch(page, guest);
    for (const client of pages) await client.locator("#roomSettings").click();
    await expect(guest.locator("#returnAllToRoom")).toBeHidden();
    await expect(spectator.locator("#returnAllToRoom")).toBeHidden();
    await expect(page.locator("#returnAllToRoom")).toBeEnabled();
    expect(await page.locator("#becomeSpectator").evaluate((el) => el.nextElementSibling.id)).toBe(
      "returnAllToRoom",
    );
    await page.locator("#returnAllToRoom").click();
    for (const client of pages) {
      await expect(client.locator("#roomPreparation")).toBeVisible();
      await expect(client.locator("#toggleReady")).toBeVisible({ visible: client !== spectator });
      await expect(client.locator("#gameScene")).toBeHidden();
      await expect(client.locator("#returnAllToRoom")).toBeHidden();
      expect(await client.evaluate(() => [Net.snapshot.started, phase, animationFrameId])).toEqual([
        false,
        "waiting",
        null,
      ]);
    }
    await startMatch(page, guest);
    // Ownership, rather than team seat, controls the button even after switching to watch.
    await page.locator("#roomSettings").click();
    await page.locator("#becomeSpectator").click();
    await expect(page.locator("#becomeSpectator")).toBeDisabled();
    await expect(page.locator("#returnAllToRoom")).toBeEnabled();
    await page.locator("#returnAllToRoom").click();
    await expect(guest.locator("#roomPreparation")).toBeVisible();
    expect(app.rooms.get("BACKROOM").started).toBe(false);
  } finally {
    for (const client of pages) await client.close();
    await app.close();
  }
});
