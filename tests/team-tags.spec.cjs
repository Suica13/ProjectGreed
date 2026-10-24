const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("new room defaults, tag summaries and full details are readable with immediate ban-all options", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#roomUnitCostLimit")).toHaveValue("1000");
  await expect(page.locator("#roomUnitLimit")).toHaveValue("9");
  await expect(page.locator('select[data-key] option[value="ALL"]')).toHaveCount(6);
  for (const key of ["bannedFactions", "bannedEras"]) {
    await page.locator("#roomBan-" + key).selectOption("ALL");
    await expect
      .poll(() => page.evaluate((key) => Net.snapshot.settings[key], key))
      .toEqual(
        await page.evaluate((key) => (key === "bannedFactions" ? Rules.factions : Rules.eras), key),
      );
    await page.locator("#roomBan-" + key).selectOption("NONE");
    await expect.poll(() => page.evaluate((key) => Net.snapshot.settings[key], key)).toEqual([]);
  }
  await page.locator("#roomBan-bannedFactions").selectOption("ZEON");
  await waitForRoomSettings(page);
  await expect(page.locator("#teamBanSummary0")).toContainText("ZEON");
  await expect(page.locator("#teamBanSummary1")).toContainText("ZEON");
  await page.locator(".team-slot").first().locator("summary").click();
  await page.locator("#teamBan-0-bannedFactions").selectOption("ALL");
  await expect
    .poll(() => page.evaluate(() => Net.snapshot.settings.teamRestrictions[0].bannedFactions))
    .toEqual(["EFSF", "ZEON"]);
  await page.locator("#teamBan-0-bannedFactions").selectOption("NONE");
  await page.locator("#teamBan-0-bannedEras").selectOption("ALL");

  await expect(page.locator("#teamBanSummary0")).toContainText("0079");
  await expect(page.locator("#teamBanSummary1")).not.toContainText("0079");
  await page.setViewportSize({ width: 430, height: 900 });
  expect(
    await page.locator("#teamBanSummary0").evaluate((el) => getComputedStyle(el).textOverflow),
  ).toBe("ellipsis");
  await page.locator("#teamBanSummary0").click();
  await expect(page.locator("#roomDetailPanel")).toBeVisible();
  await expect(page.locator("#roomDetailContent")).toContainText("ZEON");
  await expect(page.locator("#roomDetailContent")).toContainText("0079");
  await page.locator("#closeRoomDetail").click();
  await expect(page.locator("#roomDetailPanel")).toBeHidden();
});
