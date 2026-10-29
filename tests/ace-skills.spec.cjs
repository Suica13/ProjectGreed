const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const [html, width] of [
  ["client", 1280],
  ["developer", 390],
])
  test(`${html} ACE skills follow unit skills and apply without spending AP at ${width}px`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 900 });
    await page.goto(pathToFileURL(path.resolve("public/" + html + ".html")).href);
    await page.waitForFunction(() => assetsReady);
    const result = await page.evaluate(async () => {
      Net.leave();
      I18n.setLanguage("zh");
      const profile = PilotSystem.catalog.aces.find(
        (p) => p.price && p.skills.some((s) => s.id === "Pilot_AccuracyUp_Trigger"),
      );
      game = Rules.create(
        false,
        1,
        [
          [
            {
              unitId: "FA_78_1",
              kitId: Economy.baseKit("FA_78_1"),
              customPilot: PilotSystem.createAce(profile.id),
            },
          ],
          [{ unitId: "RGM_79", kitId: "machine_gun" }],
        ],
        false,
        { costLimit: 99999, unitCostLimit: 99999 },
      );
      game.tiles.forEach((r) => r.fill("plain"));
      const u = game.units[0];
      Object.assign(u, { x: 5, y: 8, en: 500 });
      Object.assign(game.units[1], { x: 12, y: 8 });
      phase = "idle";
      selected = u.id;
      setPageView("game");
      await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(game));
      update();
      BattleHUD.setTab("skills");
      const buttons = [...document.querySelectorAll("[data-unit-skill]")];
      return {
        id: profile.skills.find((s) => s.type === "pilot_buff").id,
        ap: u.actionPoints,
        ordered: buttons.map((b) => ({ id: b.dataset.unitSkill, pilot: !!b.dataset.pilotSkill })),
        en: u.en,
      };
    });
    expect(result.ordered.some((b) => !b.pilot)).toBe(true);
    const firstPilot = result.ordered.findIndex((b) => b.pilot);
    expect(result.ordered.slice(firstPilot).every((b) => b.pilot)).toBe(true);
    await expect(page.locator(".pilot-skills-heading")).toHaveText("驾驶员技能");
    const button = page.locator(`[data-pilot-skill="${result.id}"]`);
    await expect(button).toBeEnabled();
    await expect(button).toContainText("100 EN");
    await button.click();
    const after = await page.evaluate(() => ({
      en: game.units[0].en,
      ap: game.units[0].actionPoints,
      active: game.units[0].pilotBuffs,
      temporary:
        game.units[0].pilot.stats.accuracy ===
        PilotSystem.aceProfile(game.units[0].pilot).baseStats.accuracy,
    }));
    expect(after.en).toBe(result.en - 100);
    expect(after.ap).toBe(result.ap);
    expect(after.active[result.id]).toBeTruthy();
    expect(after.temporary).toBe(true);
    await expect(page.locator(`[data-pilot-skill="${result.id}"]`)).toBeDisabled();
    await expect(page.locator(`[data-pilot-skill="${result.id}"]`)).toContainText("生效中");
    expect(errors).toEqual([]);
  });
