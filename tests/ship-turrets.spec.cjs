const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
async function open(page) {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
}
test("all source ship turret sprites exist and render above or below hull according to their native attachment", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 2000, height: 1420 });
  await open(page);
  const result = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1980;
    canvas.height = 1400;
    Object.assign(canvas.style, { position: "fixed", inset: 0, zIndex: 99999 });
    document.body.append(canvas);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#152530";
    ctx.fillRect(0, 0, 1980, 1400);
    const rows = [];
    for (const [i, p] of ART.prefabs.filter((p) => p.stats.ship).entries()) {
      const model = p.id + "__" + p.weaponKits[0].id;
      const visible = SpriteRenderer.visibleLayers(model);
      const hull = visible.filter((l) => ["Body", "Body_2", "Hull"].includes(l.name));
      const body = hull[0],
        image = SpriteRenderer.images[body.asset];
      const scale = Math.min(
        0.9,
        280 / (image.height * body.scale),
        240 / (image.width * body.scale),
      );
      const x = (i % 6) * 330 + 165,
        y = Math.floor(i / 6) * 350 + 180;
      ctx.fillStyle = "#dde5ed";
      ctx.font = "16px sans-serif";
      ctx.fillText(p.id, x - 155, y - 145);
      SpriteRenderer.draw(
        ctx,
        model,
        x,
        y,
        scale,
        90,
        null,
        0,
        null,
        false,
        true,
        false,
        {},
        -90,
        false,
      );
      const issues = [];
      for (const module of p.stats.modules) {
        const layers = visible.filter((l) => l.moduleId === module.id);
        if (layers.length !== module.visual.decals.length) issues.push(module.id + " art");
        for (const layer of layers) {
          if (!SpriteRenderer.images[layer.asset]?.naturalWidth)
            issues.push(module.id + " texture");
          if (
            module.visual.belowHull
              ? layer.order >= Math.min(...hull.map((l) => l.order))
              : layer.order <= Math.max(...hull.map((l) => l.order))
          )
            issues.push(module.id + " order");
        }
      }
      rows.push({
        id: p.id,
        modules: p.stats.modules.length,
        sprites: visible.filter((l) => l.moduleId).length,
        issues,
      });
    }
    return rows;
  });
  expect(result).toHaveLength(24);
  expect(result.reduce((n, r) => n + r.modules, 0)).toBe(275);
  expect(result.reduce((n, r) => n + r.sprites, 0)).toBe(206);
  for (const row of result) expect(row.issues, row.id).toEqual([]);
  await page.screenshot({ path: ".openai/all-ship-turrets.png", fullPage: true });
  expect(errors).toEqual([]);
});
test("Salamis rear turrets rest facing aft, only firing legal turrets aim, and display aim cannot change traverse checks", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await open(page);
  const result = await page.evaluate(() => {
    const model = "SalamisClass__standard",
      m = UnitModels[model],
      art = SpriteRenderer.models[model];
    const rear = m.modules.find((v) => v.id.endsWith("BeamCannon_L2")),
      layer = art.decals.find((l) => l.moduleId === rear.id);
    const beam = m.weapons.find((w) => w.moduleIds?.includes(rear.id));
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d");
    function draw(aim, firing) {
      const visible = SpriteRenderer.visibleLayers(model, beam.id),
        values = {};
      let at = 0;
      const original = ctx.drawImage;
      ctx.drawImage = function (...args) {
        const l = visible[at++],
          t = ctx.getTransform();
        values[l.name] = (Math.atan2(t.b, t.a) * 180) / Math.PI;
        return original.apply(this, args);
      };
      SpriteRenderer.draw(
        ctx,
        model,
        200,
        200,
        1,
        90,
        null,
        0,
        beam.id,
        false,
        true,
        false,
        {},
        aim,
        firing,
      );
      ctx.drawImage = original;
      return values;
    }
    const idleForward = draw(0, false),
      idleOther = draw(160, false),
      firing = draw(90 + rear.idleDir + 20, true),
      restored = draw(90 + rear.idleDir, false);
    const expected = 90 + rear.idleDir + (layer.rotation || 0) + (layer.scaleX < 0 ? 180 : 0);
    const unit = { model, x: 10, y: 10, angle: 90, hp: m.hp, en: m.en };
    const center = Rules.center(unit),
      r = ((90 + rear.idleDir) * Math.PI) / 180;
    const target = {
      model: "RGM_79__machine_gun",
      x: center.x + Math.sin(r) * 6,
      y: center.y - Math.cos(r) * 6,
      hp: 100,
      team: 1,
    };
    const availability = [];
    for (const aim of [0, 90, 180, 270, -500]) {
      unit.aimAngle = aim;
      availability.push(
        Rules.availableStrikes(unit, beam, target)
          .map((s) => s.moduleId)
          .join(","),
      );
    }
    const before = unit.angle;
    Rules.faceTarget(unit, target);
    return {
      idle: idleForward[layer.name],
      expected,
      idleOther: idleOther[layer.name],
      restored: restored[layer.name],
      firing: firing[layer.name],
      availability,
      hullUnchanged: unit.angle === before,
      other: m.modules
        .filter((v) => !beam.moduleIds.includes(v.id))
        .map((v) => ({ idle: idleForward[v.id], firing: firing[v.id] }))
        .filter((v) => v.idle !== undefined),
    };
  });
  const wrap = (a) => ((((a + 180) % 360) + 360) % 360) - 180;
  expect(Math.abs(wrap(result.idle - result.expected))).toBeLessThan(0.0001);
  expect(result.idleOther).toBeCloseTo(result.idle);
  expect(result.restored).toBeCloseTo(result.idle);
  expect(Math.abs(wrap(result.firing - result.idle - 20))).toBeLessThan(0.0001);
  expect(result.hullUnchanged).toBe(true);
  expect(new Set(result.availability).size).toBe(1);
  for (const other of result.other) expect(other.firing).toBeCloseTo(other.idle);
  expect(errors).toEqual([]);
});
