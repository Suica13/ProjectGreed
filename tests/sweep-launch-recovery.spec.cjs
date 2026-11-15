const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1440, 1024, 390])
  test(`sweep return controls and consecutive deployment recover at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => {
      const factory = createRoomEngine;
      createRoomEngine = (options) =>
        (window.sweepLaunchEngine = factory({ ...options, aiDelayMs: 999999 }));
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await page.locator("#offlineRoomMode").selectOption("sweep");
    await page.locator("#confirmOfflineMode").click();
    await page.evaluate(() =>
      Net.request("start_game", { formation: [{ unitId: "Medea", kitId: "standard" }] }),
    );
    await page.locator("#confirmFinalFormation").click();
    for (let node = 0; node < 3; node++) {
      await expect(page.locator("#sweepMission")).toBeVisible();
      await page.evaluate(() => {
        const room = Array.from(sweepLaunchEngine.rooms.values())[0];
        const id = Net.snapshot.sweep.reachable[0];
        room.sweep.nodes.find((n) => n.id === id).type = "battle";
        Net.request("sweep_select", { nodeId: id });
      });
      await expect(page.locator("#sweepConfirm")).toBeEnabled();
      await expect(page.locator("#hudUnitCommands")).toBeHidden();
      await expect(page.locator("#hudActionBand")).toBeHidden();
      await page.locator("#sweepConfirm").click();
      await expect(page.locator("#deploymentRoster")).toBeVisible();
      await page.waitForFunction(() => !Net.awaiting);
      await page.evaluate(() => Net.request("confirm_deployment"));
      await page.waitForFunction(() => phase === "idle" && !Net.awaiting);
      await page.evaluate(() => {
        const room = Array.from(sweepLaunchEngine.rooms.values())[0];
        selected = game.units.find((u) => u.team === 0).id;
        mode = "select";
        BattleHUD.refresh();
        // Simulate the final result arriving while the previous local animation
        // still has a network battle selected.
        battleView = { networkId: "previous-node" };
        room.game.units.filter((u) => u.team === 1).forEach((u) => (u.hp = 0));
        room.game.winner = 0;
        room.phase = "finished";
        sweepLaunchEngine.broadcast(room);
      });
      await page.waitForFunction(() => phase === "sweep_map" && !Net.awaiting);
      expect(
        await page.evaluate(() => ({
          selected,
          battle: CombatPlayback.active(),
          queued: CombatPlayback.queued,
        })),
      ).toEqual({ selected: null, battle: false, queued: 0 });
    }
    expect(errors).toEqual([]);
  });
for (const width of [1440, 390])
  test(`sweep confirmation recovers from launch failure and retries a late-era low-budget node at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(60000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 950 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => {
      const factory = createRoomEngine;
      createRoomEngine = (options) =>
        (window.sweepLaunchEngine = factory({
          ...options,
          aiDelayMs: 999999,
          rules: {
            ...Rules,
            create(...args) {
              if (window.failSweepCreation) throw Error("injected sweep launch failure");
              return Rules.create(...args);
            },
          },
        }));
    });
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await page.locator("#offlineRoomMode").selectOption("sweep");
    await page.locator("#confirmOfflineMode").click();
    if (width === 390) await page.getByRole("button", { name: "房间设置", exact: true }).click();
    await page.locator("#sweepEra").selectOption("UC_0079_T2");
    await page.locator("#sweepFaction").selectOption("ZEON");
    if (width === 390)
      await page
        .locator("#roomSettingsSheet")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
    await page.evaluate(() =>
      Net.request("start_game", { formation: [{ unitId: "Medea", kitId: "standard" }] }),
    );
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#sweepMission")).toBeVisible();
    await page.locator('[data-sweep-node="0:1"]').click();
    await page.evaluate(() => (window.failSweepCreation = true));
    await page.locator("#sweepConfirm").click();
    await expect
      .poll(() => page.evaluate(() => Array.from(sweepLaunchEngine.rooms.values())[0].phase))
      .toBe("sweep_map");
    expect(
      await page.evaluate(() => Array.from(sweepLaunchEngine.rooms.values())[0].sweep.selected),
    ).toBe("0:1");
    await expect(page.locator("#sweepConfirm")).toBeEnabled();
    await page.evaluate(() => (window.failSweepCreation = false));
    await page.locator("#sweepConfirm").click();
    await expect(page.locator("#sweepMission")).toBeHidden();
    await expect(page.locator("#deploymentRoster")).toBeVisible();
    expect(
      await page.evaluate(() =>
        Array.from(sweepLaunchEngine.rooms.values())[0].game.units.some((u) => u.team === 1),
      ),
    ).toBe(true);
    expect(errors).toEqual([]);
  });
