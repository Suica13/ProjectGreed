const { test, expect } = require("@playwright/test"),
  { createServer } = require("../server.js");
test("two optimized browser clients decode updates, reconnect and finish a server-authoritative battle", async ({
  page,
  browser,
}) => {
  const app = createServer({ host: "127.0.0.1", port: 0, resultReturnMs: 60000 }),
    address = await app.listen(),
    base = `http://127.0.0.1:${address.port}`;
  const context = await browser.newContext(),
    guest = await context.newPage(),
    errors = [];
  for (const p of [page, guest]) p.on("pageerror", (e) => errors.push(e.message));
  const idle = async (p) => p.waitForFunction(() => Net.active && Net.snapshot && !Net.awaiting);
  const act = async (p, action, fields = {}) => {
    await idle(p);
    await p.evaluate(({ action, fields }) => Net.request(action, fields), { action, fields });
    await idle(p);
  };
  const lobby = async (p) => {
    await p.goto(base);
    await p.waitForFunction(() => assetsReady);
    await p.evaluate((base) => Lobby.reconnect(base), base);
    await expect(p.locator("#lobby")).toBeVisible();
  };
  try {
    await lobby(page);
    await page.locator("#createRoom").click();
    await page.locator("#roomCode").fill("PERFBATTLE");
    await page.locator('#roomCreateForm button[type="submit"]').click();
    await idle(page);
    await lobby(guest);
    await guest.locator(".room-card").filter({ hasText: "PERFBATTLE" }).getByRole("button").click();
    await idle(guest);
    for (const p of [page, guest])
      await p.evaluate(() => {
        window.wireTypes = [];
        Net.socket.addEventListener("message", (event) =>
          wireTypes.push(JSON.parse(event.data).type),
        );
      });
    const formation = [{ unitId: "Type61", kitId: "standard" }];
    await act(page, "set_ready", { ready: true, formation });
    await act(guest, "set_ready", { ready: true, formation });
    await act(page, "start_game", { formation });
    await act(page, "confirm_formation");
    await act(guest, "confirm_formation");
    await act(page, "confirm_deployment");
    await act(guest, "confirm_deployment");
    await expect.poll(() => page.evaluate(() => Net.snapshot.phase)).toBe("idle");
    for (const p of [page, guest])
      expect(await p.evaluate(() => wireTypes.includes("state_delta"))).toBe(true);
    const member = await page.evaluate(() => Net.memberId);
    await page.reload();
    await idle(page);
    expect(await page.evaluate(() => Net.memberId)).toBe(member);
    const room = app.rooms.get("PERFBATTLE"),
      attacker = room.game.units.find((u) => u.team === 0),
      target = room.game.units.find((u) => u.team === 1);
    room.game.tiles.forEach((row) => row.fill("plain"));
    Object.assign(attacker, { x: 2, y: 4 });
    Object.assign(target, { x: 4, y: 4, hp: 1, shield: 0 });
    room.game.seed = 1;
    await act(page, "sync");
    await act(guest, "sync");
    await act(page, "attack", {
      unitId: attacker.id,
      targetId: target.id,
      weaponId: "EF_Type61_Cannon",
    });
    await act(page, "end_turn");
    await guest.waitForFunction(() => Net.snapshot.phase === "reaction");
    await act(guest, "respond", { response: "evade" });
    await page.waitForFunction(() => Net.snapshot.phase === "playback");
    for (const p of [page, guest]) {
      const snapshot = await p.evaluate(() => Net.snapshot);
      await act(p, "playback_ready", { batchId: snapshot.playback.id, matchId: snapshot.matchId });
    }
    await page.waitForFunction(() => Net.snapshot.phase === "finished");
    expect(await page.evaluate(() => Net.snapshot.game.winner)).toBe(0);
    expect(
      await page.evaluate(() => Net.snapshot.economyAwards.some((a) => a.kind === "result")),
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await page.close();
    await app.close();
  }
});
