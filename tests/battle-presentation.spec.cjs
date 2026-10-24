const { openPresentationFixture } = require("./presentation-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path"),
  { createServer } = require("../server.js");
async function openOffline(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  await page.evaluate(() => {
    byId("quick").checked = true;
    const a = game.units[0],
      b = game.units.find((u) => u.team === 1);
    b.x = a.x + 2;
    b.y = a.y;
    game.seed = 1;
    beginAttack(a, b, getWeapon(a, "EF_BeamSprayGun"));
  });
}
test("offline battle fades in, waits two seconds and automatically fades back to the map", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openOffline(page);
  await page.locator("#responseDefend").click();
  await page.locator("#confirmResponse").click();
  await expect.poll(() => page.evaluate(() => battleView?.windowState)).toBe("playing");
  await expect.poll(() => page.evaluate(() => battleView?.completed)).toBe(true);
  await page.waitForTimeout(900);
  await expect(page.locator("#battle")).toBeVisible();
  expect(await page.evaluate(() => Number(byId("battle").style.opacity))).toBe(1);
  await expect
    .poll(() => page.evaluate(() => battleView?.windowState), { intervals: [25] })
    .toBe("closing");
  const fading = await page.evaluate(() => ({
    hold: performance.now() - battleView.completedAt,
    opacity: Number(byId("battle").style.opacity),
  }));
  expect(fading.hold).toBeGreaterThanOrEqual(2000);
  expect(fading.opacity).toBeLessThanOrEqual(1);
  await expect(page.locator("#battle")).toBeHidden();
  expect(await page.evaluate(() => phase)).toBe("idle");
  expect(await page.evaluate(() => battleView)).toBe(null);
  expect(errors).toEqual([]);
});
test("network auto return confirms each team once and waits for the other viewer", async ({
  page,
  context,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    other = await context.newPage(),
    errors = [];
  try {
    for (const client of [page, other]) {
      client.on("pageerror", (error) => errors.push(error.message));
      await client.goto(`http://127.0.0.1:${address.port}`);
      await expect(client.locator("#openSkirmish")).toBeEnabled();
      await client.evaluate(() => {
        window.readyRequests = 0;
        window.moveSounds = 0;
        const play = WeaponAudio.play;
        WeaponAudio.play = function (sound, ...args) {
          if (sound?.asset === "presentation/moveSound") window.moveSounds++;
          return play(sound, ...args);
        };
        const request = Net.request;
        Net.request = function (action, ...args) {
          if (action === "battle_ready") window.readyRequests++;
          return request(action, ...args);
        };
      });
      await client.locator("#openSkirmish").click();
      await client.locator("#openRooms").click();
      // Connect through the actual UI, including the server handshake.
      await client.locator("#serverAddress").fill(`127.0.0.1:${address.port}`);
      await client.locator("#connectServer").click();
      await expect(client.locator("#lobby")).toBeVisible();
    }
    await page.locator("#roomCode").fill("AUTOFADE");
    await page.locator("#createRoom").click();
    await expect(other.locator(".room-card").filter({ hasText: "AUTOFADE" })).toBeVisible();
    await other
      .locator(".room-card")
      .filter({ hasText: "AUTOFADE" })
      .getByRole("button", { name: "加入", exact: true })
      .click();
    await page.locator("#toggleReady").click();
    await other.locator("#toggleReady").click();
    await page.locator("#confirmFinalFormation").click();
    await other.locator("#confirmFinalFormation").click();
    await page.locator("#confirmDeployment").click();
    await other.locator("#confirmDeployment").click();
    await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
    const game = app.rooms.get("AUTOFADE").game,
      a = game.units[0],
      b = game.units.find((u) => u.team === 1);
    a.x = 3;
    a.y = 6;
    b.x = 5;
    b.y = 6;
    game.seed = 1;
    await page.evaluate(() => Net.request("move", { unitId: "0-0", x: 3, y: 7 }));
    for (const client of [page, other]) {
      await expect.poll(() => client.evaluate(() => window.moveSounds)).toBe(1);
      await client.evaluate(() => {
        Net.applySnapshot(Net.snapshot);
        Net.applySnapshot(Net.snapshot);
      });
      expect(await client.evaluate(() => window.moveSounds)).toBe(1);
    }
    await page.evaluate(() => {
      byId("quick").checked = true;
      Net.request("attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_BeamSprayGun" });
    });
    await expect(other.locator("#reaction")).toBeVisible();
    await other.locator("#responseDefend").click();
    await other.locator("#confirmResponse").click();
    await expect(page.locator("#battle")).toBeVisible();
    await other.locator("#roomSettings").click();
    await expect(other.locator("#roomPreparation")).toBeVisible();
    await expect(page.locator("#battle")).toBeHidden({ timeout: 10000 });
    await expect.poll(() => page.evaluate(() => Net.snapshot.battle?.ready[0])).toBe(true);
    expect(app.rooms.get("AUTOFADE").phase).toBe("battle");
    expect(await page.evaluate(() => window.readyRequests)).toBe(1);
    await other.locator("#roomMainMenu").click();
    await expect(other.locator("#battle")).toBeHidden({ timeout: 10000 });
    await expect.poll(() => page.evaluate(() => phase)).toBe("idle");
    expect(await other.evaluate(() => window.readyRequests)).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await other.close();
    await page.close();
    await app.close();
  }
});
