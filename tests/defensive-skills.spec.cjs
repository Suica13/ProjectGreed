const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const entry of ["client", "developer"])
  test(
    entry + " activates smoke from the skill button and draws it between ground and air units",
    async ({ page }) => {
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(pathToFileURL(path.resolve("public/" + entry + ".html")).href);
      await page.waitForFunction(() => assetsReady);
      const result = await page.evaluate(async () => {
        Net.leave();
        const entry = (id) => ({
          unitId: id,
          kitId: Object.values(UnitModels).find((m) => m.prefabId === id).kitId,
        });
        game = Rules.create(false, 1, [[entry("YMT_05")], [entry("FF_B2")]], false, {
          costLimit: 99999,
          unitCostLimit: 99999,
        });
        await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(game));
        game.tiles.forEach((row) => row.fill("plain"));
        game.fogMode = "disabled";
        const [a, b] = game.units;
        Object.assign(a, { x: 8, y: 8 });
        Object.assign(b, { x: 9, y: 8 });
        const before = a.en;
        selected = a.id;
        phase = "idle";
        battleView = null;
        setPageView("game");
        const panel = document.createElement("div");
        SkillControls.render(panel, a, true);
        const button = panel.querySelector('[data-unit-skill="SmokeGrenade"]');
        button.click();
        const orders = [],
          smoke = EnvironmentVisuals.smoke,
          draw = SpriteRenderer.draw;
        EnvironmentVisuals.smoke = (...args) => {
          orders.push("smoke");
          return smoke(...args);
        };
        SpriteRenderer.draw = (...args) => {
          orders.push("unit:" + UnitModels[args[1]].prefabId);
          return draw(...args);
        };
        MapCamera.setZoom(2);
        MapCamera.focus(8, 8, { preserveZoom: true });
        drawMap(performance.now());
        EnvironmentVisuals.smoke = smoke;
        SpriteRenderer.draw = draw;
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 200;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, 200, 200);
        smoke(ctx, game, () => ({ x: 100, y: 100 }), 30);
        const pixel = Array.from(ctx.getImageData(100, 100, 1, 1).data);
        return {
          orders,
          en: before - a.en,
          ap: a.actionPoints,
          fields: game.smokeFields.length,
          pixel,
        };
      });
      expect(result.fields).toBe(1);
      expect(result.en).toBe(100);
      expect(result.ap).toBe(3);
      expect(result.orders.indexOf("unit:YMT_05")).toBeLessThan(result.orders.indexOf("smoke"));
      expect(result.orders.indexOf("smoke")).toBeLessThan(result.orders.indexOf("unit:FF_B2"));
      expect(result.pixel[0]).toBeGreaterThan(150);
      await page.screenshot({ path: ".openai/smoke-" + entry + ".png" });
      expect(errors).toEqual([]);
    },
  );

test("I-field values and native impact effect follow projectile arrival rather than final snapshot timing", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(async () => {
    Net.leave();
    const target = Object.values(UnitModels).find((m) => m.prefabId === "RX_78GP03D");
    game = Rules.create(
      false,
      0,
      [
        [{ unitId: "RGM_79", kitId: "beam_spray" }],
        [{ unitId: target.prefabId, kitId: target.kitId }],
      ],
      false,
      { costLimit: 99999, unitCostLimit: 99999 },
    );
    await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(game));
    game.tiles.forEach((row) => row.fill("plain"));
    game.fogMode = "disabled";
    const [a, b] = game.units;
    Object.assign(a, { x: 8, y: 8 });
    Object.assign(b, { x: 11, y: 8, shield: 0 });
    const actors = structuredClone(game.units),
      before = Rules.iFieldHP(b),
      weapon = Rules.modelOf(a).weapons.find((w) => w.id === "EF_BeamSprayGun");
    const events = Rules.fight(game, a, b, weapon, "counter", null, false),
      record = {
        id: "field-impact",
        a: a.id,
        b: b.id,
        actors,
        events,
        before: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
      };
    MapCombat.reset();
    MapCombat.seed([record]);
    battleView = {
      ...record,
      battles: [record],
      networkId: record.id,
      index: 0,
      start: performance.now(),
      displayHp: record.before,
      completed: false,
    };
    phase = "battle";
    setPageView("game");
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const f = MapCombat.frame,
      contact = f.plan.contacts.find((c) => c.iFieldDamage > 0);
    if (!contact) throw Error("Fixture did not hit the field");
    f.time = contact.at - 0.001;
    const waiting = MapCombat.units().find((u) => u.id === b.id).iFieldHp;
    f.time = contact.at + 0.01;
    const after = MapCombat.units().find((u) => u.id === b.id).iFieldHp;
    let fieldDraws = 0;
    const draw = SpriteEffects.draw;
    SpriteEffects.draw = (...args) => {
      if (args[1] === "I_Field_2") fieldDraws++;
      return draw(...args);
    };
    MapCamera.setZoom(1.7);
    MapCamera.focus(11, 8, { preserveZoom: true });
    drawMap(performance.now());
    SpriteEffects.draw = draw;
    const description = SkillControls.defensiveAbilities(Rules.modelOf(b))[0].description;
    I18n.setLanguage("en");
    const english = SkillControls.defensiveAbilities(Rules.modelOf(b))[0].description;
    I18n.setLanguage("ja");
    const japanese = SkillControls.defensiveAbilities(Rules.modelOf(b))[0].description;
    I18n.setLanguage("zh");
    return {
      before,
      waiting,
      after,
      absorbed: contact.iFieldDamage,
      fieldDraws,
      description,
      english,
      japanese,
    };
  });
  expect(result.waiting).toBe(result.before);
  expect(result.after).toBe(result.before - result.absorbed);
  expect(result.fieldDraws).toBeGreaterThan(0);
  expect(result.description).toContain("95%");
  expect(result.english).toContain("Separate capacity");
  expect(result.japanese).toContain("独立耐久");
  await page.screenshot({ path: ".openai/i-field-impact.png" });
  expect(errors).toEqual([]);
});
