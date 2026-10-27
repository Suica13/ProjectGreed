const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1280, 390])
  test(`deployment controls allow moving own units into teammate areas at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    const result = await page.evaluate(() => {
      I18n.setLanguage("zh");
      Net.leave();
      TurnFlow.reset();
      MapCombat.reset();
      AttackControls.reset();
      session++;
      const entry = { unitId: "Type61", kitId: "standard" };
      game = Rules.create(false, 17, [[entry], [entry], [entry], [entry]], false, {
        mapId: "crossroads_2v2",
        costLimit: 99999,
        unitCostLimit: 99999,
      });
      game.deployment = [false, false, false, false];
      game.tiles.forEach((row) => row.fill("plain"));
      selected = game.units[0].id;
      mode = "select";
      phase = "deployment";
      weaponId = pending = battleView = moving = null;
      setPageView("game");
      update();
      const own = game.units[0],
        area = Rules.getMap(game.mapId).deploymentAreas[2],
        destination = { x: area.x + 3, y: area.y + 3 };
      Deployment.click(destination);
      const position = { x: own.x, y: own.y };
      const enemy = Rules.getMap(game.mapId).deploymentAreas[1];
      Deployment.click({ x: enemy.x + 3, y: enemy.y + 3 });
      return {
        position,
        destination,
        afterEnemy: { x: own.x, y: own.y },
        status: byId("deploymentStatus").textContent,
      };
    });
    expect(result.position).toEqual(result.destination);
    expect(result.afterEnemy).toEqual(result.position);
    expect(result.status).toContain("全队共享部署区");
    expect(errors).toEqual([]);
  });
