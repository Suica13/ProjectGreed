const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(`top navigation and nested pages at ${width}px`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await expect(page.locator("#menuShell")).toBeVisible();
    expect(await page.locator(".shell-primary button span").allTextContents()).toEqual([
      "大厅",
      "机库",
      "任务",
      "回放",
    ]);
    await expect(page.locator("#shellMissions")).toBeDisabled();
    const account = await page.evaluate(() => ({
      wallet: document.getElementById("menuResources").getBoundingClientRect().toJSON(),
      player: document.getElementById("playerId").getBoundingClientRect().toJSON(),
      settings: document.getElementById("shellSettings").getBoundingClientRect().toJSON(),
    }));
    expect(account.wallet.right).toBeLessThanOrEqual(account.player.left);
    expect(account.player.right).toBeLessThanOrEqual(account.settings.left);
    expect(
      Math.abs(
        account.wallet.y + account.wallet.height / 2 - account.player.y - account.player.height / 2,
      ),
    ).toBeLessThan(1);
    await page.locator("#shellHangar").click();
    await expect(page.locator("#formationScreen")).toBeVisible();
    expect(await page.locator("#shellSubnav button").allTextContents()).toEqual([
      "编组",
      "驾驶员",
      "生产",
      "开发",
    ]);
    await expect(page.locator("#formationResources")).toBeHidden();
    await page.getByRole("button", { name: "驾驶员", exact: true }).click();
    await expect(page.locator("#formationMain")).toHaveAttribute("data-page", "pilots");
    await expect(page.locator("#formationPageTitle")).toHaveText("驾驶员");
    await page.getByRole("button", { name: "生产", exact: true }).click();
    await expect(page.locator("#productionScreen")).toBeVisible();
    await expect(page.locator("#productionResources")).toBeHidden();
    await expect(page.locator("#productionPrice")).toBeVisible();
    const geometry = await page.evaluate(() => ({
      header: document.getElementById("menuShell").getBoundingClientRect().bottom,
      content: document.getElementById("productionScreen").getBoundingClientRect().top,
      width: document.documentElement.scrollWidth,
      rail: document.getElementById("shellSidebar").getBoundingClientRect().toJSON(),
      contentLeft: document.getElementById("productionScreen").getBoundingClientRect().left,
      tabs: [...document.querySelectorAll("#shellSubnav button")].map((e) =>
        e.getBoundingClientRect().toJSON(),
      ),
      browser: document.querySelector(".production-browser").getBoundingClientRect().toJSON(),
      details: document.querySelector(".production-details").getBoundingClientRect().toJSON(),
    }));
    expect(geometry.content).toBeGreaterThanOrEqual(geometry.header - 1);
    expect(geometry.width).toBeLessThanOrEqual(width);
    if (width <= 720) {
      expect(geometry.contentLeft).toBe(0);
      expect(geometry.content).toBeGreaterThanOrEqual(geometry.rail.bottom - 1);
      expect(geometry.tabs[1].left).toBeGreaterThanOrEqual(geometry.tabs[0].right);
      expect(geometry.tabs[2].left).toBeGreaterThanOrEqual(geometry.tabs[1].right);
    } else {
      expect(geometry.contentLeft).toBeGreaterThanOrEqual(geometry.rail.right);
      expect(geometry.tabs[1].top).toBeGreaterThanOrEqual(geometry.tabs[0].bottom);
      expect(geometry.tabs[2].top).toBeGreaterThanOrEqual(geometry.tabs[1].bottom);
    }
    if (width < 720) expect(geometry.details.top).toBeGreaterThanOrEqual(geometry.browser.bottom);
    await page.locator("#shellDevelopment").click();
    await expect(page.locator("#developmentScreen")).toBeVisible();
    await expect(page.locator("#developmentResources")).toBeHidden();
    await expect(page.locator("#developmentPoints")).toBeVisible();
    await expect(page.locator("#shellHangar")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#shellDevelopment")).toHaveAttribute("aria-pressed", "true");
    await page.locator("#shellRecords").click();
    await expect(page.locator("#shellRecordsScreen")).toBeVisible();
    await expect(page.locator("#shellSubnav button")).toHaveCount(1);
    await expect(page.locator("#shellSubnav button")).toHaveText("回放文件");
    await expect(page.locator("#shellOpenRecords")).toBeVisible();
    await page.locator("#shellOpenRecords").click();
    await expect(page.locator("#matchRecordsDialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#shellOpenReplay")).toBeVisible();
    await page.locator("#shellSettings").click();
    await expect(page.locator("#clientSettingsDialog")).toBeVisible();
    await page.locator("#closeClientSettings").click();
    await page.locator("#shellLobby").click();
    await expect(page.locator("#start")).toBeVisible();
    await page.evaluate(() => I18n.setLanguage("en"));
    await expect(page.locator("#shellHangar span")).toHaveText("Hangar");
    expect(errors).toEqual([]);
  });

test("room membership survives every pre-battle page, assembly snapshots and deployment enters unchanged battle HUD", async ({
  page,
  browser,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    base = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext(),
    guest = await context.newPage(),
    errors = [];
  const idle = (p) => p.waitForFunction(() => Net.active && Net.snapshot && !Net.awaiting);
  const act = async (p, action, fields = {}) => {
    await idle(p);
    await p.evaluate(({ action, fields }) => Net.request(action, fields), { action, fields });
    await idle(p);
  };
  try {
    for (const p of [page, guest]) {
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base);
      await p.waitForFunction(() => assetsReady);
      await p.evaluate(() => I18n.setLanguage("zh"));
      await p.evaluate((base) => Lobby.reconnect(base), base);
      await expect(p.locator("#lobby")).toBeVisible();
    }
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("SHELLROOM");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await idle(page);
    await guest.locator("#refreshRooms").click();
    await guest.locator(".room-card").filter({ hasText: "SHELLROOM" }).getByRole("button").click();
    await idle(guest);
    const before = await page.evaluate(() => ({
      member: Net.memberId,
      seat: Net.seat,
      room: Net.room,
    }));
    for (const [button, view] of [
      ["shellHangar", "formation"],
      ["shellDevelopment", "development"],
      ["shellRecords", "records"],
    ]) {
      await page.locator("#" + button).click();
      await act(guest, "sync");
      await act(page, "sync");
      expect(await page.evaluate(() => pageView)).toBe(view);
      expect(
        await page.evaluate(() => ({ member: Net.memberId, seat: Net.seat, room: Net.room })),
      ).toEqual(before);
    }
    await page.locator("#shellHangar").click();
    await page.locator("#formationName").fill("NAV SAVED");
    await page.getByRole("button", { name: "生产", exact: true }).click();
    await act(page, "sync");
    expect(await page.evaluate(() => pageView)).toBe("production");
    await page.locator("#shellHangar").click();
    await expect(page.locator("#formationName")).toHaveValue("NAV SAVED");
    await page.locator("#shellDevelopment").click();
    const formation = [{ unitId: "Type61", kitId: "standard" }];
    await act(page, "set_ready", { ready: true, formation });
    await act(guest, "set_ready", { ready: true, formation });
    await act(page, "start_game", { formation });
    await page.waitForFunction(() => Net.snapshot.phase === "assembly");
    expect(await page.evaluate(() => pageView)).toBe("development");
    await expect(page.locator("#shellRoomStatus")).toContainText("最终编组");
    await page.locator("#shellRoomStatus").click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await act(page, "confirm_formation");
    await act(guest, "confirm_formation");
    await expect(page.locator("#gameScene")).toBeVisible();
    await expect(page.locator("#menuShell")).toBeHidden();
    await expect(page.locator("#openClientSettings")).toBeVisible();
    expect(await page.evaluate(() => document.body.classList.contains("menu-shell-active"))).toBe(
      false,
    );
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await page.close();
    await app.close();
  }
});

test("offline room stays active across pages until explicit leave", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.waitForFunction(() => Net.local && Net.active && Net.snapshot);
  const member = await page.evaluate(() => Net.memberId);
  await page.locator("#shellHangar").click();
  await page.locator("#shellProduction").click();
  await page.locator("#shellDevelopment").click();
  expect(await page.evaluate(() => Net.local && Net.active && Net.memberId)).toBe(member);
  await page.locator("#shellLobby").click();
  await expect(page.locator("#roomPreparation")).toBeVisible();
  await page.getByRole("button", { name: "作战大厅", exact: true }).click();
  await expect(page.locator("#openSkirmish")).toHaveText("返回房间");
  await page.locator("#openSkirmish").click();
  await expect(page.locator("#roomPreparation")).toBeVisible();
  expect(await page.evaluate(() => Net.memberId)).toBe(member);
  await page.locator("#shellLeaveRoom").click();
  await expect(page.locator("#leaveConfirm")).toBeVisible();
  await page.locator("#cancelLeave").click();
  expect(await page.evaluate(() => Net.active)).toBe(true);
  await page.locator("#shellLeaveRoom").click();
  await page.locator("#confirmLeave").click();
  expect(await page.evaluate(() => Net.active)).toBe(false);
  await expect(page.locator("#menuFactionSelect")).toBeEnabled();
});

for (const viewport of [
  { width: 1440, height: 960 },
  { width: 390, height: 844 },
  { width: 844, height: 390 },
])
  test(`pages stay within viewport and long room lists scroll at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    const app = createServer({ host: "127.0.0.1", port: 0 }),
      address = await app.listen(),
      base = `http://127.0.0.1:${address.port}`;
    let headingReference = null;
    const bounded = async () => {
      const box = await page.evaluate(() => {
        const e = [...document.querySelectorAll("body > .menu-screen")].find((e) => !e.hidden);
        const r = e.getBoundingClientRect();
        const heading = e.querySelector(".shell-page-heading"),
          title = heading.querySelector(".shell-page-title"),
          t = title.getBoundingClientRect();
        return {
          top: r.top,
          bottom: r.bottom,
          height: r.height,
          documentHeight: document.documentElement.scrollHeight,
          documentWidth: document.documentElement.scrollWidth,
          heading: {
            x: t.x,
            y: t.y,
            font: getComputedStyle(title).fontSize,
            height: heading.getBoundingClientRect().height,
          },
        };
      });
      if (!headingReference) headingReference = box.heading;
      else {
        expect(Math.abs(box.heading.x - headingReference.x)).toBeLessThan(1);
        expect(Math.abs(box.heading.y - headingReference.y)).toBeLessThan(1);
        expect(box.heading.font).toBe(headingReference.font);
        expect(box.heading.height).toBe(headingReference.height);
      }
      expect(box.bottom).toBeLessThanOrEqual(viewport.height + 1);
      expect(box.documentHeight).toBeLessThanOrEqual(viewport.height + 1);
      expect(box.documentWidth).toBeLessThanOrEqual(viewport.width);
    };
    try {
      await page.setViewportSize(viewport);
      await page.goto(base);
      await page.waitForFunction(() => assetsReady);
      await page.evaluate(() => I18n.setLanguage("zh"));
      await bounded();
      await page.locator("#shellHangar").click();
      await bounded();
      await page.locator("#shellProduction").click();
      await bounded();
      await page.locator("#shellDevelopment").click();
      await bounded();
      await page.locator("#shellRecords").click();
      await bounded();
      await page.locator("#shellLobby").click();
      await page.evaluate((base) => Lobby.reconnect(base), base);
      await expect(page.locator("#lobby")).toBeVisible();
      await expect(page.locator("#start .start-layout")).toBeHidden();
      await page.evaluate(() =>
        Lobby.render(
          Array.from({ length: 100 }, (_, i) => ({
            code: "SCROLL" + i,
            mode: "regular",
            phase: "waiting",
            players: 1,
            capacity: 2,
            joinable: true,
          })),
        ),
      );
      const list = page.locator("#lobby .room-list-scroll");
      const scroll = await list.evaluate((e) => ({
        height: e.clientHeight,
        scroll: e.scrollHeight,
      }));
      expect(scroll.height).toBeGreaterThan(0);
      expect(scroll.scroll).toBeGreaterThan(scroll.height);
      await list.evaluate((e) => {
        e.scrollTop = e.scrollHeight;
      });
      expect(await list.evaluate((e) => e.scrollTop)).toBeGreaterThan(0);
      await bounded();
      await page.locator("#disconnectLobby").scrollIntoViewIfNeeded();
      await expect(page.locator("#disconnectLobby")).toBeInViewport();
      await page.locator("#disconnectLobby").click();
      await expect(page.locator("#openSkirmish")).toBeVisible();
    } finally {
      await app.close();
    }
  });
