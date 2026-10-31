const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
for (const pilotRatio of [false, true, "half"])
  test(`client 12-AP attack queue with ${pilotRatio === "half" ? "half-point AP" : pilotRatio ? "proportional pilot mobility" : "native AP"}`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    const info = await page.evaluate((pilotRatio) => {
      Net.leave();
      const pilot = Rules.pilots.custom({
        ...Rules.pilots.createCustom("custom-browser-ratio", "Ratio"),
        level: 10,
        stats: { ...Rules.pilots.baseStats(), speed: 150 },
      });
      const entry =
        pilotRatio === "half"
          ? { unitId: "RX_78_2", kitId: "kit_1" }
          : pilotRatio
            ? { unitId: "RGM_79", kitId: "machine_gun", customPilot: pilot }
            : { unitId: "RX_78NT_1", kitId: "kit_1" };
      game = Rules.create(
        false,
        1,
        [[entry], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
        false,
        { costLimit: 99999, unitCostLimit: 99999 },
      );
      game.tiles.forEach((row) => row.fill("plain"));
      const [a, b] = game.units;
      Object.assign(a, { x: 10, y: 10 });
      Object.assign(b, { x: 12, y: 10, hp: 1000000, shield: 0 });
      phase = "idle";
      mode = "select";
      selected = null;
      TurnFlow.reset();
      game.fogMode = "disabled";
      AttackControls.reset();
      setPageView("game");
      select(a.id);
      const overview = document.querySelector('[data-hud-pane="overview"] .stats')?.textContent;
      AttackControls.choose(a, b);
      return { overview, ap: a.actionPoints };
    }, pilotRatio);
    expect(info.ap).toBe(pilotRatio === "half" ? 10.5 : pilotRatio ? 12 : 13);
    if (pilotRatio === true) expect(info.overview).toContain("7.5");
    const rifle = page.locator(
      `[data-queue-weapon="${pilotRatio === "half" ? "EF_RX_78_2_BR" : pilotRatio ? "EF_90mmMG" : "EF_RX_78NT_1_BR"}"]`,
    );
    const shots = pilotRatio === "half" ? 2 : 3;
    for (let i = 0; i < shots; i++) await rifle.click();
    await expect(rifle).toBeDisabled();
    await expect(page.locator("#attackQueueBudget")).toContainText(
      pilotRatio === "half" ? /2\.5\s*\/\s*10\.5/ : pilotRatio ? /0\s*\/\s*12/ : /1\s*\/\s*13/,
    );
    expect(await page.evaluate(() => AttackControls.draft(game.units[0]).weapons.length)).toBe(
      shots,
    );
    expect(errors).toEqual([]);
  });
