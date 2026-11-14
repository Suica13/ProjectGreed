const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const Economy = require("../shared/economy");
const url = pathToFileURL(path.resolve("public/client.html")).href;
for (const width of [1440, 390])
  test(`room validates carriers separately from cargo at ${width}px`, async ({ page }) => {
    const units = [];
    for (let i = 0; i < 3; i++) {
      const carrierIndex = units.length;
      units.push({ unitId: "Medea", kitId: "standard" });
      for (let j = 0; j < 2; j++)
        units.push({
          unitId: "Type61",
          kitId: "standard",
          preload: { carrierIndex, hangarId: "Hangar_1" },
        });
    }
    const stock = Economy.initial();
    stock.inventory.Type61 = 30;
    stock.inventory.Medea = 5;
    await page.addInitScript(
      ({ units, stock, starter }) => {
        localStorage.setItem("projectgreed.language", "zh");
        localStorage.setItem("projectgreed.economy.v1", JSON.stringify(stock));
        localStorage.setItem(
          "slg-formations-v1.PMC",
          JSON.stringify({
            version: 3,
            squads: [
              { name: "Starter", units: starter },
              { name: "Three carriers", units },
            ],
          }),
        );
      },
      { units, stock, starter: Economy.starterFormation() },
    );
    await page.setViewportSize({ width, height: 950 });
    await page.goto(url);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => LocalRoom.open());
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await expect(page.locator("#roomFormationWarning")).toBeHidden();
    await expect(page.locator("#roomFormationSelect")).toHaveAttribute("aria-invalid", "false");
    const revision = await page.evaluate(() => Net.snapshot.revision);
    await page.locator("#roomFormationSelect").selectOption("1");
    await page.waitForFunction((revision) => Net.snapshot.revision > revision, revision);
    await expect(page.locator("#roomFormationWarning")).toBeHidden();
    expect(await page.evaluate(() => Formation.current().length)).toBe(9);
    // A free formation keeps the legacy point budget; the same ships are over three points.
    await page.evaluate(() =>
      Net.request("configure_room", {
        ...Net.snapshot.settings,
        battleMode: "quick",
        formationStyle: "free",
        unitLimit: 3,
      }),
    );
    await page.waitForFunction(() => Net.snapshot.settings.formationStyle === "free");
    await expect(page.locator("#roomFormationWarning")).toBeVisible();
  });
