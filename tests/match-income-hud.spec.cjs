"use strict";
const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  fs = require("node:fs/promises");
async function fixture(page, width) {
  await page.setViewportSize({ width, height: width < 700 ? 844 : 1000 });
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    I18n.setLanguage("zh");
    Net.leave();
    game = Rules.create(
      false,
      1,
      [[{ unitId: "Type61", kitId: "standard" }], [{ unitId: "Type61", kitId: "standard" }]],
      false,
      { costLimit: 99999, unitCostLimit: 10000 },
    );
    phase = "idle";
    mode = "select";
    selected = null;
    Net.active = true;
    Net.started = true;
    Net.seat = 0;
    Net.memberId = "income-player";
    Net.snapshot = {
      matchId: "income-match",
      started: true,
      phase: "idle",
      settings: { mode: "regular" },
      room: "收入显示测试",
      game,
      connected: [true, true],
      members: [],
      you: { id: Net.memberId, seat: 0 },
      economyAwards: [
        { id: "kill", matchId: "income-match", kind: "kill", money: 500, supplies: 1000 },
      ],
      techAwards: [{ id: "tech-a", matchId: "income-match", faction: "EFSF", points: 60 }],
    };
    setPageView("game");
    CampaignUI.refreshBattleControls(Net.snapshot);
    update();
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    byId("mapCombatControls").hidden = false;
    byId("mapCombatStatus").textContent = "交战演出";
  });
}
for (const width of [1440, 390])
  test(`sweep battle HUD shows pending run income and final settlement receipts at ${width}px`, async ({ page }) => {
    await fixture(page, width);
    await page.evaluate(() => {
      Net.snapshot.settings.mode = "sweep";
      Net.snapshot.rewardsSettled = false;
      Net.snapshot.sweep = { pending: { money: 3450, supplies: 6900, technology: 750 }, ended: false };
      update();
    });
    await expect(page.locator("#hudMatchIncome .resource-money")).toHaveText("3,450");
    await expect(page.locator("#hudMatchIncome .resource-supplies")).toHaveText("6,900");
    await expect(page.locator("#hudMatchIncome .resource-technology")).toHaveText("750");
    await page.evaluate(() => {
      Net.snapshot.sweep.pending.money = 3250;
      MatchIncome.render(byId("hudMatchIncome"), Net.snapshot);
    });
    await expect(page.locator("#hudMatchIncome .resource-money")).toHaveText("3,250");
    await page.evaluate(() => {
      Net.snapshot.rewardsSettled = true;
      Net.snapshot.sweep.ended = true;
      MatchIncome.render(byId("hudMatchIncome"), Net.snapshot);
    });
    await expect(page.locator("#hudMatchIncome .resource-money")).toHaveText("500");
    await expect(page.locator("#hudMatchIncome .resource-technology")).toHaveText("60");
  });
for (const width of [1920, 768, 390, 320])
  test(`phase, camera, playback toolbar and live income fit ${width}px`, async ({ page }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await fixture(page, width);
    await expect(page.locator("#turnBadge")).toHaveText("第1回合 · 队伍1");
    await expect(page.locator("#hudMatchIncome .resource-money")).toHaveText("500");
    await expect(page.locator("#hudMatchIncome .resource-technology")).toHaveText("60");
    expect(await page.locator("#hudMatchIncome svg").count()).toBe(3);
    const geometry = await page.evaluate(() => {
      const rect = (id) => {
        const r = byId(id).getBoundingClientRect();
        return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width };
      };
      const phase = byId("phaseTitle").closest(".phase-row").getBoundingClientRect(),
        zoom = byId("mapZoomOut").closest(".map-camera-controls").getBoundingClientRect();
      return {
        phase: { x: phase.x, y: phase.y, right: phase.right, bottom: phase.bottom },
        zoom: { x: zoom.x, y: zoom.y, right: zoom.right },
        income: rect("hudMatchIncome"),
        turn: rect("turnBadge"),
        end: rect("endTurn"),
        playbackAtSpeed: byId("mapCombatControls").parentElement.id,
        logBeforeAI: byId("battleLogView").nextElementSibling.id,
        overflow: document.documentElement.scrollWidth > innerWidth,
        sameToolbar:
          byId("mapCombatControls").closest(".log-tabs") ===
          byId("battlePresentationSpeed").closest(".log-tabs"),
      };
    });
    expect(geometry.zoom.x).toBeGreaterThanOrEqual(geometry.phase.right - 1);
    expect(geometry.zoom.y).toBeLessThan(geometry.phase.bottom);
    expect(geometry.zoom.right).toBeLessThanOrEqual(geometry.end.x + 1);
    expect(geometry.income.x).toBeGreaterThanOrEqual(geometry.turn.right - 1);
    expect(geometry.income.right).toBeLessThanOrEqual(width);
    expect(geometry.logBeforeAI).toBe("campaignDelegationToggle");
    expect(geometry.playbackAtSpeed).toBe("battlePresentationTools");
    expect(geometry.sameToolbar).toBe(true);
    expect(geometry.overflow).toBe(false);
    await page.evaluate(() => {
      Net.snapshot = {
        ...Net.snapshot,
        economyAwards: [
          ...Net.snapshot.economyAwards,
          { id: "capture", matchId: "income-match", kind: "capture", money: 750, supplies: 1500 },
        ],
        techAwards: [
          ...Net.snapshot.techAwards,
          { id: "tech-b", matchId: "income-match", faction: "ZEON", points: 40 },
        ],
      };
      BattleHUD.refreshRoomStatus();
    });
    await expect(page.locator("#hudMatchIncome .resource-money")).toHaveText("1,250");
    await expect(page.locator("#hudMatchIncome .resource-technology")).toHaveText("100");
    await fs.mkdir("tmp/verification/screenshots", { recursive: true });
    await page.screenshot({ path: `tmp/verification/screenshots/match-income-hud-${width}.png` });
    expect(errors).toEqual([]);
  });
for (const mode of ["regular", "quick", "battlefield", "campaign"])
  test(`final ${mode} results show total income with science and stock losses`, async ({
    page,
  }) => {
    await fixture(page, 1280);
    const balance = await page.evaluate((mode) => {
      const wallet = Economy.snapshot();
      Net.snapshot = {
        ...Net.snapshot,
        settings: { mode },
        phase: "finished",
        returnAt: Date.now() + 30000,
        serverTime: Date.now(),
        economyAwards: [
          ...Net.snapshot.economyAwards,
          { id: "capture", matchId: "income-match", kind: "capture", money: 750, supplies: 1500 },
          {
            id: "result",
            matchId: "income-match",
            kind: "result",
            money: 2500,
            supplies: 5000,
            losses: { Type61: 2 },
            lostUnits: [],
          },
        ],
        techAwards: [
          ...Net.snapshot.techAwards,
          { id: "tech-b", matchId: "income-match", faction: "ZEON", points: 40 },
        ],
      };
      byId("victory").hidden = false;
      MatchResults.show();
      MatchResults.show();
      return { before: wallet, after: Economy.snapshot() };
    }, mode);
    await expect(page.locator("#victoryEconomy .resource-money")).toHaveText("3,750");
    await expect(page.locator("#victoryEconomy .resource-supplies")).toHaveText("7,500");
    await expect(page.locator("#victoryEconomy .resource-technology")).toHaveText("100");
    await expect(page.locator("#victoryEconomy")).toContainText("损毁扣除 2 台");
    expect(balance.after).toEqual(balance.before);
  });
test("main menu replay page has only the replay file action", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  await page.locator("#shellRecords").click();
  await expect(page.locator("#shellRecordsScreen button")).toHaveCount(1);
  await expect(page.locator("#shellOpenReplay")).toBeVisible();
  const chooser = page.waitForEvent("filechooser");
  await page.locator("#shellOpenReplay").click();
  await chooser;
});
