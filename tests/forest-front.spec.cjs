const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("forest front presents six seats, capacity-sorted maps, AI preparation and deployment", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#roomMapSelect option")).toHaveCount(13);
  const counts = await page
    .locator("#roomMapSelect option")
    .evaluateAll((options) => options.map((o) => Rules.getMap(o.value).spawns.length));
  expect(counts).toEqual([...counts].sort((a, b) => a - b));
  await page.locator("#roomMapSelect").selectOption("frontline_3v3");
  await waitForRoomSettings(page);
  await expect(page.locator("#roomMapInfo")).toContainText("6人");
  expect(await page.evaluate(() => Net.snapshot.settings.mapId)).toBe("frontline_3v3");
  for (const seat of [2, 3, 4, 5]) await page.locator("#addAI" + seat).click();
  expect(await page.evaluate(() => Net.snapshot.members.length)).toBe(6);
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#confirmDeployment")).toBeVisible();
  expect(await page.evaluate(() => game.deployment.length)).toBe(6);
  await expect(page.locator(".roster-owner")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => new Set(game.units.map((u) => u.x + "," + u.y)).size === game.units.length,
    ),
  ).toBe(true);
  await page.screenshot({ path: ".openai/forest-front-3v3.png" });
  expect(errors).toEqual([]);
});

test("formation weapon kit changes play native ChangeEquipment while combat selection keeps its own sound", async ({
  page,
}) => {
  await page.goto(url);
  await page.evaluate(() => {
    window.played = [];
    const play = WeaponAudio.play;
    WeaponAudio.play = (sound, ...args) => {
      window.played.push(sound?.asset);
      return play(sound, ...args);
    };
  });
  await page.locator("#openFormation").click();
  await page
    .locator(".formation-row")
    .first()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await page.locator("#formationDetailKit").selectOption("machine_gun");
  await expect
    .poll(() =>
      page.evaluate(() => played.filter((s) => s === "presentation/changeEquipmentSound").length),
    )
    .toBe(1);
  expect(await page.evaluate(() => played.includes("presentation/selectWeaponSound"))).toBe(false);
  expect(await page.evaluate(() => ART.presentation.changeEquipmentSound.file)).toBe(
    "sounds/ChangeEquipment.ogg",
  );
});
