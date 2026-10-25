const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("offline room deploys into the new strip and rejects the original battlefield before confirmation", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  const state = await page.evaluate(() => {
    const unit = game.units.find((u) => Net.owns(u)),
      map = Rules.getMap(game.mapId);
    selected = unit.id;
    update();
    const own = Rules.deploymentCells(game, Net.seat).find((c) => !Rules.at(game, c.x, c.y));
    return {
      id: unit.id,
      own,
      battle: { x: map.deploymentExpansion.addedLeft, y: unit.y },
      width: Rules.mapWidth(game),
      height: Rules.mapHeight(game),
    };
  });
  expect([state.width, state.height]).toEqual([30, 18]);
  expect(
    await page.evaluate(() => {
      const box = byId("map").getBoundingClientRect();
      return (
        mapGeo.ox >= 0 &&
        mapGeo.oy >= 0 &&
        mapGeo.ox + Rules.mapWidth(game) * mapGeo.tile <= box.width &&
        mapGeo.oy + Rules.mapHeight(game) * mapGeo.tile <= box.height
      );
    }),
  ).toBe(true);
  const move = async (cell) => {
    const point = await page.evaluate((cell) => {
      const p = mapPosition(cell.x, cell.y),
        rect = byId("map").getBoundingClientRect();
      return { x: rect.left + p.x, y: rect.top + p.y };
    }, cell);
    await page.mouse.click(point.x, point.y);
  };
  await move(state.own);
  await expect
    .poll(() => page.evaluate((id) => ({ x: getUnit(id).x, y: getUnit(id).y }), state.id))
    .toEqual(state.own);
  await move(state.battle);
  expect(await page.evaluate((id) => ({ x: getUnit(id).x, y: getUnit(id).y }), state.id)).toEqual(
    state.own,
  );
  expect(
    await page.evaluate(() =>
      game.units.every((u) =>
        Rules.deploymentCells(game, Rules.ownerOf(u)).some((c) => c.x === u.x && c.y === u.y),
      ),
    ),
  ).toBe(true);
  await page.screenshot({ path: ".openai/expanded-deployment-strips.png" });
  await page.locator("#confirmDeployment").click();
  await expect(page.locator("#deploymentPanel")).toBeHidden();
  expect(errors).toEqual([]);
});
