const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"), path = require("node:path");

test("native beam segments load, animate and render without an ordinary bullet", async ({ page }) => {
  test.setTimeout(60000);
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(async () => {
    const rows = [
      ["RX_78GP03D", "EF_RX_78GP03D_BeamCannon"],
      ["MA_08", "ZN_MA_08_BeamCannon"],
      ["AMX_014", "NZN_AMX_014_BR"],
      ["AMX_014", "NZN_AMX_014_BeamCannon"],
      ["RGZ_91", "EF_RGZ_91_BWS_HighBeamCannon"],
      ["RGZ_91B", "EF_RGZ_91B_HighBeamCannon"],
      ["MSN_04", "NZN_MSN_04_HighBeamCannon"],
    ];
    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 840; canvas.id = "beamFixture";
    canvas.style.cssText = "position:fixed;inset:0;z-index:999999;background:#17212b;width:1200px;height:840px";
    document.body.append(canvas);
    const ctx = canvas.getContext("2d"), results = [];
    for (let i = 0; i < rows.length; i++) {
      const [id, key] = rows[i], model = Object.values(Rules.models)
        .find(m => m.prefabId === id && m.weapons.some(w => w.id === key));
      const keys = SpriteRenderer.battleKeys({ units: [{ model: model.prefabId + "__" + model.kitId }] });
      await SpriteRenderer.ensureAssets(keys);
      const weapon = structuredClone(model.weapons.find(w => w.id === key));
      delete weapon.muzzleEffects;
      const sequence = weapon.projectile.sequence, crops = [];
      ctx.fillStyle = "#ffffff"; ctx.font = "15px sans-serif";
      ctx.fillText(id + " / " + key, 15, 20 + i * 115);
      for (let column = 0; column < 3; column++) {
        const start = 20 + column * 395, y = 65 + i * 115;
        const shot = { at: 0, flight: 1, visibleUntil: 1, origin: { x: start, y }, destination: { x: start + 350, y } };
        const draw = ctx.drawImage.bind(ctx);
        ctx.drawImage = (...args) => { crops.push(args.slice(1, 5)); draw(...args); };
        WeaponEffects.draw(ctx, weapon, { shots: [shot] }, [0.2, 0.5, 0.8][column], { scale: 0.7 }, null);
        ctx.drawImage = draw;
        ctx.fillStyle = "#65caff"; ctx.fillRect(start, y - 3, 3, 6);
      }
      results.push({ id, loaded: sequence.segments.every(s => keys.includes(s.asset) && SpriteRenderer.images[s.asset]),
        calls: crops.length, segments: sequence.segments.length, differentFrames: new Set(crops.map(c => c[0])).size });
    }
    return results;
  });
  for (const row of result) {
    expect(row.loaded, row.id).toBe(true);
    expect(row.calls).toBe(row.segments * 3);
    expect(row.differentFrames).toBeGreaterThan(1);
  }
  await page.locator("#beamFixture").screenshot({ path: "tmp/verification/screenshots/beam-projectiles.png" });
  expect(errors).toEqual([]);
});
