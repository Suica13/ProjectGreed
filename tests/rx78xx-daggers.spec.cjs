const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("RX-78XX shows both shared dagger sprites throughout its melee sequence", async ({ page }) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  const results = await page.evaluate(async () => {
    await SpriteRenderer.load();
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 700;
    document.body.append(canvas);
    Object.assign(canvas.style, { position: "fixed", inset: "0", zIndex: 99999 });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#152530";
    ctx.fillRect(0, 0, 1200, 700);
    const models = Object.entries(UnitModels)
      .filter(([, m]) => m.prefabId === "RX_78XX")
      .map(([id, m]) => ({ ...m, id }));
    const out = [];
    for (const [row, m] of models.entries()) {
      const w = m.weapons.find((w) => w.id === "EF_BeamDagger_Double_AALDF");
      const counts = [];
      for (const time of [0, 0.2, 0.6, 1, 1.3]) {
        const pose = WeaponSequence.pose(w, time);
        const blades = (broken) =>
          SpriteRenderer.visibleLayers(
            m.id,
            w.id,
            true,
            false,
            pose.clip,
            pose.time,
            false,
            broken,
            true,
            false,
            "ground",
            w.id,
            pose.weaponDisplayIndex,
          ).filter((l) => l.texture === "EF_BeamDagger.png");
        counts.push([
          blades({}).length,
          blades({ leftArm: true }).map((l) => l.bone),
          blades({ rightArm: true }).map((l) => l.bone),
        ]);
      }
      const pose = WeaponSequence.pose(w, 0.6);
      for (const [col, broken] of [{}, { leftArm: true }, { rightArm: true }].entries()) {
        ctx.fillStyle = "#fff";
        ctx.font = "18px sans-serif";
        ctx.fillText(
          m.kitName + " / " + ["Both arms", "Left broken", "Right broken"][col],
          30 + col * 400,
          40 + row * 320,
        );
        SpriteRenderer.draw(
          ctx,
          m.id,
          200 + col * 400,
          180 + row * 320,
          4,
          90,
          pose.clip,
          pose.time,
          w.id,
          false,
          true,
          false,
          broken,
          90,
          true,
          false,
          "ground",
          w.id,
          pose.weaponDisplayIndex,
        );
      }
      const gun = m.weapons.find((w) => w.type !== "melee");
      out.push({
        counts,
        idle: SpriteRenderer.visibleLayers(m.id, gun.id).filter(
          (l) => l.texture === "EF_BeamDagger.png",
        ).length,
        hiddenCombo: m.weapons.some((w) => w.id === "EF_BeamDagger_Double_AALDE"),
      });
    }
    return out;
  });
  expect(results.length).toBeGreaterThan(0);
  for (const row of results) {
    for (const counts of row.counts) expect(counts).toEqual([2, ["RightArm"], ["LeftArm"]]);
    expect(row.idle).toBe(0);
    expect(row.hiddenCombo).toBe(false);
  }
  await page.screenshot({ path: ".openai/rx78xx-dual-daggers.png" });
});
