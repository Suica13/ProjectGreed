const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

for (const language of ["zh", "en"]) {
  test(`battle toolbar stays anchored and separated across screen sizes (${language})`, async ({
    page,
  }) => {
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await expect(page.locator("#openSkirmish")).toBeEnabled();
    await page.evaluate((language) => I18n.setLanguage(language), language);
    for (const viewport of [
      { width: 320, height: 568 },
      { width: 390, height: 844 },
      { width: 667, height: 375 },
      { width: 844, height: 390 },
      { width: 1024, height: 768 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(viewport);
      for (const deploying of [false, true]) {
        await page.evaluate((deploying) => {
          Net.leave();
          TurnFlow.reset();
          MapCombat.reset();
          const entry = { unitId: "RGM_79", kitId: "machine_gun" };
          game = Rules.create(false, 1, [[entry], [entry]], deploying);
          selected = weaponId = battleView = moving = null;
          mode = "select";
          phase = deploying ? "deployment" : "idle";
          Deployment.reset();
          setPageView("game");
          update();
        }, deploying);
        const button = page.locator(deploying ? "#confirmDeployment" : "#endTurn");
        await expect(button).toBeVisible();
        await expect(page.locator("#mapZoomIn")).toBeVisible();
        const layout = await page.evaluate(() => {
          const bounds = (selector) =>
            document.querySelector(selector).getBoundingClientRect().toJSON();
          return {
            map: bounds("#mapWrap"),
            phase: bounds(".phase-row"),
            turn: bounds("#hudTurnActions"),
            zoom: bounds(".map-camera-controls"),
          };
        });
        const overlaps = (a, b) =>
          a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        expect(
          overlaps(layout.turn, layout.zoom),
          JSON.stringify({ viewport, deploying, layout }),
        ).toBe(false);
        expect(overlaps(layout.phase, layout.turn)).toBe(false);
        expect(overlaps(layout.phase, layout.zoom)).toBe(false);
        expect(layout.phase.left - layout.map.left).toBeGreaterThanOrEqual(8);
        expect(layout.phase.left - layout.map.left).toBeLessThanOrEqual(16);
        expect(layout.phase.top - layout.map.top).toBeGreaterThanOrEqual(8);
        expect(layout.phase.top - layout.map.top).toBeLessThanOrEqual(12);
        expect(layout.zoom.left).toBeGreaterThanOrEqual(layout.map.left);
        expect(layout.zoom.right).toBeLessThanOrEqual(layout.map.right);
        expect(layout.zoom.bottom).toBeLessThanOrEqual(layout.map.bottom);
      }
    }
    expect(errors).toEqual([]);
  });
}
