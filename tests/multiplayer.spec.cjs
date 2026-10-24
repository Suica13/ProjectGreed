const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server.js");
async function connect(page, address, name) {
  await page.goto("http://127.0.0.1:" + address.port);
  await page.locator("#playerId").fill(name);
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
  await page.locator("#connectServer").click();
  await expect(page.locator("#lobby")).toBeVisible();
}
async function joined(page, room) {
  await expect(page.locator("#roomPreparation")).toBeVisible();
  await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
}
async function createRoom(pages, address, id, cost) {
  await connect(pages[0], address, "Host");
  await pages[0].locator("#roomCode").fill("BROWSER");
  await pages[0].locator("#createRoom").click();
  await joined(pages[0]);
  await pages[0].locator("#roomMapSelect").selectOption(id);
  await pages[0].locator("#roomCostLimit").fill(String(cost));
  await waitForRoomSettings(pages[0]);
  await expect.poll(() => pages[0].evaluate(() => Net.snapshot?.settings?.mapId)).toBe(id);
  for (let i = 1; i < pages.length; i++) {
    await connect(pages[i], address, "Player" + i);
    await pages[i].locator(".room-card").filter({ hasText: "BROWSER" }).getByRole("button").click();
    await joined(pages[i]);
  }
}
async function prepare(pages) {
  for (const page of pages) {
    await page.locator("#toggleReady").click();
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  }
  for (const page of pages) {
    await page.locator("#confirmFinalFormation").click();
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  }
  for (const page of pages) {
    await expect(page.locator("#deploymentPanel")).toBeVisible();
    await page.locator("#confirmDeployment").click();
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBe(null);
  }
  for (const page of pages) await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
}
test("four players choose spawn seats, room budget gates readiness, names and chat use role colors, and turns are shared", async ({
  context,
}) => {
  test.setTimeout(90000);
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const pages = await Promise.all(Array.from({ length: 4 }, () => context.newPage())),
    errors = [];
  try {
    for (const p of pages) p.on("pageerror", (e) => errors.push(e.message));
    await createRoom(pages, address, "crossroads_2v2", 600);
    const [host, guest, ally] = pages;
    await expect(guest.locator("#roomMapSelect")).toBeDisabled();
    await expect(guest.locator("#roomCostLimit")).toBeDisabled();
    await expect(host.locator("#toggleReady")).toBeEnabled();
    await expect(host.locator("#roomFormationWarning")).toContainText("COST");
    await expect(ally.locator("#chooseSeat3")).toBeDisabled();
    await ally.locator("#becomeSpectator").click();
    await joined(ally);
    await expect(ally.locator("#chooseSeat2")).toBeEnabled();
    await ally.locator("#chooseSeat2").click();
    await joined(ally);
    expect(await ally.evaluate(() => Net.seat)).toBe(2);
    const name = (page, seat) =>
      page.locator('.spawn-slot[data-seat="' + seat + '"] .lineup-name > strong');
    await expect(name(guest, 0)).toHaveCSS("color", "rgb(240, 206, 103)");
    await expect(name(guest, 1)).toHaveCSS("color", "rgb(101, 207, 255)");
    await expect(name(guest, 2)).toHaveCSS("color", "rgb(244, 245, 247)");
    await guest.locator("#roomChatInput").fill("Room chat is visible");
    await guest.locator("#roomChatSend").click();
    for (const p of pages)
      await expect(p.locator("#roomChatLines")).toContainText("Room chat is visible");
    await expect(guest.locator("#roomChatLines strong")).toHaveCSS("color", "rgb(101, 207, 255)");
    await host.screenshot({ path: ".openai/multiplayer-room.png" });
    for (const p of pages) {
      await p.locator("#roomFormation").click();
      while ((await p.locator(".formation-row").count()) > 1)
        await p
          .locator(".formation-row")
          .last()
          .getByRole("button", { name: "移除", exact: true })
          .click();
      await p.locator("#saveFormation").click();
      await expect(p.locator("#toggleReady")).toBeEnabled();
    }
    await prepare(pages);
    expect(await ally.evaluate(() => Net.team())).toBe(0);
    expect(await ally.evaluate(() => Net.canAct())).toBe(true);
    await ally.locator('.roster-unit[data-unit-id="2-0"]').click();
    await ally.getByRole("button", { name: "待机", exact: true }).click();
    await expect.poll(() => ally.evaluate(() => Net.awaiting)).toBe(null);
    await ally.locator("#endTurn").click();
    await expect.poll(() => ally.evaluate(() => Net.snapshot.turnDone[2])).toBe(true);
    expect(await ally.evaluate(() => game.team)).toBe(0);
    expect(await ally.evaluate(() => Net.canAct())).toBe(false);
    await host.locator("#endTurn").click();
    await host.locator("#endTurn").click();
    for (const p of pages) await expect.poll(() => p.evaluate(() => game.team)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    for (const p of pages) await p.close();
    await app.close();
  }
});
test("six browser players deploy on the large map, only the unit owner responds, all viewers finish and the sixth seat reconnects", async ({
  context,
}) => {
  test.setTimeout(90000);
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const pages = await Promise.all(Array.from({ length: 6 }, () => context.newPage())),
    errors = [];
  try {
    for (const p of pages) p.on("pageerror", (e) => errors.push(e.message));
    await createRoom(pages, address, "frontline_3v3", 3600);
    await prepare(pages);
    expect(
      await pages[4].evaluate(() => [Net.team(), Net.canAct(), Rules.mapHeight(game)]),
    ).toEqual([0, true, 34]);
    const room = app.rooms.get("BROWSER"),
      g = room.game;
    for (const u of g.units) {
      u.hp = 100000;
      u.shield = 0;
    }
    Object.assign(
      g.units.find((u) => u.id === "4-0"),
      { x: 2, y: 4, acted: false, en: 100 },
    );
    Object.assign(
      g.units.find((u) => u.id === "5-0"),
      { x: 4, y: 4 },
    );
    g.tiles[4][2] = g.tiles[4][4] = "plain";
    g.seed = 1;
    await pages[4].evaluate(() =>
      Net.request("attack", { unitId: "4-0", targetId: "5-0", weaponId: "EF_BeamSprayGun" }),
    );
    await expect(pages[5].locator("#reaction")).toBeVisible();
    await expect(pages[1].locator("#reaction")).toBeHidden();
    await expect(pages[3].locator("#reaction")).toBeHidden();
    await pages[5].locator("#responseEvade").click();
    await pages[5].locator("#confirmResponse").click();
    for (const p of pages) {
      await expect(p.locator("#battle")).toBeVisible();
      await p.locator("#skipBattle").click();
      await p.locator("#continueBattle").click();
    }
    for (const p of pages) await expect.poll(() => p.evaluate(() => phase)).toBe("idle");
    const id = await pages[5].evaluate(() => Net.memberId);
    await pages[5].evaluate(() => Net.socket.close());
    await expect.poll(() => pages[0].evaluate(() => Net.snapshot.connected[5])).toBe(false);
    await expect
      .poll(
        () =>
          pages[5].evaluate(
            () =>
              Net.socket?.readyState === WebSocket.OPEN && Net.snapshot?.connected.every(Boolean),
          ),
        { timeout: 10000 },
      )
      .toBe(true);
    expect(await pages[5].evaluate(() => [Net.seat, Net.memberId])).toEqual([5, id]);
    expect(errors).toEqual([]);
  } finally {
    for (const p of pages) await p.close();
    await app.close();
  }
});

test("room controls and chat stay inside the desktop viewport and the compact layout remains scrollable", async ({
  page,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  try {
    await createRoom([page], address, "frontline_3v3", 3600);
    for (const [width, height] of [
      [1366, 768],
      [1600, 1000],
      [390, 844],
    ]) {
      await page.setViewportSize({ width, height });
      const layout = await page.evaluate(() => {
        const rect = (id) => {
          const r = byId(id).getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
        };
        return {
          bodyWidth: document.documentElement.scrollWidth,
          bodyHeight: document.documentElement.scrollHeight,
          viewportWidth: innerWidth,
          viewportHeight: innerHeight,
          actions: rect("roomActions"),
          chat: rect("roomChatInput"),
          dialog: document.querySelector(".room-preparation").getBoundingClientRect().bottom,
        };
      });
      expect(layout.bodyWidth).toBeLessThanOrEqual(width);
      expect(layout.bodyHeight).toBeLessThanOrEqual(height + 1);
      if (width > 700) {
        expect(layout.actions.bottom).toBeLessThanOrEqual(height);
        expect(layout.chat.bottom).toBeLessThanOrEqual(height);
      }
      expect(layout.dialog).toBeLessThanOrEqual(height);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.screenshot({ path: ".openai/multiplayer-room-final.png" });
    await page.evaluate(() => I18n.setLanguage("en"));
    await expect(page.locator("#roomSettingsHint")).toContainText("automatically");
    await expect(page.locator("#roomMapSelect")).toContainText("Deep Front");
    await page.evaluate(() => I18n.setLanguage("ja"));
    await expect(page.locator("#roomSettingsHint")).toContainText("自動");
    await expect(page.locator("#roomMapSelect")).toContainText("縦深戦場");
  } finally {
    await page.close();
    await app.close();
  }
});
