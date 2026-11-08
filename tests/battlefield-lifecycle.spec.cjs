const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 390])
  test(
    "battlefield reserve stock, grey ruins and repeated loss results / " + width,
    async ({ page }) => {
      test.setTimeout(60000);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      await page.setViewportSize({ width, height: width === 390 ? 844 : 950 });
      await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
      await expect(page.locator("#openSkirmish")).toBeEnabled();
      await page.evaluate(() => {
        const factory = createRoomEngine;
        createRoomEngine = (options) =>
          (window.lifecycleEngine = factory({ ...options, aiDelayMs: 999999 }));
      });
      await page.locator("#openSkirmish").click();
      await page.locator("#offlineRoomMode").selectOption("battlefield");
      await page.locator("#createOfflineRoom").click();
      await page.evaluate(() => {
        const engine = lifecycleEngine,
          room = [...engine.rooms.values()][0],
          ws = room.seats.find((p) => p && !p.bot).ws;
        let n = 0;
        const act = (action, fields = {}) =>
          engine.action(ws, {
            id: "ui-life-" + ++n,
            revision: room.revision,
            round: room.game.round,
            matchId: room.matchId,
            phase: room.phase,
            action,
            ...fields,
          });
        act("start_game", { formation: [{ unitId: "Type61", kitId: "standard" }] });
        act("confirm_formation");
        act("confirm_deployment");
      });
      await expect.poll(() => page.evaluate(() => Net.snapshot.phase)).toBe("idle");
      await page.waitForFunction(() => !!game.battlefield && pageView === "game");
      await page.evaluate(() => {
        const room = [...lifecycleEngine.rooms.values()][0],
          seat = Net.seat;
        room.game.fogMode = "disabled";
        room.seats[seat].inventory.Type61 = 1;
        room.game.units.find((u) => Rules.ownerOf(u) === seat).hp = 0;
        room.game.units.find((u) => u.team === 1 && u.facility?.type === "machineGun").hp = 0;
        window.greyRuinDrawn = 0;
        const draw = SpriteRenderer.draw;
        SpriteRenderer.draw = (...args) => {
          if (args[0].filter.includes("grayscale")) greyRuinDrawn++;
          return draw(...args);
        };
        lifecycleEngine.broadcast(room);
      });
      await expect
        .poll(() => page.evaluate(() => game.battlefield?.reserves?.[0]?.stockRemaining))
        .toBe(0);
      await expect.poll(() => page.evaluate(() => greyRuinDrawn)).toBeGreaterThan(0);
      await page.evaluate(() => {
        const base = game.units.find((u) => u.team === Net.team() && u.facility?.type === "base");
        BattlefieldUI.click({ x: base.x, y: base.y });
      });
      const dialog = page.locator("#battlefieldDeploymentDialog");
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("剩余库存 0");
      await expect(dialog.getByRole("button", { name: "暂无库存", exact: true })).toBeDisabled();
      await page.screenshot({
        path: "tmp/verification/screenshots/v105-reserve-" + width + ".png",
      });
      await dialog.getByRole("button", { name: "关闭", exact: true }).click();
      await page.evaluate(() => {
        const room = [...lifecycleEngine.rooms.values()][0];
        room.game.units.find((u) => u.team === 1 && u.facility?.type === "base").hp = 0;
        lifecycleEngine.broadcast(room);
      });
      await expect(page.locator("#victoryUnitIcons")).toBeVisible();
      await expect(
        page.locator("#victoryUnitIcons").getByRole("heading", { name: "损失单位", exact: true }),
      ).toBeVisible();
      expect(await page.locator("#victoryUnitIcons section").first().locator("img").count()).toBe(
        1,
      );
      expect(errors).toEqual([]);
    },
  );
