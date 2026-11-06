const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server.js");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
let app, address;
test.beforeAll(async () => {
  app = createServer({ host: "127.0.0.1", port: 0 });
  address = await app.listen();
});
test.afterAll(async () => {
  await app.close();
});
async function lobby(page) {
  await page.addInitScript(() => localStorage.setItem("projectgreed.combatFaction", "PMC"));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => I18n.setLanguage("zh"));
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
  await page.locator("#connectServer").click();
  await expect(page.locator("#lobby")).toBeVisible();
}
for (const width of [1280, 390])
  test(`independent room creation, password lock and join at ${width}px`, async ({ browser }) => {
    test.setTimeout(60000);
    const hostContext = await browser.newContext({ viewport: { width, height: 844 } }),
      guestContext = await browser.newContext({ viewport: { width, height: 844 } });
    const host = await hostContext.newPage(),
      guest = await guestContext.newPage(),
      errors = [];
    for (const page of [host, guest]) page.on("pageerror", (error) => errors.push(error.message));
    host.setDefaultTimeout(8000);
    guest.setDefaultTimeout(8000);
    const code = "LOCKUI" + width;
    try {
      await lobby(host);
      await expect(host.locator("#lobbyFormation")).toHaveCount(0);
      await expect(host.locator("#lobby")).not.toContainText("暂无房间，可以创建一个。");
      await expect(host.locator("#lobby")).not.toContainText("两队准备后开始；游戏中可加入观战");
      await host.locator("#createRoom").click();
      await expect(host.locator("#roomCreateDialog")).toBeVisible();
      expect(app.rooms.size).toBe(0);
      await host.locator("#cancelRoomCreate").click();
      expect(app.rooms.size).toBe(0);
      await host.locator("#createRoom").click();
      await host.locator("#roomCode").fill(code);
      await host.locator("#newRoomMode").selectOption("quick");
      await host.locator("#newRoomLocked").check();
      await expect(host.locator("#newRoomPassword")).toBeVisible();
      await host.locator("#newRoomPassword").fill("ui-secret");
      const box = await host.locator("#roomCreateDialog").boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      await host.locator('#roomCreateForm button[type="submit"]').click();
      await expect(host.locator("#roomPreparation")).toBeVisible();
      await expect(host.locator("#roomFormationPreset")).toHaveValue("2000,250,36");
      expect(
        await host
          .locator("#roomFormationPreset option")
          .evaluateAll((options) => options.map((o) => o.value)),
      ).toEqual([
        "2000,250,36",
        "2000,400,36",
        "4000,800,36",
        "6000,1200,36",
        "8000,1600,36",
        "10000,2000,36",
        "custom",
      ]);
      if (width < 700) await host.locator('[data-room-tab="settings"]').click();
      await host.locator("#roomFormationPreset").selectOption("10000,2000,36");
      await expect.poll(() => app.rooms.get(code).settings.costLimit).toBe(10000);
      expect(app.rooms.get(code).settings.unitCostLimit).toBe(2000);
      expect(app.rooms.get(code).settings.unitLimit).toBe(36);
      await expect(host.locator("#roomTeamRestrictions").locator("..")).toBeVisible();
      await host.locator("#roomBattleMode").selectOption("regular");
      await expect.poll(() => app.rooms.get(code).settings.mode).toBe("regular");
      await expect(host.locator("#roomTeamRestrictions").locator("..")).toBeHidden();
      await host.locator("#roomBattleMode").selectOption("quick");
      await expect.poll(() => app.rooms.get(code).settings.mode).toBe("quick");
      await expect(host.locator("#roomTeamRestrictions").locator("..")).toBeVisible();
      await host.locator("#roomFogMode").selectOption("visible");
      await expect.poll(() => app.rooms.get(code).settings.fogMode).toBe("visible");
      await host.locator("#roomPresetName").fill("我的规则");
      await expect(host.locator("#saveRoomPreset")).toBeEnabled();
      await host.locator("#saveRoomPreset").click();
      const savedId = await host.locator("#roomFormationPreset").inputValue();
      expect(savedId).toMatch(/^saved-/);
      await host.locator("#roomFormationPreset").selectOption("2000,250,36");
      await expect.poll(() => app.rooms.get(code).settings.costLimit).toBe(2000);
      await host.locator("#roomFogMode").selectOption("disabled");
      await expect.poll(() => app.rooms.get(code).settings.fogMode).toBe("disabled");
      await host.locator("#roomFormationPreset").selectOption(savedId);
      await expect.poll(() => app.rooms.get(code).settings.costLimit).toBe(10000);
      await expect.poll(() => app.rooms.get(code).settings.fogMode).toBe("visible");
      await host.reload();
      await host.waitForFunction(() => assetsReady);
      await expect(host.locator("#roomPreparation")).toBeVisible();
      if (width < 700) await host.locator('[data-room-tab="settings"]').click();
      await expect(host.locator("#roomFormationPreset")).toHaveValue(savedId);
      await host.locator("#deleteRoomPreset").click();
      expect(await host.evaluate(() => JSON.parse(localStorage.getItem("projectgreed.room-rule-presets.v1")))).toEqual([]);
      await expect(host.locator("#deleteRoomPreset")).toBeDisabled();
      if (width < 700) {
        await host.locator("#closeRoomSettingsSheet").click();
        await host.locator('[data-room-tab="seats"]').click();
      }
      expect(app.rooms.get(code).settings.mode).toBe("quick");
      await guestContext.grantPermissions([]);
      await lobby(guest);
      const row = guest.locator(".room-card").filter({ hasText: code });
      await expect(row.locator(".room-lock-icon")).toBeVisible();
      await row.getByRole("button", { name: "加入", exact: true }).click();
      await expect(guest.locator("#joinLockedRoomDialog")).toBeVisible();
      await guest.locator("#joinRoomPassword").fill("wrong");
      await guest.locator('#joinLockedRoomForm button[type="submit"]').click();
      await expect(guest.locator("#lobby")).toBeVisible();
      expect(app.rooms.get(code).members.size).toBe(1);
      await guest
        .locator(".room-card")
        .filter({ hasText: code })
        .getByRole("button", { name: "加入", exact: true })
        .click();
      await guest.locator("#joinRoomPassword").fill("ui-secret");
      await guest.locator('#joinLockedRoomForm button[type="submit"]').click();
      await expect(guest.locator("#roomPreparation")).toBeVisible();
      expect(app.rooms.get(code).members.size).toBe(2);
      if (width < 700) await guest.locator('[data-room-tab="settings"]').click();
      await expect(guest.locator("#saveRoomPreset")).toBeDisabled();
      await expect(guest.locator("#roomFormationPreset")).toBeDisabled();
      await guest.reload();
      await guest.waitForFunction(() => assetsReady);
      await expect(guest.locator("#roomPreparation")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      for (const page of [host, guest])
        if (!page.isClosed()) await page.evaluate(() => Net.leave()).catch(() => {});
      await Promise.all([hostContext.close(), guestContext.close()]);
      await expect.poll(() => app.rooms.size).toBe(0);
    }
  });
