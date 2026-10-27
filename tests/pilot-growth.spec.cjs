const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  P = require("../shared/pilots.js");
for (const width of [1280, 390])
  test(`pilot editor shows level-based caps and enforces them at ${width}px`, async ({ page }) => {
    const pilots = [1, 2, 7, 10].map((level) =>
      P.custom({
        ...P.createCustom("custom-growth-" + level, "成长测试" + level),
        level,
        stats: { ...P.baseStats(), shooting: level === 2 ? 125 : P.statCap(level) },
      }),
    );
    await page.setViewportSize({ width, height: 844 });
    await page.addInitScript((pilots) => {
      localStorage.setItem("projectgreed.combatFaction", "PMC");
      localStorage.setItem("projectgreed.custom-pilots.v2.migrated", "PMC");
      localStorage.setItem(
        "projectgreed.custom-pilots.v2.PMC",
        JSON.stringify({ pilots, awards: [] }),
      );
    }, pilots);
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#openFormation").click();
    await page.locator("#formationPilotsTab").click();
    for (const level of [1, 2, 7, 10]) {
      await page.getByRole("button", { name: "管理驾驶员 成长测试" + level, exact: true }).click();
      await expect(page.locator("#customPilotStats")).toContainText(
        "射击 " + (level === 2 ? 125 : P.statCap(level)) + " / " + P.statCap(level),
      );
      const plus = page.getByRole("button", { name: "强化射击", exact: true });
      if (level === 2) {
        await expect(plus).toBeEnabled();
        await plus.click();
        await page.locator("#confirmPilotTraining").click();
        expect(
          await page.evaluate(
            () =>
              JSON.parse(localStorage.getItem("projectgreed.custom-pilots.v2.PMC")).pilots.find(
                (p) => p.level === 2,
              ).stats.shooting,
          ),
        ).toBe(126);
      } else await expect(plus).toBeDisabled();
      if (level === 10) await expect(page.locator("#customPilotProgress")).toContainText("MAX");
      await page.locator("#finishCustomPilot").click();
    }
  });
