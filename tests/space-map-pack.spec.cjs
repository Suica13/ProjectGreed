const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const [id, name, players, width, height] of [
  ["asteroid_crossing_1v1", "小行星航路", 1, 26, 22],
  ["colony_wreck_3v3", "破碎殖民卫星", 3, 40, 38],
  ["outer_orbit_5v5", "外围宙域", 5, 52, 56],
])
  test(`${players}v${players} space map selects immediately and enters deployment`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.locator("#openSkirmish").click();
    await page.locator("#createOfflineRoom").click();
    await page.locator("#roomMapSelect").selectOption(id);
    await expect.poll(() => page.evaluate(() => Net.snapshot.settings.mapId)).toBe(id);
    await expect(page.locator("#roomMapInfo")).toContainText(`${players * 2}人`);
    await page.screenshot({ path: `.openai/${id}-room.png` });
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#deploymentPanel")).toBeVisible();
    await expect(page.locator("#mapEnvironment")).toHaveText("宇宙");
    await expect(page.locator("#mapEnvironment")).toHaveCSS("color", "rgb(183, 136, 255)");
    await expect(page.locator("#mapSectorLabel")).toContainText(name);
    expect(
      await page.evaluate(() => ({
        environment: game.environment,
        width: Rules.mapWidth(game),
        height: Rules.mapHeight(game),
        seats: game.deployment.length,
        allSpace: game.units.every((u) => u.environment === "space"),
      })),
    ).toEqual({ environment: "space", width, height, seats: players * 2, allSpace: true });
    expect(errors).toEqual([]);
  });
