const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("native tanks render turrets, hidden equipment stays invisible and all rings precede sprites", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    const ids = ["Type61", "Type61A5", "MTank_Eins", "PegasusClass"];
    const army = ids.map((id) => ({
      unitId: id,
      kitId: ART.prefabs.find((p) => p.id === id).weaponKits[0].id,
    }));
    game = Rules.create(false, 1, [army, [{ unitId: "RGM_79", kitId: "machine_gun" }]], false, {
      mapId: "frontier_1v1",
      costLimit: 99999,
      unitCostLimit: 10000,
    });
    game.tiles.forEach((r) => r.fill("plain"));
    phase = "idle";
    selected = game.units[0].id;
    game.units.forEach((u, i) =>
      Object.assign(u, { x: 18 + i * 3, y: i === 3 ? 10 : 6, angle: 90 }),
    );
    setPageView("game");
    update();
    MapCamera.setZoom(3);
    MapCamera.focus(22, 8, { preserveZoom: true });
    const nativeLayers = [];
    for (const u of game.units.slice(0, 3))
      for (const turret of Rules.modelOf(u).visualTurrets) {
        const layer = SpriteRenderer.visibleLayers(u.model).find((l) => l.bone === turret.bone);
        if (!layer || !SpriteRenderer.images[layer.asset]?.naturalWidth)
          throw Error("missing turret " + u.model);
        nativeLayers.push(layer.name);
      }
    const order = [],
      ring = UnitIdentity.drawRing,
      draw = SpriteRenderer.draw;
    UnitIdentity.drawRing = (...a) => {
      order.push("ring");
      return ring(...a);
    };
    SpriteRenderer.draw = (...a) => {
      order.push("sprite");
      return draw(...a);
    };
    drawMap(performance.now());
    UnitIdentity.drawRing = ring;
    SpriteRenderer.draw = draw;
    const rx = Object.values(UnitModels).find((m) => m.prefabId === "RX_78_2");
    const visible = SpriteRenderer.visibleLayers(rx.prefabId + "__" + rx.kitId).map((l) => l.name);
    return {
      nativeLayers,
      lastRing: order.lastIndexOf("ring"),
      firstSprite: order.indexOf("sprite"),
      visible,
    };
  });
  expect(result.nativeLayers.length).toBeGreaterThanOrEqual(3);
  expect(result.lastRing).toBeLessThan(result.firstSprite);
  expect(
    result.visible.some(
      (n) => n.startsWith("EF_BeamJavelin_BF") || n.startsWith("EF_BeamSaber_Double_AALDF"),
    ),
  ).toBe(false);
  await page.screenshot({ path: ".openai/native-turrets-and-rings.png" });
  expect(errors).toEqual([]);
});
