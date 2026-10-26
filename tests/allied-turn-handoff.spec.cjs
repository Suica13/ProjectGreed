const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");
for (const humanTeam of [0, 1])
  test(`two human allies on team ${humanTeam + 1} ending against two AI clear the waiting HUD`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90000);
    const app = createServer({ host: "127.0.0.1", port: 0, aiDelayMs: 20 });
    const address = await app.listen();
    const other = await context.newPage();
    const errors = [];
    async function connect(client, mode) {
      client.on("pageerror", (e) => errors.push(e.message));
      await client.goto(`http://127.0.0.1:${address.port}`);
      await expect(client.locator("#openSkirmish")).toBeEnabled();
      await client.evaluate(
        ({ port, mode }) => {
          Lobby.endpoint = () => `ws://127.0.0.1:${port}/ws`;
          Net.connect(mode, false, "ALLYAI");
        },
        { port: address.port, mode },
      );
      await expect.poll(() => client.evaluate(() => !!Net.snapshot)).toBe(true);
    }
    async function act(client, action, fields = {}) {
      await expect.poll(() => client.evaluate(() => !Net.awaiting)).toBe(true);
      await client.evaluate(({ action, fields }) => Net.request(action, fields), {
        action,
        fields,
      });
      await expect.poll(() => client.evaluate(() => !Net.awaiting)).toBe(true);
    }
    try {
      await connect(page, "create");
      await act(page, "configure_room", {
        mapId: "crossroads_2v2",
        costLimit: 99999,
        unitCostLimit: 99999,
        unitLimit: 3,
      });
      await connect(other, "join");
      if (humanTeam === 0) await act(other, "switch_seat", { seat: 2 });
      else await act(page, "switch_seat", { seat: 3 });
      for (const seat of humanTeam === 0 ? [1, 3] : [0, 2]) await act(page, "add_ai", { seat });
      expect(await other.evaluate(() => Net.seat)).toBe(humanTeam === 0 ? 2 : 1);
      const formation = Array(3).fill({ unitId: "RGM_79", kitId: "machine_gun" });
      await act(other, "set_ready", { ready: true, formation });
      await act(page, "start_game", { formation });
      await act(page, "confirm_formation");
      await act(other, "confirm_formation");
      await act(page, "confirm_deployment");
      await act(other, "confirm_deployment");
      const room = app.rooms.get("ALLYAI");
      async function waitForHumanTurn() {
        const deadline = Date.now() + 30000;
        while (room.game.team !== humanTeam && Date.now() < deadline) {
          for (const client of [page, other]) {
            if (await client.evaluate(() => phase === "reaction" && !Net.awaiting))
              await act(client, "respond", { response: "defend" });
          }
          await new Promise((r) => setTimeout(r, 100));
        }
        expect(room.game.team).toBe(humanTeam);
      }
      for (let cycle = 0; cycle < 2; cycle++) {
        await waitForHumanTurn();
        await expect.poll(() => page.evaluate(() => phase), { timeout: 15000 }).toBe("idle");
        const round = room.game.round;
        for (const client of [page, other]) {
          await expect(client.locator("#endTurn")).toBeEnabled();
          await client.locator("#endTurn").click();
          await expect(client.locator("#endActionConfirm")).toBeVisible();
        }
        if (cycle === 0) {
          await page.locator("#confirmEndAction").click();
          await expect(page.locator("#hint")).toContainText("已结束个人行动");
          await other.locator("#confirmEndAction").click();
        } else {
          await Promise.all(
            [page, other].map((client) => client.locator("#confirmEndAction").click()),
          );
        }
        for (const client of [page, other]) {
          await expect
            .poll(() => client.evaluate(() => Net.snapshot.game.round), { timeout: 15000 })
            .toBeGreaterThan(round);
          expect(await client.evaluate(() => Net.snapshot.turnDone[Net.seat])).toBe(false);
          await expect(client.locator("#hint")).not.toContainText("已结束个人行动");
        }
        // Let the AI finish its real movement/planning, answering any human reactions.
        await waitForHumanTurn();
      }
      expect(errors).toEqual([]);
    } catch (error) {
      const room = app.rooms.get("ALLYAI");
      console.error("Handoff failure", error.message, {
        phase: room?.phase,
        round: room?.game.round,
        team: room?.game.team,
        turnDone: room?.turnDone,
        seats: room?.seats.map(p => p && ({ seat: p.seat, bot: !!p.bot })),
      });
      throw error;
    } finally {
      await other.close();
      await page.close();
      app.server.closeAllConnections();
      await app.close();
    }
  });
