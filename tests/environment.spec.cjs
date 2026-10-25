const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
test("space room deployment halves ground-unit movement and mobility, shows purple tag and restores ground values on the next map", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openFormation").click();
  await page.locator('[data-unit-id="RX_79_G"]').click();
  await page.locator("#addFormationUnit").click();
  await page
    .locator(".formation-row")
    .last()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await expect(page.locator("#formationDetailStats")).toContainText("宇宙适应性 50%");
  await page.locator("#closeFormationDetail").click();
  await page.locator("#saveFormation").click();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomUnitCostLimit").fill("1000");
  await waitForRoomSettings(page);
  for (const [id, tag, color, move, mobility] of [
    ["orbital_debris_2v2", "宇宙", "rgb(183, 136, 255)", 2.5, 60],
    ["frontier_1v1", "地面", "rgb(242, 160, 68)", 5, 120],
  ]) {
    await page.locator("#roomMapSelect").selectOption(id);
    await expect.poll(() => page.evaluate(() => Net.snapshot.settings.mapId)).toBe(id);
    await page.locator("#startRoomGame").click();
    await page.locator("#confirmFinalFormation").click();
    await expect(page.locator("#deploymentPanel")).toBeVisible();
    await expect(page.locator("#mapEnvironment")).toHaveText(tag);
    await expect(page.locator("#mapEnvironment")).toHaveCSS("color", color);
    const stats = await page.evaluate(() => {
      const u = game.units.find(
        (u) => u.ownerSeat === 0 && Rules.modelOf(u).prefabId === "RX_79_G",
      );
      selected = u.id;
      update();
      const m = Rules.modelOf(u);
      return { move: m.move, mobility: m.mobility, environment: u.environment };
    });
    expect(stats.move).toBe(move);
    expect(stats.mobility).toBe(mobility);
    expect(stats.environment).toBe(id === "orbital_debris_2v2" ? "space" : "ground");
    await expect(page.locator("#unitPanel .stats")).toContainText(String(move) + " 格");
    await expect(page.locator("#unitPanel .stats")).toContainText("命中系数110%");
    if (id === "orbital_debris_2v2") {
      await page.evaluate(() => I18n.setLanguage("en"));
      await expect(page.locator("#mapEnvironment")).toHaveText("Space");
      await page.evaluate(() => I18n.setLanguage("zh"));
      await page.screenshot({ path: ".openai/orbital-debris-space.png" });
      await page.evaluate(() => Net.request("return_room"));
      await expect(page.locator("#roomPreparation")).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});
