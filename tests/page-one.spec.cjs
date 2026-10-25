const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("Page_00 roster shows native icons, support skills and explicit pending mechanic labels", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.locator("#openFormation").click();
  await page.locator('[data-unit-id="Type74"]').click();
  await page.locator("#addFormationUnit").click();
  await page
    .locator(".formation-row")
    .last()
    .getByRole("button", { name: "详情", exact: true })
    .click();
  await expect(page.locator("#formationUnitDetail")).toContainText("自动补给");
  await expect(page.locator("#formationUnitDetail")).toContainText("战场侦察");
  await expect(page.locator("#formationUnitDetail")).toContainText("待接入");
  await page.screenshot({ path: ".openai/page-one-support-unit.png" });
  expect(errors).toEqual([]);
});
test("unarmed aircraft render and space ship death uses the large space sequence through its final frame", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    const aircraft = ART.prefabs.find((p) => p.id === "Medea"),
      model = "Medea__" + aircraft.weaponKits[0].id;
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 800;
    const ctx = canvas.getContext("2d");
    SpriteRenderer.draw(ctx, model, 300, 300, 1, 90, "ImportedIdle", 0, null);
    const unit = {
      id: "ship-death",
      model: "SalamisClass__standard",
      environment: "space",
      x: 5,
      y: 5,
      angle: 90,
    };
    const sequence = WeaponEffects.deathSequence(unit);
    const drawn = [];
    const original = SpriteEffects.draw;
    SpriteEffects.draw = function (...args) {
      const value = original(...args);
      if (value) drawn.push(args[1]);
      return value;
    };
    WeaponEffects.drawDeath(ctx, sequence, unit, 300, 300, 1, 0);
    WeaponEffects.drawDeath(ctx, sequence, unit, 300, 300, 1, 2.1);
    SpriteEffects.draw = original;
    return {
      weaponCount: ART.models[model].weapons.length,
      events: sequence.events.length,
      main: sequence.effect,
      drawn,
      duration: sequence.duration,
    };
  });
  expect(result.weaponCount).toBe(0);
  expect(result.events).toBe(11);
  expect(result.main).toBe("Common_Explosion_MA_Space_1");
  expect(result.drawn).toContain("LargeUnitDie_1_Space");
  expect(result.drawn).toContain("Common_Explosion_MA_Space_1");
  expect(result.duration).toBeGreaterThan(6);
  expect(errors).toEqual([]);
});
