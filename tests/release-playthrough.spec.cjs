const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server.js"),
  G = require("../shared/rules.js");
test("two clients keep their room across production, resolve combat, settle inventory and reconnect after returning", async ({
  browser,
}) => {
  test.setTimeout(65000);
  const app = createServer({ host: "127.0.0.1", port: 0, resultReturnMs: 3000 }),
    address = await app.listen(),
    contexts = [],
    pages = [],
    errors = [];
  async function connect(name) {
    const context = await browser.newContext({ locale: "zh-CN" });
    contexts.push(context);
    await context.addInitScript(() => {
      if (!localStorage.getItem("release-seeded")) {
        localStorage.setItem("projectgreed.combatFaction", "EFSF");
        localStorage.setItem("projectgreed.language", "zh");
        localStorage.setItem(
          "slg-formations-v1.EFSF",
          JSON.stringify({
            version: 3,
            squads: [{ name: "Release", units: [{ unitId: "Type61", kitId: "standard" }] }],
          }),
        );
        localStorage.setItem("release-seeded", "1");
      }
    });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    pages.push(page);
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("http://127.0.0.1:" + address.port);
    await page.waitForFunction(() => assetsReady);
    await page.locator("#playerId").fill(name);
    await page.locator("#openSkirmish").click();
    await page.locator("#openRooms").click();
    await page.locator("#serverAddress").fill("127.0.0.1:" + address.port);
    await page.locator("#connectServer").click();
    await expect(page.locator("#lobby")).toBeVisible();
    return page;
  }
  async function request(page, action, fields = {}) {
    await page.waitForFunction(() => !Net.awaiting);
    const before = await page.evaluate(() => Net.revision);
    await page.evaluate(({ action, fields }) => Net.request(action, fields), { action, fields });
    await page.waitForFunction((revision) => !Net.awaiting && Net.revision > revision, before);
  }
  async function exchange(blue, red) {
    const room = app.rooms.get("RELEASE"),
      [a, b] = room.game.units;
    const weapon = G.modelOf(a).weapons.find((w) => G.canAttack(room.game, a, b, w));
    expect(weapon).toBeTruthy();
    await request(blue, "attack", { unitId: a.id, targetId: b.id, weaponId: weapon.id });
    await request(blue, "end_turn");
    await expect(red.locator("#reaction")).toBeVisible();
    await red.locator("#responseDefend").click();
    await red.locator("#confirmResponse").click();
    for (const p of [blue, red])
      await p.waitForFunction(
        () =>
          Net.snapshot.phase !== "reaction" &&
          Net.snapshot.phase !== "playback" &&
          phase !== "battle",
        null,
        { timeout: 15000 },
      );
  }
  try {
    const blue = await connect("ReleaseBlue");
    await blue.locator("#createRoom").click();
    await blue.locator("#roomCode").fill("RELEASE");
    await blue.locator('#roomCreateForm button[type="submit"]').click();
    await expect(blue.locator("#roomPreparation")).toBeVisible();
    const red = await connect("ReleaseRed");
    await red.locator(".room-card").filter({ hasText: "RELEASE" }).getByRole("button").click();
    await expect(red.locator("#roomPreparation")).toBeVisible();
    await request(blue, "configure_room", {
      fogMode: "disabled",
      costLimit: 900,
      unitCostLimit: 250,
      unitLimit: 12,
    });
    const member = await blue.evaluate(() => Net.memberId),
      stock = await blue.evaluate(() => Economy.quantity("Type61"));
    await blue.locator("#shellHangar").click();
    await blue.locator("#shellProduction").click();
    await blue.locator("#productionSearch").fill("Type61");
    await blue.locator('#productionList [data-unit-id="Type61"]').click();
    await blue.locator("#produceUnit").click();
    expect(await blue.evaluate(() => Economy.quantity("Type61"))).toBe(stock + 3);
    expect(await blue.evaluate(() => Net.memberId)).toBe(member);
    await blue.locator("#shellDevelopment").click();
    await blue.locator("#shellLobby").click();
    await expect(blue.locator("#roomPreparation")).toBeVisible();
    await red.locator("#toggleReady").click();
    await expect(blue.locator("#startRoomGame")).toBeEnabled();
    await blue.locator("#startRoomGame").click();
    for (const p of [blue, red]) await p.locator("#confirmFinalFormation").click();
    for (const p of [blue, red]) await p.locator("#confirmDeployment").click();
    await blue.waitForFunction(() => Net.snapshot.phase === "idle" && !Net.awaiting);
    const room = app.rooms.get("RELEASE"),
      g = room.game,
      [a, b] = g.units;
    g.tiles.forEach((row) => row.fill("plain"));
    Object.assign(a, { x: 3, y: 8 });
    Object.assign(b, { x: 8, y: 8 });
    g.seed = 0;
    await request(blue, "move", { unitId: a.id, x: 4, y: 8 });
    expect(a.pendingMove).toBeTruthy();
    await request(blue, "confirm_move", { unitId: a.id });
    expect(a.x).toBe(4);
    const hp = b.hp;
    await exchange(blue, red);
    expect(b.hp).toBeLessThan(hp);
    expect(g.team).toBe(1);
    await request(red, "end_turn");
    await blue.waitForFunction(() => Net.snapshot.game.team === 0 && !Net.awaiting);
    b.hp = 1;
    g.seed = 0;
    const money = await blue.evaluate(() => Economy.snapshot().money),
      redStock = await red.evaluate(() => Economy.quantity("Type61"));
    await exchange(blue, red);
    await expect(blue.locator("#victory")).toBeVisible();
    expect(await blue.evaluate(() => Economy.snapshot().money)).toBeGreaterThan(money);
    expect(await red.evaluate(() => Economy.quantity("Type61"))).toBe(redStock - 1);
    await blue.screenshot({ path: ".openai/release-victory.png" });
    for (const p of [blue, red])
      await expect(p.locator("#roomPreparation")).toBeVisible({ timeout: 10000 });
    const wallet = await blue.evaluate(() => Economy.snapshot());
    await blue.reload();
    await blue.waitForFunction(() => assetsReady && Net.active && Net.room === "RELEASE");
    expect(await blue.evaluate(() => Net.memberId)).toBe(member);
    expect(await blue.evaluate(() => Economy.snapshot())).toEqual(wallet);
    expect(errors).toEqual([]);
  } finally {
    for (const c of contexts) await c.close();
    await app.close();
  }
});
