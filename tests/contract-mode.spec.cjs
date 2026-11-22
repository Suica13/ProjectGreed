const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server"),
  G = require("../shared/rules");
for (const width of [1440, 390])
  test(`contract event and early extraction over WebSocket at ${width}px`, async ({ page }) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width, height: 960 });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const app = createServer({ port: 0, aiDelayMs: 999999, resultReturnMs: 999999 }),
      address = await app.listen(),
      base = "http://127.0.0.1:" + address.port;
    const idle = () => page.waitForFunction(() => Net.snapshot && !Net.awaiting);
    const act = async (action, fields = {}) => {
      await idle();
      await page.evaluate(({ action, fields }) => Net.request(action, fields), { action, fields });
      await idle();
    };
    try {
      await page.goto(base);
      await page.waitForFunction(() => assetsReady);
      await page.evaluate(() => {
        I18n.setLanguage("zh");
        Economy.creditActivity({
          id: "contract-fixture",
          matchId: "contract-fixture",
          money: 0,
          supplies: 0,
          inventory: { Medea: 1 },
        });
        const item = Economy.snapshot().storage.ships.find((s) => s.unitId === "Medea");
        localStorage.setItem(
          "slg-formations-v1.PMC",
          JSON.stringify({
            version: 3,
            squads: [
              {
                name: "Contract",
                units: [{ unitId: item.unitId, kitId: item.kitId, stockId: item.id }],
              },
            ],
          }),
        );
        localStorage.setItem("slg-formations-v1.PMC-active", "0");
      });
      await page.reload();
      await page.waitForFunction(() => assetsReady);
      await page.evaluate((base) => Lobby.reconnect(base), base);
      await page.locator("#createRoom").click();
      await page.locator("#roomCode").fill("CONTRACT_UI");
      await page.locator("#newRoomMode").selectOption("sweep");
      await page.locator('#roomCreateForm button[type="submit"]').click();
      await idle();
      await expect(page.locator("#sweepRoomOptions")).toContainText("合约模式设置");
      if (width < 700) await page.locator('[data-room-tab="settings"]').click();
      await expect(page.locator("#roomFormationPreset")).toHaveValue("contract");
      await expect(page.locator("#roomFormationPreset option:checked")).toHaveText("合约模式");
      await expect(page.locator("#roomCostLimit")).toHaveValue("2000");
      await expect(page.locator("#roomUnitLimit")).toHaveValue("2");
      await expect(page.locator("#roomFogMode")).toHaveValue("full");
      await expect(page.locator("#roomFogMode")).toBeDisabled();
      await expect(page.locator("#roomPilotPolicy")).toHaveValue("allow");
      await expect(page.locator("#roomPilotPolicy")).toBeDisabled();
      for (const environment of ["ground", "space", "ground"]) {
        await page.locator("#sweepEnvironment").selectOption(environment);
        await idle();
        await expect(page.locator("#roomMapPreview")).toHaveAttribute(
          "data-cover",
          `assets/maps/covers/contract-${environment}.svg`,
        );
        await expect(page.locator("#roomMapPreview")).toHaveAttribute("data-cover-loaded", "true");
        expect(
          await page.evaluate(
            (environment) =>
              ART.assets[ContractMode.covers[environment]].startsWith("data:image/svg+xml;base64,"),
            environment,
          ),
        ).toBe(true);
        await page.locator("#roomMapPreview").screenshot({
          path: `tmp/verification/screenshots/contract-cover-${environment}-${width}.png`,
        });
      }
      await page.locator("#sweepDifficulty").selectOption("9");
      await idle();
      await expect.poll(() => page.evaluate(() => Net.snapshot.settings.sweepDifficulty)).toBe(9);
      for (const [era, cost, allowed] of [
        ["UC_0079_T2", 25000, ["EFSF", "ZEON"]],
        ["UC_0087_T1", 31250, ["AEUG", "TITANS", "NEO_ZEON"]],
        ["UC_0087_T2", 39063, ["AEUG", "TITANS", "NEO_ZEON"]],
        ["UC_0079_T1", 20000, ["EFSF", "ZEON"]],
      ]) {
        await page.locator("#sweepEra").selectOption(era);
        await idle();
        await expect.poll(() => page.evaluate(() => Net.snapshot.settings.costLimit)).toBe(cost);
        const options = await page.locator("#sweepFaction option").evaluateAll((nodes) => nodes.map((n) => n.value));
        expect(options.length).toBeGreaterThan(0);
        expect(options.every((f) => allowed.includes(f))).toBe(true);
        await expect(page.locator("#sweepRoomOptions")).toContainText(String(cost));
        await expect(page.locator("#roomCostLimit")).toHaveValue(String(cost));
        await expect(page.locator("#roomUnitLimit")).toHaveValue("4");
        await expect(page.locator("#roomFormationPreset")).toHaveValue("contract");
      }
      if (width < 700) await page.locator("#closeRoomSettingsSheet").click();
      await page.locator("#startRoomGame").click();
      await expect(page.locator("#confirmFinalFormation")).toBeVisible();
      await page.evaluate(() => {
        window.contractIntroSounds = 0;
        window.contractObservedCues = [];
        const play = GameAudio.play;
        GameAudio.play = (key) => {
          if (key === "sonarSound") window.contractIntroSounds++;
          return play(key);
        };
        let last = "";
        new MutationObserver(() => {
          const node = byId("contractCutin");
          if (!node.hidden && node.dataset.cueId !== last) {
            last = node.dataset.cueId;
            window.contractObservedCues.push(node.dataset.kind);
          }
        }).observe(byId("contractCutin"), { attributes: true });
      });
      await page.locator("#confirmFinalFormation").click();
      await expect(page.locator("#contractHud button").filter({ hasText: "入场区" })).toBeVisible();
      const briefing = page.locator("#operationBriefing");
      await expect(briefing).toBeVisible();
      await expect(briefing).toHaveAttribute("data-mode", "sweep");
      await expect(briefing.locator(".briefing-goal")).toHaveCount(13);
      await expect(briefing.locator(".briefing-radar-sweep")).toHaveCSS(
        "animation-name",
        "briefing-radar-sweep",
      );
      const initial = await briefing.locator(".briefing-goal.active").getAttribute("data-goal-id");
      await act("sync");
      await expect
        .poll(() => briefing.locator(".briefing-goal.active").getAttribute("data-goal-id"), {
          timeout: 6000,
        })
        .not.toBe(initial);
      await briefing.locator(".briefing-goal").nth(2).click();
      await expect(briefing.locator(".briefing-goal").nth(2)).toHaveClass(/active/);
      expect(
        await briefing.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight;
        }),
      ).toBe(true);
      await expect(briefing.locator(".briefing-marker.active")).toHaveCSS(
        "background-color",
        "rgb(40, 103, 132)",
      );
      await briefing.locator(".briefing-goal").last().click();
      await expect
        .poll(() => briefing.locator(".briefing-goals").evaluate((el) => el.scrollTop))
        .toBeGreaterThan(0);
      await page.screenshot({
        path: `tmp/verification/screenshots/briefing-contract-${width}.png`,
      });
      if (width === 1440) {
        await page.setViewportSize({ width: 844, height: 390 });
        expect(
          await briefing
            .locator("footer")
            .getByRole("button", { name: "关闭", exact: true })
            .evaluate((el) => {
              const r = el.getBoundingClientRect();
              return r.top >= 0 && r.bottom <= innerHeight;
            }),
        ).toBe(true);
        await expect
          .poll(() =>
            briefing.locator(".briefing-goals").evaluate((list) => {
              const selected = list.querySelector(".active");
              return (
                selected.getBoundingClientRect().bottom <= list.getBoundingClientRect().bottom + 1
              );
            }),
          )
          .toBe(true);
        await page.screenshot({ path: "tmp/verification/screenshots/briefing-short.png" });
        await page.setViewportSize({ width, height: 960 });
      }

      await briefing.locator("footer").getByRole("button", { name: "关闭", exact: true }).click();

      await act("auto_place_deployment");
      await act("confirm_deployment");
      await expect.poll(() => page.evaluate(() => Net.snapshot.phase)).toBe("idle");
      await expect(briefing).toBeHidden();
      expect(await page.evaluate(() => window.contractIntroSounds)).toBe(1);
      await act("sync");
      expect(await page.evaluate(() => window.contractIntroSounds)).toBe(1);

      const room = app.rooms.get("CONTRACT_UI"),
        g = room.game,
        o = g.contract.objectives.find((o) => o.type === "salvage"),
        actor = g.units.find((u) => u.ownerSeat === 0);
      const eliminate = g.contract.objectives.find((o) => o.type === "command"),
        outpost = g.contract.objectives.find((o) => o.type === "capture");
      g.fogMode = "disabled";
      await act("sync");
      await page.evaluate(({ x, y }) => {
        MapCamera.setZoom(1);
        MapCamera.focus(x, y);
      }, eliminate);
      await page.screenshot({ path: `tmp/verification/screenshots/contract-targets-${width}.png` });
      if (width === 1440) {
        await page.evaluate(() => I18n.setLanguage("en"));
        await page.screenshot({ path: "tmp/verification/screenshots/contract-targets-en.png" });
        await page.evaluate(() => I18n.setLanguage("zh"));
      }
      await page.evaluate(({ x, y }) => MapCamera.focus(x, y), outpost);
      await page.screenshot({ path: `tmp/verification/screenshots/contract-outpost-${width}.png` });
      for (const enemy of g.units.filter((u) => u.team === 1)) enemy.hp = 0;
      for (const objective of g.contract.objectives)
        if (objective !== o) objective.status = "completed";
      actor.x = o.x;
      actor.y = o.y;
      actor.acted = false;
      await act("sync");
      await page.evaluate((id) => {
        selected = id;
      }, actor.id);
      await page.locator("#contractHud button").filter({ hasText: "事件目标" }).click();
      await expect(page.locator("#contractObjectives")).toBeVisible();
      await expect(page.locator("#contractObjectives .contract-objective")).toHaveCount(9);
      await page
        .locator("#contractObjectives header")
        .getByRole("button", { name: "关闭", exact: true })
        .click();
      await page.evaluate((id) => {
        selected = id;
        update();
      }, actor.id);
      await expect(page.locator("#hudCapturePoint")).toHaveText("回收");
      await page.locator("#hudCapturePoint").click();
      await expect
        .poll(() => page.evaluate(() => Net.snapshot.contract.completed))
        .toBeGreaterThan(0);
      await expect(page.locator("#contractCutin")).toBeVisible();
      await page.screenshot({ path: `tmp/verification/screenshots/contract-cutin-${width}.png` });
      await page.waitForFunction(() => !ContractUI.presenting, null, { timeout: 15000 });
      expect(await page.evaluate(() => window.contractObservedCues)).toEqual([
        "started",
        "completed",
        "all_completed",
      ]);
      await act("sync");
      expect(await page.evaluate(() => window.contractObservedCues.length)).toBe(3);
      await expect(page.locator("#hudPlayerCount")).toContainText("1/4");
      if (width < 700)
        expect(
          await page
            .locator("#contractHud")
            .evaluate(
              (el) =>
                el.getBoundingClientRect().top >= byId("mapZoomOut").getBoundingClientRect().bottom,
            ),
        ).toBe(true);
      const overview = await page.evaluate(async () => {
        MapCamera.fit();
        const begin = performance.now();
        for (let i = 0; i < 45; i++) await new Promise(requestAnimationFrame);
        return {
          fps: Math.round(45000 / (performance.now() - begin)),
          cache: TileMapRenderer.cacheStats(),
        };
      });
      console.log("contract-overview", width, overview);
      await page.screenshot({ path: `tmp/verification/screenshots/contract-battle-${width}.png` });
      expect(
        await page.locator("#contractHud").evaluate((el) => getComputedStyle(el).position),
      ).toBe("absolute");
      expect(
        await page.locator("#contractHud").evaluate((el) => {
          const r = el.getBoundingClientRect();
          return r.x >= 0 && r.right <= innerWidth;
        }),
      ).toBe(true);
      const zone = g.contract.extraction;
      actor.x = zone.x + 2;
      actor.y = zone.y + 2;
      await act("sync");
      await page.evaluate((id) => {
        selected = id;
        update();
      }, actor.id);
      await expect(page.locator("#hudContractExtract")).toBeVisible();
      await expect(page.locator("#hudContractExtract")).toHaveCSS(
        "animation-name",
        "contract-extract-pulse",
      );
      await page.screenshot({ path: `tmp/verification/screenshots/contract-extract-${width}.png` });
      await page.locator("#hudContractExtract").click();
      await expect.poll(() => page.evaluate(() => Net.snapshot.game.winner)).toBe(0);
      expect(room.economyAwards.filter((a) => a.kind === "result")).toHaveLength(1);
      expect(errors).toEqual([]);
    } finally {
      await page.evaluate(() => Net.leave()).catch(() => {});
      await app.close();
    }
  });
