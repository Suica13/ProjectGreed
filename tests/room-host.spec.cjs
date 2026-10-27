const { waitForRoomSettings } = require("./room-settings-fixture.cjs");
const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function lobby(page, port, name) {
  await page.goto("http://127.0.0.1:" + port);
  await page.locator("#playerId").fill(name);
  await page.locator("#openSkirmish").click();
  await page.locator("#openRooms").click();
  await page.locator("#serverAddress").fill("127.0.0.1:" + port);
  await page.locator("#connectServer").click();
  await expect(page.locator("#lobby")).toBeVisible();
}
test("room creator remains host after refresh and can still configure map, COST and AI", async ({
  page,
  context,
}) => {
  const app = createServer({ port: 0, host: "127.0.0.1" }),
    address = await app.listen();
  const guest = await context.newPage(),
    errors = [];
  for (const p of [page, guest]) p.on("pageerror", (e) => errors.push(e.message));
  try {
    await lobby(page, address.port, "Creator");
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("HOSTORDER");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    const creator = await page.evaluate(() => Net.memberId);
    await expect(page.locator("#roomMapSelect")).toBeEnabled();
    await expect(page.locator('.spawn-slot[data-seat="0"] .lineup-name > strong')).toHaveClass(
      /player-host/,
    );
    await lobby(guest, address.port, "Guest");
    await guest.locator(".room-card").filter({ hasText: "HOSTORDER" }).getByRole("button").click();
    await expect(guest.locator("#roomPreparation")).toBeVisible();
    await expect(guest.locator("#roomMapSelect")).toBeDisabled();
    await expect(guest.locator('.spawn-slot[data-seat="1"] .lineup-name > strong')).toHaveClass(
      /player-self/,
    );
    await page.reload();
    await expect(page.locator("#roomPreparation")).toBeVisible();
    expect(await page.evaluate(() => Net.memberId)).toBe(creator);
    expect(await page.evaluate(() => Net.snapshot.hostId)).toBe(creator);
    await expect(page.locator("#roomMapSelect")).toBeEnabled();
    await expect(page.locator("#roomCostLimit")).toBeEnabled();
    await expect(page.locator('.spawn-slot[data-seat="0"] .lineup-name > strong')).toHaveCSS(
      "color",
      "rgb(240, 206, 103)",
    );
    await page.locator("#roomMapSelect").selectOption("crossroads_2v2");
    await page.locator("#roomCostLimit").fill("4200");
    await waitForRoomSettings(page);
    await expect.poll(() => guest.evaluate(() => Net.snapshot.settings.costLimit)).toBe(4200);
    await expect
      .poll(() => guest.evaluate(() => Net.snapshot.settings.mapId))
      .toBe("crossroads_2v2");
    await page.locator("#addAI2").click();
    await expect(page.locator("#removeAI2")).toBeVisible();
    await page.locator("#chooseSeat3").click();
    await expect.poll(() => page.evaluate(() => Net.seat)).toBe(3);
    await expect(page.locator('.spawn-slot[data-seat="3"] .lineup-name > strong')).toHaveClass(
      /player-host/,
    );
    await expect(page.locator("#roomMapSelect")).toBeEnabled();
    await page.evaluate(() => openMenu());
    await expect.poll(() => guest.evaluate(() => Net.snapshot.hostId === Net.memberId)).toBe(true);
    await expect(guest.locator('.spawn-slot[data-seat="1"] .lineup-name > strong')).toHaveCSS(
      "color",
      "rgb(240, 206, 103)",
    );
    await expect(guest.locator("#roomMapSelect")).toBeEnabled();
    await expect(guest.locator("#roomCostLimit")).toBeEnabled();
    await guest.locator("#roomCostLimit").fill("4300");
    await waitForRoomSettings(guest);
    await expect.poll(() => guest.evaluate(() => Net.snapshot.settings.costLimit)).toBe(4300);
    expect(errors).toEqual([]);
  } finally {
    await guest.close();
    await page.close();
    await app.close();
  }
});
test("offline creator remains gold and can edit settings from a different spawn or spectator seat", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  await expect(page.locator("#roomMapSelect")).toBeEnabled();
  const id = await page.evaluate(() => Net.memberId);
  await expect(page.locator('.spawn-slot[data-seat="0"] .lineup-name > strong')).toHaveClass(
    /player-host/,
  );
  await page.locator("#removeAI1").click();
  await expect(page.locator("#chooseSeat1")).toBeEnabled();
  await page.locator("#chooseSeat1").click();
  await expect.poll(() => page.evaluate(() => Net.seat)).toBe(1);
  expect(await page.evaluate(() => Net.snapshot.hostId)).toBe(id);
  await expect(page.locator('.spawn-slot[data-seat="1"] .lineup-name > strong')).toHaveClass(
    /player-host/,
  );
  await page.locator("#becomeSpectator").click();
  await expect(page.locator("#spectatorSlots .player-host")).toBeVisible();
  await expect(page.locator("#roomMapSelect")).toBeEnabled();
  await expect(page.locator("#roomCostLimit")).toBeEnabled();
});
