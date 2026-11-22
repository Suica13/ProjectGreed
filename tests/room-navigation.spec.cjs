const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js");

for (const width of [1280, 390]) {
  test(`room broadcasts preserve each player's base and contact page at ${width}px`, async ({
    browser,
  }) => {
    test.setTimeout(120000);
    const app = createServer({ host: "127.0.0.1", port: 0 });
    const address = await app.listen();
    const base = `http://127.0.0.1:${address.port}`;
    const contexts = [],
      pages = [],
      errors = [];
    const idle = (p) => p.waitForFunction(() => Net.active && Net.snapshot && !Net.awaiting);
    const act = async (p, action, fields = {}) => {
      await idle(p);
      await p.evaluate(({ action, fields }) => Net.request(action, fields), { action, fields });
      await idle(p);
    };
    const views = [
      "warehouse",
      "itemStorage",
      "facilities",
      "contactTasks",
      "contactMerchants",
      "formation",
      "pilots",
      "production",
      "development",
      "encyclopedia",
    ];
    try {
      for (let i = 0; i < 2; i++) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        contexts.push(context);
        const p = await context.newPage();
        pages.push(p);
        p.on("pageerror", (error) => errors.push(error.message));
        await p.goto(base);
        await p.waitForFunction(() => assetsReady);
        await p.evaluate(
          ({ base, i }) => {
            I18n.setLanguage("zh");
            byId("playerId").value = "Navigation " + i;
            Net.serverURL = base.replace("http:", "ws:") + "/ws";
            Net.room = "NAVIGATION";
            byId("newRoomMode").value = "quick";
            Net.connect(i === 0 ? "create" : "join", true);
          },
          { base, i },
        );
        await idle(p);
      }
      const [host, guest] = pages;
      const formationFor = (p) =>
        p.evaluate(() => {
          const id =
            Rules.getMap(Net.snapshot.settings.mapId).environment === "space"
              ? "ColumbusClass"
              : "Medea";
          const ship = Economy.storedUnits().find((item) => item.unitId === id);
          return [{ unitId: ship.unitId, kitId: ship.kitId, stockId: ship.id }];
        });
      const hostFormation = await formationFor(host),
        guestFormation = await formationFor(guest);
      const identity = await host.evaluate(() => ({
        id: Net.memberId,
        seat: Net.seat,
        room: Net.room,
      }));
      async function preserve(view) {
        await host.evaluate((view) => MenuShell.go(view), view);
        const expected = view === "pilots" ? "formation" : view;
        await expect.poll(() => host.evaluate(() => pageView)).toBe(expected);
        // Leaving the other player's formation triggers the real save/broadcast path.
        await guest.evaluate(() => MenuShell.go("formation"));
        await guest.locator("#shellItemStorage").click();
        await idle(guest);
        const revision = await host.evaluate(() => Net.revision);
        await act(guest, "update_formation", { formation: guestFormation });
        await host.waitForFunction((revision) => Net.revision > revision, revision);
        expect(await host.evaluate(() => pageView)).toBe(expected);
        await act(host, "sync");
        expect(await host.evaluate(() => pageView)).toBe(expected);
        expect(
          await host.evaluate(() => ({ id: Net.memberId, seat: Net.seat, room: Net.room })),
        ).toEqual(identity);
        await expect(guest.locator("#itemStorageScreen")).toBeVisible();
      }
      for (const view of views) await preserve(view);
      await act(host, "set_ready", { ready: true, formation: hostFormation });
      await act(guest, "set_ready", { ready: true, formation: guestFormation });
      expect(
        await guest.evaluate(
          () => Net.snapshot.members.find((member) => member.id === Net.memberId).ready,
        ),
      ).toBe(true);
      await host.evaluate(() => MenuShell.go("warehouse"));
      await act(host, "start_game", { formation: hostFormation });
      await expect.poll(() => host.evaluate(() => Net.snapshot.phase)).toBe("assembly");
      expect(await host.evaluate(() => pageView)).toBe("warehouse");
      for (const view of [
        "warehouse",
        "itemStorage",
        "facilities",
        "contactTasks",
        "contactMerchants",
      ])
        await preserve(view);
      await act(host, "confirm_formation");
      await act(guest, "confirm_formation");
      await host.waitForFunction(() => Net.snapshot.phase !== "assembly" && pageView === "game");
      await expect(host.locator("#gameScene")).toBeVisible();
      expect(errors).toEqual([]);
    } finally {
      await Promise.all(contexts.map((context) => context.close()));
      await app.close();
    }
  });
}
