const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("broken ship turrets retain their art and show small looping electricity at rotated attachment positions", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    const model = "SalamisClass__standard",
      m = UnitModels[model],
      module = m.modules[0],
      broken = { [module.id]: true };
    const healthy = SpriteRenderer.visibleLayers(model)
      .filter((l) => l.moduleId === module.id)
      .map((l) => l.name);
    const damaged = SpriteRenderer.visibleLayers(model, null, true, false, null, 0, false, broken)
      .filter((l) => l.moduleId === module.id)
      .map((l) => l.name);
    const canvas = document.createElement("canvas");
    canvas.width = 1100;
    canvas.height = 700;
    document.body.append(canvas);
    Object.assign(canvas.style, { position: "fixed", inset: "0", zIndex: 99999 });
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#152530";
    ctx.fillRect(0, 0, 1100, 700);
    const image = SpriteRenderer.images[ART.effects[ART.presentation.moduleDamage.effect].asset];
    const calls = [];
    const original = ctx.drawImage;
    ctx.drawImage = function (img, ...args) {
      if (img === image) {
        const t = ctx.getTransform();
        calls.push({ x: t.e, y: t.f, size: Math.hypot(t.a, t.b) });
      }
      return original.call(this, img, ...args);
    };
    const samples = [];
    for (const [i, angle] of [0, 90, 180, 270].entries()) {
      const actor = {
        x: 260 + (i % 2) * 550,
        y: 170 + Math.floor(i / 2) * 350,
        angle,
        scale: 0.65,
      };
      const before = calls.length;
      SpriteRenderer.draw(
        ctx,
        model,
        actor.x,
        actor.y,
        actor.scale,
        angle,
        null,
        0,
        null,
        false,
        true,
        false,
        broken,
      );
      const point = SpriteRenderer.modulePosition(model, module.id, actor);
      samples.push({
        calls: calls.slice(before),
        point,
        expectedSize:
          actor.scale * ART.presentation.moduleDamage.scale * ART.effects.Stun_1.scaleFrom,
      });
    }
    const before = calls.length;
    SpriteEffects.brokenModules(ctx, model, {}, { x: 0, y: 0, scale: 1, angle: 0 }, 10);
    const noHealthyEffect = calls.length === before;
    const loop = SpriteEffects.brokenModules(
      ctx,
      model,
      broken,
      { x: 20, y: 20, scale: 1, angle: 90 },
      100,
    );
    const unit = {
      model,
      hp: m.hp,
      en: m.en,
      moduleHp: Object.fromEntries(m.modules.map((v) => [v.id, v.id === module.id ? 0 : v.hp])),
      brokenParts: broken,
    };
    const weapon = m.weapons.find((w) => w.moduleIds?.includes(module.id));
    return {
      healthy,
      damaged,
      samples,
      noHealthyEffect,
      loop,
      scale: ART.presentation.moduleDamage.scale,
      disabled: !Rules.availableStrikes(unit, weapon).some((s) => s.moduleId === module.id),
    };
  });
  expect(result.healthy.length).toBeGreaterThan(0);
  expect(result.damaged).toEqual(result.healthy);
  expect(result.disabled).toBe(true);
  expect(result.noHealthyEffect).toBe(true);
  expect(result.loop).toBe(1);
  expect(result.scale).toBeLessThan(1);
  for (const sample of result.samples) {
    expect(sample.calls).toHaveLength(1);
    expect(sample.calls[0].x).toBeCloseTo(sample.point.x);
    expect(sample.calls[0].y).toBeCloseTo(sample.point.y);
    expect(sample.calls[0].size).toBeCloseTo(sample.expectedSize);
  }
  await page.screenshot({ path: ".openai/turret-damage-electric.png" });
  expect(errors).toEqual([]);
});
