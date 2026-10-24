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
  await expect(page.locator("#toggleReady")).toBeHidden();
  expect(errors).toEqual([]);
});

test("host has only Start; ready guests wait for the host and only map changes revoke readiness", async ({
  page,
  context,
}) => {
  const { createServer } = require("../server.js");
  const app = createServer({ host: "127.0.0.1", port: 0 });
  const address = await app.listen();
  const guest = await context.newPage();
  async function connect(p) {
    await p.goto("http://127.0.0.1:" + address.port);
    await p.locator("#openSkirmish").click();
    await p.locator("#openRooms").click();
    await p.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await p.locator("#connectServer").click();
    await expect(p.locator("#lobby")).toBeVisible();
  }
  try {
    await connect(page);
    await page.locator("#roomCode").fill("HOSTSTART");
    await page.locator("#createRoom").click();
    await connect(guest);
    await guest.locator(".room-card").filter({ hasText: "HOSTSTART" }).getByRole("button").click();
    await expect(page.locator("#toggleReady")).toBeHidden();
    await expect(page.locator("#startRoomGame")).toBeVisible();
    await expect(page.locator("#startRoomGame")).toBeDisabled();
    await expect(guest.locator("#startRoomGame")).toBeHidden();
    await guest.locator("#toggleReady").click();
    await expect(page.locator("#startRoomGame")).toBeEnabled();
    await expect(page.locator("#finalAssemblyPanel")).toBeHidden();
    expect(await page.evaluate(() => Net.snapshot.started)).toBe(false);
    await guest.locator("#toggleReady").click();
    await expect(page.locator("#startRoomGame")).toBeDisabled();
    await guest.locator("#toggleReady").click();
    await expect(page.locator("#startRoomGame")).toBeEnabled();
    await page.locator("#roomCostLimit").fill("3500");
    await expect.poll(() => guest.evaluate(() => Net.snapshot.settings.costLimit)).toBe(3500);
    await expect(page.locator("#startRoomGame")).toBeEnabled();
    await expect(guest.locator("#toggleReady")).toHaveText("取消准备");
    await guest.locator("#roomFormation").click();
    await guest
      .locator(".formation-row")
      .last()
      .getByRole("button", { name: "移除", exact: true })
      .click();
    await guest.locator("#saveFormation").click();
    await expect(guest.locator("#toggleReady")).toHaveText("取消准备");
    await expect(page.locator("#startRoomGame")).toBeEnabled();
    await page.locator("#roomMapSelect").selectOption("open_dunes_1v1");
    await expect(page.locator("#startRoomGame")).toBeDisabled();
    await expect(guest.locator("#toggleReady")).toHaveText("准备");
    await guest.locator("#toggleReady").click();
    await expect(page.locator("#startRoomGame")).toBeEnabled();
    await page.locator("#startRoomGame").click();
    for (const p of [page, guest]) await expect(p.locator("#finalAssemblyPanel")).toBeVisible();
  } finally {
    await guest.close();
    await page.goto("about:blank");
    await app.close();
  }
});
