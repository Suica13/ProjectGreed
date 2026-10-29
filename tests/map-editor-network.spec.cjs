const { test, expect } = require("@playwright/test");
const { createServer } = require("../server.js"),
  G = require("../shared/rules.js");
const M = require("../shared/map-document.js");
test("HTTP editor entry and authored terrain work with two authoritative clients", async ({
  browser,
}) => {
  const doc = M.create({ id: "network_authored_map", name: "TileMap联机验证" });
  doc.layers[0].data[16 * doc.width + 20] = "terrain_rock";
  doc.layers[0].data[16 * doc.width + 19] = "terrain_forest";
  doc.layers[0].data[16 * doc.width + 21] = "terrain_snow";
  doc.tiles.find((t) => t.id === "terrain_snow").environment = "space";
  const map = M.compile(doc);
  G.catalog.maps[map.id] = map;
  const app = createServer({ host: "127.0.0.1", port: 0 }),
    address = await app.listen();
  const base = "http://127.0.0.1:" + address.port;
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  const [host, guest] = await Promise.all(contexts.map((c) => c.newPage()));
  const errors = [];
  const idle = (p) => p.waitForFunction(() => Net.active && Net.snapshot && !Net.awaiting);
  const act = async (p, action, fields = {}) => {
    await idle(p);
    await p.evaluate(({ action, fields }) => Net.request(action, fields), { action, fields });
    await idle(p);
  };
  try {
    await host.goto(base + "/map-editor.html");
    await host.waitForFunction(() => typeof MapEditor !== "undefined");
    expect(await host.title()).toContain("地图编辑器");
    for (const [i, p] of [host, guest].entries()) {
      p.on("pageerror", (e) => errors.push(e.message));
      await p.goto(base);
      await p.waitForFunction(() => assetsReady);
      await p.evaluate(
        ({ base, map }) => {
          Rules.catalog.maps[map.id] = map;
          Lobby.reconnect(base);
        },
        { base, map },
      );
      await expect(p.locator("#lobby")).toBeVisible();
      if (!i) {
        await p.locator("#createRoom").click();
        await p.locator("#roomCode").fill("MAPEDITOR");
        await p.locator('#roomCreateForm button[type="submit"]').click();
      } else
        await p.locator(".room-card").filter({ hasText: "MAPEDITOR" }).getByRole("button").click();
      await idle(p);
    }
    await host.evaluate(
      (id) => Net.request("configure_room", { ...Net.snapshot.settings, mapId: id }),
      map.id,
    );
    await idle(host);
    const formation = [{ unitId: "Type61", kitId: "standard" }];
    await act(guest, "set_ready", { ready: true, formation });
    await act(host, "start_game", { formation });
    await act(host, "confirm_formation");
    await act(guest, "confirm_formation");
    for (const p of [host, guest])
      await p.waitForFunction(() => phase === "deployment" && !BattleAssets.loading);
    await act(host, "confirm_deployment");
    await act(guest, "confirm_deployment");
    const room = app.rooms.get("MAPEDITOR"),
      unit = room.game.units.find((u) => u.team === 0);
    Object.assign(unit, { x: 18, y: 16 });
    for (const p of [host, guest]) await act(p, "sync");
    for (const p of [host, guest]) {
      await p.waitForFunction(
        (id) => game.mapId === id && phase === "idle" && !BattleAssets.loading,
        map.id,
      );
      expect(await p.evaluate(() => Net.snapshot.game.mapId)).toBe(map.id);
      expect(await p.evaluate(() => game.tiles[16][20])).toBe("rock");
      expect(await p.evaluate(() => Rules.cellEnvironment(game, 21, 16))).toBe("space");
    }
    await act(host, "move", { unitId: unit.id, x: 20, y: 16 });
    expect(unit.pendingMove).toBeUndefined();
    expect(unit.x).toBe(18);
    await act(host, "move", { unitId: unit.id, x: 19, y: 16 });
    expect(unit.pendingMove).toBeTruthy();
    await act(host, "confirm_move", { unitId: unit.id });
    expect(unit.x).toBe(19);
    expect(errors).toEqual([]);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
    await app.close();
    delete G.catalog.maps[map.id];
  }
});
