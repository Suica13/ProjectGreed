const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const entry of ["client", "developer"])
  test(
    entry + " renders native charge and a scalable beam without fog clipping",
    async ({ page }) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve("public/" + entry + ".html")).href);
      await page.waitForFunction(() => assetsReady);
      const result = await page.evaluate(async () => {
        Net.leave();
        game = Rules.create(
          false,
          1,
          [
            [
              {
                unitId: "RX_78_4_Bst",
                kitId: Rules.catalog.prefabs.find((p) => p.id === "RX_78_4_Bst").weaponKits[0].id,
              },
            ],
            [{ unitId: "RGM_79", kitId: "machine_gun" }],
          ],
          false,
          { costLimit: 99999, unitCostLimit: 99999 },
        );
        await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(game));
        game.tiles.forEach((row) => row.fill("plain"));
        const [u, v] = game.units;
        Object.assign(u, { x: 5, y: 8, brokenParts: { head: true } });
        Object.assign(v, { x: 14, y: 8, hp: 1000000 });
        const skill = Rules.unitSkills(u).find((s) => s.type === "irradiation"),
          event = Rules.useSkill(game, u, skill.id, 6, 8);
        const panel = document.createElement("div");
        SkillControls.render(panel, u, true);
        const canvas = document.createElement("canvas");
        canvas.width = 900;
        canvas.height = 600;
        const ctx = canvas.getContext("2d");
        const draws = [],
          original = ctx.drawImage.bind(ctx);
        ctx.drawImage = (...args) => {
          draws.push({
            key: Object.keys(SpriteRenderer.images).find(
              (k) => SpriteRenderer.images[k] === args[0],
            ),
            width: args[7],
          });
          original(...args);
        };
        SpriteEffects.setFogClip(new Path2D(), ctx);
        let completed = false;
        IrradiationFX.reset();
        IrradiationFX.start({ ...event, id: "beam-test" }, () => (completed = true));
        const position = (x, y) => ({ x: x * 40, y: y * 40 });
        IrradiationFX.draw(ctx, 1000, position, 40);
        const charge = draws.length;
        draws.length = 0;
        IrradiationFX.draw(ctx, 1000 + skill.chargeSeconds * 1000 + 400, position, 40);
        const parts = draws.map((d) => d.key),
          widths = draws.map((d) => d.width);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        const visible = pixels.some((a, i) => i % 4 === 3 && a > 0),
          transparent = pixels.some((a, i) => i % 4 === 3 && a === 0);
        IrradiationFX.reset();
        IrradiationFX.start({ ...event, id: "wide-beam", to: { x: 25, y: 8 } }, () => {});
        draws.length = 0;
        IrradiationFX.draw(ctx, 1000, position, 40);
        draws.length = 0;
        IrradiationFX.draw(ctx, 1000 + skill.chargeSeconds * 1000 + 400, position, 40);
        const longer = draws[1].width;
        IrradiationFX.reset();
        SpriteEffects.setFogClip(null, ctx);
        IrradiationFX.start({
          ...event,
          id: "screenshot-beam",
          elapsedSeconds: skill.chargeSeconds + 0.4,
        });
        phase = "idle";
        battleView = null;
        setPageView("game");
        MapCamera.setZoom(2);
        MapCamera.focus(10, 8, { preserveZoom: true });
        drawMap(performance.now());
        return {
          charge,
          parts,
          widths,
          longer,
          visible,
          transparent,
          buttons: panel.querySelectorAll("button[data-unit-skill]").length,
        };
      });
      expect(result.charge).toBe(1);
      expect(result.parts).toHaveLength(3);
      expect(result.longer).toBeGreaterThan(result.widths[1]);
      expect(result.visible).toBe(true);
      expect(result.transparent).toBe(true);
      expect(result.buttons).toBeGreaterThan(0);
      await page.screenshot({ path: ".openai/irradiation-" + entry + ".png" });
      expect(errors).toEqual([]);
    },
  );

test("red thrusters require active boost; normal and broken GM shield art are mutually exclusive", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    const rows = [];
    for (const [id, m] of Object.entries(UnitModels)) {
      const red = ART.prefabs
        .find((p) => p.id === m.prefabId)
        .layers.filter((l) => /red/i.test(l.texture || "") && /boost/i.test(l.name));
      if (!red.length) continue;
      const layers = (active) =>
        SpriteRenderer.visibleLayers(
          id,
          null,
          true,
          true,
          null,
          0,
          false,
          {},
          false,
          false,
          "space",
          null,
          null,
          false,
          active,
        );
      rows.push({
        id,
        off: layers(false).filter((l) => red.some((r) => r.name === l.name)).length,
        on: layers(true).filter((l) => red.some((r) => r.name === l.name)).length,
        blue: layers(false).some((l) => /boost/i.test(l.name) && !/red/i.test(l.texture || "")),
      });
    }
    const id = Object.keys(UnitModels).find((id) => UnitModels[id].prefabId === "RGM_79HC");
    const shield = (visible) => SpriteRenderer.visibleLayers(id, null, visible).map((l) => l.name);
    return { rows, intact: shield(true), broken: shield(false) };
  });
  expect(result.rows.length).toBeGreaterThan(5);
  for (const r of result.rows) {
    expect(r.off, r.id).toBe(0);
    expect(r.on, r.id).toBeGreaterThan(0);
    expect(r.blue, r.id).toBe(true);
  }
  expect(result.intact).toContain("Shield");
  expect(result.intact).not.toContain("Shield_Breaked");
  expect(result.broken).toContain("Shield_Breaked");
  expect(result.broken).not.toContain("Shield");
});
