const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
test("battle HUD displays reference AP without querying a retired balance API", async ({ page }) => {
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    Net.leave(); session++;
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    game = Rules.create(false, 1, [[entry], [entry]], false, { fogMode: "disabled" });
    game.tiles.forEach(row => row.fill("plain"));
    game.deployment = null;
    game.units.forEach((u, i) => Object.assign(u, { x: 5 + i, y: 5 }));
    phase = "idle"; selected = game.units[0].id; mode = "select";
    battleView = moving = pending = null;
    setPageView("game"); renderPanel();
    return {
      text: byId("unitPanel").textContent,
      hasBalance: game.units.some(u => "actionPoints" in u),
      oldAPI: typeof Rules.actionBudget,
      planned: Rules.firePlan(game, game.units[0], game.units[1]).weapons.length,
    };
  });
  expect(result.text).toContain("AP参考");
  expect(result.text).not.toContain("undefined");
  expect(result.hasBalance).toBe(false);
  expect(result.oldAPI).toBe("undefined");
  expect(result.planned).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
