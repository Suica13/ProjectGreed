const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("offline host starts a 3v3 map with just one opposing AI and returns everyone without empty-slot waits", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await page.locator("#roomMapSelect").selectOption("frontline_3v3");
  await expect.poll(() => page.evaluate(() => Net.snapshot.settings.mapId)).toBe("frontline_3v3");
  await page.evaluate(() => Net.request("remove_ai", { seat: 1 }));
  await expect.poll(() => page.evaluate(() => !!Net.awaiting)).toBe(false);
  await page.evaluate(() => Net.request("add_ai", { seat: 5 }));
  await expect(page.locator("#startRoomGame")).toBeEnabled();
  await page.locator("#startRoomGame").click();
  await expect(page.locator("#finalAssemblyPanel")).toBeVisible();
  await expect(page.locator("#confirmFinalFormation")).toBeEnabled();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#confirmDeployment")).toBeVisible();
  expect(await page.evaluate(() => game.units.every((u) => [0, 5].includes(u.ownerSeat)))).toBe(
    true,
  );
  await page.locator("#confirmDeployment").click();
  await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
  await page.locator("#roomSettings").click();
  await page.locator("#returnAllToRoom").click();
  await expect(page.locator("#startRoomGame")).toBeEnabled();
  await expect(page.locator("#toggleReady")).toBeVisible();
  expect(errors).toEqual([]);
});
