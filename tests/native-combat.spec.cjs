const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function start(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
}
test("native sniper swaps holding and firing layers and anchors its muzzle to firing art", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const result = await page.evaluate(() => {
    const model = Object.entries(ART.models).find(([, m]) => m.prefabId === "RGM_79_G_SP")[0],
      w = ART.models[model].weapons.find((w) => w.id === "EF_LongRangeBeamSniperRifle"),
      pose = WeaponSequence.pose(w, w.attack.shots[0]);
    const holding = SpriteRenderer.visibleLayers(model, w.id, true, false, null, 0).map(
        (l) => l.name,
      ),
      firing = SpriteRenderer.visibleLayers(model, w.id, true, false, pose.clip, pose.time).map(
        (l) => l.name,
      );
    const canvas = document.createElement("canvas");
    canvas.width = 900;
    canvas.height = 500;
    document.body.replaceChildren(canvas);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#14232c";
    ctx.fillRect(0, 0, 900, 500);
    SpriteRenderer.draw(ctx, model, 250, 250, 2, 90, null, 0, w.id, false);
    SpriteRenderer.draw(ctx, model, 650, 250, 2, 90, pose.clip, pose.time, w.id, false);
    return { holding, firing, mount: w.muzzle.mounts[0], clip: pose.clip };
  });
  expect(result.holding).toContain("EF_LongRangeBeamSniperRifle_Idle");
  expect(result.holding).not.toContain("EF_LongRangeBeamSniperRifle_Attack");
  expect(result.firing).toContain("EF_LongRangeBeamSniperRifle_Attack");
  expect(result.firing).not.toContain("EF_LongRangeBeamSniperRifle_Idle");
  expect(result.mount.layer).toBe("EF_LongRangeBeamSniperRifle_Attack");
  await page.screenshot({ path: ".openai/native-sniper-poses.png" });
  expect(errors).toEqual([]);
});
test("Guntank cannon is above body, Guncannon kit art is exclusive and mortar points along its fast arc", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await start(page);
  const result = await page.evaluate(() => {
    const tanks = ART.prefabs
      .filter((p) => ["RX_75", "RX_75R", "RMV_1"].includes(p.id))
      .map((p) => ({
        id: p.id,
        body: p.layers.find((l) => l.name === "Body").order,
        cannons: p.layers
          .filter(
            (l) => l.name.includes("Cannon") || (p.id === "RMV_1" && l.name.startsWith("Head")),
          )
          .map((l) => l.order),
      }));
    const p = ART.prefabs.find((p) => p.id === "RX_77_2"),
      kits = p.weaponKits.map((k) => ({
        name: k.name,
        weapons: k.weapons,
        layers: SpriteRenderer.visibleLayers(p.id + "__" + k.id, k.weapons[0], true, false).map(
          (l) => l.name,
        ),
      }));
    const model = "RGC_80__machine_gun",
      w = ART.models[model].weapons.find((w) => w.special?.type === "mortar"),
      a = { unit: { id: "a", model }, x: 100, y: 200, angle: 90, scale: 1 },
      b = { unit: { id: "b", model }, x: 600, y: 200, angle: -90, scale: 1 },
      plan = WeaponEffects.plan(w, a, b, { hit: false, empty: true });
    return {
      tanks,
      kits,
      mortar: {
        rotation: w.projectile.rotation,
        flights: plan.shots.map((s) => s.flight),
        origins: plan.shots.map((s) => s.origin),
        destinations: plan.shots.map((s) => s.destination),
      },
    };
  });
  for (const t of result.tanks) {
    expect(t.cannons.length).toBeGreaterThan(0);
    for (const order of t.cannons) expect(order).toBeGreaterThan(t.body);
  }
  expect(result.kits.map((k) => k.name).sort()).toEqual(["加农炮套件", "导弹套件"].sort());
  for (const k of result.kits) {
    if (k.name === "导弹套件") {
      expect(k.layers).toContain("RX_77_2_SML");
      expect(k.layers).not.toContain("RX_77_2_Cannon");
      expect(k.weapons).not.toContain("Common_DoubleCannon");
      expect(k.weapons).not.toContain("Common_MortarDouble");
    } else {
      expect(k.layers).toContain("RX_77_2_Cannon");
      expect(k.layers).not.toContain("RX_77_2_SML");
    }
  }
  expect(result.mortar.rotation).toBe(0);
  for (const f of result.mortar.flights) {
    expect(f).toBeGreaterThanOrEqual(0.36);
    expect(f).toBeLessThanOrEqual(0.9);
  }
  expect(result.mortar.origins.every((o, i) => o.x < result.mortar.destinations[i].x)).toBe(true);
  expect(errors).toEqual([]);
});
