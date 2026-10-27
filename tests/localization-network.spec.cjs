const { finishPlanning } = require("./planning-fixture.cjs");
const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server.js");
test("English and Japanese players share stable unit and weapon IDs and authoritative combat results", async ({
  browser,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen(),
    contexts = [];
  try {
    const pages = [];
    for (const locale of ["en-US", "ja-JP"]) {
      const context = await browser.newContext({ locale });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      await page.goto("http://127.0.0.1:" + address.port);
      await page.locator("#openSkirmish").click();
      await page.locator("#openRooms").click();
      await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
      await page.locator("#connectServer").click();
      await expect(page.locator("#lobby")).toBeVisible();
    }
    const [english, japanese] = pages;
    await english.locator("#createRoom").click();
    await english.locator("#roomCode").fill("LOCALES");
    await english.locator('#roomCreateForm button[type="submit"]').click();
    await japanese.locator(".room-card").filter({ hasText: "LOCALES" }).getByRole("button").click();
    await japanese.locator("#toggleReady").click();
    await english.locator("#startRoomGame").click();
    await english.locator("#confirmFinalFormation").click();
    await japanese.locator("#confirmFinalFormation").click();
    await english.locator("#confirmDeployment").click();
    await japanese.locator("#confirmDeployment").click();
    await expect.poll(() => english.evaluate(() => phase)).toBe("idle");
    app.rooms.get("LOCALES").game.units.find((u) => u.id === "1-0").x = 5;
    app.rooms.get("LOCALES").game.units.find((u) => u.id === "1-0").y = 6;
    await english.evaluate(() => Net.request("move", { unitId: "0-0", x: 3, y: 6 }));
    await expect.poll(() => japanese.evaluate(() => Net.snapshot.game.units[0].x)).toBe(3);
    await expect.poll(() => english.evaluate(() => phase)).toBe("idle");
    expect(await english.evaluate(() => UnitModels[game.units[0].model].name)).toBe("GM");
    expect(await japanese.evaluate(() => UnitModels[game.units[0].model].name)).toBe("ジム");
    await english.evaluate(() =>
      Net.request("attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_BeamSprayGun" }),
    );
    await finishPlanning([english, japanese]);
    await expect(japanese.locator("#reaction")).toBeVisible();
    await japanese.locator("#responseDefend").click();
    await japanese.locator("#confirmResponse").click();
    await expect.poll(() => english.evaluate(() => phase)).toBe("battle");
    await expect.poll(() => japanese.evaluate(() => phase)).toBe("battle");
    const a = await english.evaluate(() => Net.snapshot.combats.at(-1).events);
    const b = await japanese.evaluate(() => Net.snapshot.combats.at(-1).events);
    expect(a).toEqual(b);
    expect(a[0].weapon).toBe("EF_BeamSprayGun");
    expect(await english.evaluate(() => Net.snapshot.game.units)).toEqual(
      await japanese.evaluate(() => Net.snapshot.game.units),
    );
  } finally {
    for (const context of contexts) await context.close();
    await app.close();
  }
});
