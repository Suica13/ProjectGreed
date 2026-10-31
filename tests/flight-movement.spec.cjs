const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

for (const id of ['MS_07H', 'MS_07H8']) {
  test(id + ' refreshes flight movement over water and confirms the move', async ({ page }) => {
    await page.goto(pathToFileURL(path.resolve('public/client.html')).href);
    await page.waitForFunction(() => assetsReady);
    const result = await page.evaluate(id => {
      const m = Object.values(Rules.models).find(m => m.prefabId === id);
      game = Rules.create(false, 1, [[{ unitId: id, kitId: m.kitId }], [{ unitId: 'RGM_79', kitId: 'machine_gun' }]], false, { costLimit: 99999, unitCostLimit: 99999 });
      game.tiles = Array.from({ length: 24 }, () => Array(30).fill('water'));
      game.cellEnvironments = Array.from({ length: 24 }, () => Array(30).fill('ground'));
      const unit = game.units[0];
      Object.assign(unit, { x: 10, y: 10 });
      Object.assign(game.units[1], { x: 25, y: 20 });
      game.tiles[10][10] = 'plain';
      const grounded = mapRanges(unit, true, null).moveCells.size;
      const ap = unit.actionPoints;
      Rules.useSkill(game, unit, 'flight_stance', 10, 10);
      const spent = ap - unit.actionPoints;
      // Isolate flight cache invalidation even if a snapshot preserves the same AP.
      unit.actionPoints = ap;
      const flying = mapRanges(unit, true, null).moveCells.size;
      Rules.previewMove(game, unit, 12, 10);
      Rules.confirmMove(game, unit);
      return { grounded, flying, spent, x: unit.x, y: unit.y, moved: unit.moved, airborne: unit.flying };
    }, id);
    expect(result.grounded).toBeGreaterThan(0);
    expect(result.flying).toBeGreaterThan(result.grounded);
    expect(result.spent).toBe(1);
    expect(result).toMatchObject({ x: 12, y: 10, moved: true, airborne: true });
  });
}
