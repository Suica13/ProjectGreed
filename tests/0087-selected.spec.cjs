const { test, expect } = require("@playwright/test");
const path = require("node:path"),
  { pathToFileURL } = require("node:url");
for (const width of [1440, 390])
  test(`selected 0087 ships and prototypes render with complete artwork at ${width}px`, async ({
    page,
  }) => {
    test.setTimeout(90000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setViewportSize({ width, height: 960 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(async () => {
      I18n.setLanguage("zh");
      const ids = ["EndraClass", "NahelArgamaClass", "ORX_012", "ORX_013"];
      game = Rules.create(
        false,
        79,
        [
          ids.map((unitId) => ({
            unitId,
            kitId: ART.prefabs.find((p) => p.id === unitId).weaponKits[0].id,
          })),
          [{ unitId: "RGM_79", kitId: "machine_gun" }],
        ],
        false,
        { mapId: "asteroid_crossing_1v1", costLimit: 99999, unitCostLimit: 99999 },
      );
      game.tiles.forEach((r) => r.fill("plain"));
      game.environment = "space";
      game.fogMode = "disabled";
      game.units.forEach((u, i) =>
        Object.assign(u, { x: 10 + (i % 2) * 5, y: 6 + Math.floor(i / 2) * 5, angle: 90 }),
      );
      await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({ game }));
      phase = "idle";
      selected = game.units[0].id;
      setPageView("game");
      update();
      MapCamera.setPercent(70);
      MapCamera.focus(13, 8);
    });
    const assets = await page.evaluate(() =>
      game.units.slice(0, 4).map((u) => ({
        id: u.prefabId || Rules.modelOf(u).prefabId,
        layers: SpriteRenderer.visibleLayers(u.model)
          .filter((l) => !l.moduleId || u.hp > 0)
          .map((l) => ({ name: l.name, loaded: !!SpriteRenderer.images[l.asset]?.naturalWidth })),
      })),
    );
    for (const unit of assets) {
      expect(unit.layers.length).toBeGreaterThanOrEqual(4);
      expect(unit.layers.every((l) => l.loaded)).toBe(true);
    }
    await page.screenshot({ path: `tmp/verification/screenshots/0087-selected-${width}.png` });
    await page.evaluate(() => {
      const gallery = document.createElement("div");
      gallery.id = "verificationUnitGallery";
      gallery.style.cssText =
        "position:fixed;inset:0;z-index:99999;background:#121e29;display:grid;grid-template-columns:1fr 1fr;align-content:center;gap:12px;padding:16px;box-sizing:border-box;color:white";
      for (const id of ["EndraClass", "NahelArgamaClass", "ORX_012", "ORX_013"]) {
        const card = document.createElement("section"),
          label = document.createElement("div"),
          canvas = document.createElement("canvas");
        const model = Object.keys(ART.models).find((key) => ART.models[key].prefabId === id);
        label.textContent = ART.models[model].name;
        canvas.width = 600;
        canvas.height = 360;
        canvas.style.cssText = "width:100%;height:auto;background:#1b2b39";
        card.append(label, canvas);
        gallery.append(card);
        UnitPreview.renderPreview(model, canvas);
      }
      document.body.append(gallery);
    });
    await page
      .locator("#verificationUnitGallery")
      .screenshot({ path: `tmp/verification/screenshots/0087-selected-preview-${width}.png` });
    expect(errors).toEqual([]);
  });
