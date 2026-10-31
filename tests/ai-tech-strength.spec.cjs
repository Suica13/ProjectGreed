const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

for (const html of ["client.html"])
  test(`${html}: new profile's offline AI respects room starter research and budget`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public", html)).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => I18n.setLanguage("zh"));
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    await page.waitForFunction(() => !Net.awaiting && Net.snapshot.members.some((m) => m.bot));
    await page.evaluate(() =>
      Net.request("configure_room", {
        mapId: "frontier_1v1",
        costLimit: 900,
        unitCostLimit: 250,
        unitLimit: 12,
        fogMode: "disabled",
      }),
    );
    await page.waitForFunction(() => !Net.awaiting && Net.snapshot.settings.fogMode === "disabled");
    const research = await page.evaluate(() => JSON.stringify(Development.researchSnapshot()));
    await page.evaluate(() =>
      Net.request("set_ready", {
        ready: true,
        formation: [{ unitId: "Type61", kitId: "standard" }],
        inventory: Economy.snapshot().inventory,
      }),
    );
    await page.waitForFunction(() => !Net.awaiting);
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#confirmDeployment")).toBeVisible();
    await expect(page.locator("#resourceLoading")).toBeHidden();
    const result = await page.evaluate(() => {
      const bot = Net.snapshot.members.find((m) => m.bot);
      const army = game.units.filter((u) => Rules.ownerOf(u) === bot.seat);
      return {
        count: army.length,
        cost: army.reduce((sum, u) => sum + UnitModels[u.model].cost, 0),
        points: army.reduce((sum, u) => sum + Rules.formationWeight(UnitModels[u.model]), 0),
        advanced: army.some(
          (u) => !Development.allows(bot.characterFaction, UnitModels[u.model].prefabId, {}),
        ),
        research: JSON.stringify(Development.researchSnapshot()),
      };
    });
    expect(result.count).toBeGreaterThan(0);
    expect(result.advanced).toBe(false);
    expect(result.cost).toBeGreaterThanOrEqual(775);
    expect(result.cost).toBeLessThanOrEqual(900);
    expect(result.points).toBeLessThanOrEqual(12);
    expect(result.research).toBe(research);
    expect(errors).toEqual([]);
  });
