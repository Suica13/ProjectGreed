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
      await context.addInitScript(() => {
        localStorage.setItem("projectgreed.combatFaction", "PMC");
        localStorage.setItem(
          "projectgreed.economy.v1",
          JSON.stringify({ money: 5000, supplies: 10000, inventory: { RGM_79: 1 }, kits: {} }),
        );
        localStorage.setItem(
          "slg-formations-v1.PMC",
          JSON.stringify({
            version: 3,
            squads: [{ name: "Test", units: [{ unitId: "RGM_79", kitId: "machine_gun" }] }],
          }),
        );
      });
      contexts.push(context);
      const page = await context.newPage();
      pages.push(page);
      await page.goto("http://127.0.0.1:" + address.port);
      await page.waitForFunction(() => assetsReady);
      await page.evaluate(() => Development.grantUnit("EFSF", "RGM_79"));
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
    const room = app.rooms.get("LOCALES");
    room.game.tiles.forEach((row) => row.fill("plain"));
    Object.assign(room.game.units[0], { x: 2, y: 4 });
    Object.assign(room.game.units[1], { x: 5, y: 4 });
    for (const page of pages) {
      await page.evaluate(() => Net.request("sync"));
      await expect.poll(() => page.evaluate(() => !Net.awaiting)).toBe(true);
    }
    await english.evaluate(() => Net.request("move", { unitId: "0-0", x: 3, y: 4 }));
    await expect
      .poll(() => english.evaluate(() => !!Net.snapshot.game.units[0].pendingMove))
      .toBe(true);
    await expect.poll(() => english.evaluate(() => !Net.awaiting)).toBe(true);
    await english.evaluate(() => Net.request("confirm_move", { unitId: "0-0" }));
    await expect.poll(() => japanese.evaluate(() => Net.snapshot.game.units[0].x)).toBe(3);
    await expect.poll(() => english.evaluate(() => !Net.awaiting && phase === "idle")).toBe(true);
    expect(await english.evaluate(() => UnitModels[game.units[0].model].name)).toBe("GM");
    expect(await japanese.evaluate(() => UnitModels[game.units[0].model].name)).toBe("ジム");
    await english.evaluate(() =>
      Net.request("attack", { unitId: "0-0", targetId: "1-0", weaponId: "EF_90mmMG" }),
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
    expect(a[0].weapon).toBe("EF_90mmMG");
    expect(
      await english.evaluate(() => Net.snapshot.game.units.map(({ pendingMove, ...unit }) => unit)),
    ).toEqual(
      await japanese.evaluate(() =>
        Net.snapshot.game.units.map(({ pendingMove, ...unit }) => unit),
      ),
    );
  } finally {
    for (const context of contexts) await context.close();
    await app.close();
  }
});
