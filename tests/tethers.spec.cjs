const { test } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");

test("Gouf heat rods and Ball K anchors render a native tip and an attached cable below unit sprites", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await SpriteRenderer.load();
    I18n.setLanguage("zh");
    Net.leave();
  });
  for (const unitId of ["MS_07B", "MS_07B3", "RB_79K"]) {
    const result = await page.evaluate((unitId) => {
      session++;
      MapCombat.reset();
      TurnFlow.reset();
      game = Rules.create(
        false,
        1,
        [[{ unitId, kitId: "standard" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
        false,
        { costLimit: 99999, unitCostLimit: 99999 },
      );
      const [a, b] = game.units;
      Object.assign(a, { x: 10, y: 7, dodgeSlot: 1 });
      Object.assign(b, { x: 12, y: 7 });
      game.tiles.forEach((row) => row.fill("plain"));
      const weapon = Rules.modelOf(a).weapons.find((w) => w.projectile?.motion === "tether");
      const actors = structuredClone([a, b]);
      const event = {
        from: a.id,
        to: b.id,
        weapon: weapon.id,
        hit: false,
        response: "evade",
        sourceDodgeSlot: 1,
        damage: 0,
        before: b.hp,
        after: b.hp,
        shieldBefore: b.shield,
        shieldAfter: b.shield,
      };
      const record = {
        id: "tether",
        a: a.id,
        b: b.id,
        actors,
        events: [event],
        before: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
      };
      selected = pending = weaponId = moving = null;
      mode = "select";
      phase = "battle";
      setPageView("game");
      MapCombat.seed([record]);
      battleView = {
        ...record,
        index: 0,
        start: performance.now(),
        displayHp: record.before,
        completed: false,
      };
      MapCombat.begin(battleView, () => 0);
      MapCombat.update(performance.now());
      const frame = MapCombat.frame,
        shot = frame.plan.shots[0];
      frame.time = shot.impactAt + 0.05;
      MapCombat.suspend(battleView);
      MapCamera.setZoom(4);
      MapCamera.focus(11, 7, { preserveZoom: true });
      const ctx = byId("map").getContext("2d"),
        originalStroke = ctx.stroke,
        originalDraw = SpriteRenderer.draw,
        originalImage = ctx.drawImage,
        order = [];
      ctx.stroke = function (...args) {
        if (this.strokeStyle === "#333333") order.push("cable");
        return originalStroke.apply(this, args);
      };
      SpriteRenderer.draw = function (...args) {
        order.push("unit");
        return originalDraw(...args);
      };
      ctx.drawImage = function (image, ...args) {
        if (image === SpriteRenderer.images[weapon.projectile.asset]) order.push("tip");
        return originalImage.call(this, image, ...args);
      };
      try {
        drawMap(performance.now());
      } finally {
        ctx.stroke = originalStroke;
        SpriteRenderer.draw = originalDraw;
        ctx.drawImage = originalImage;
      }
      return {
        order,
        name: weapon.name,
        melee: frame.plan.melee,
        loaded: SpriteRenderer.images[weapon.projectile.asset].complete,
        duration: frame.plan.duration,
      };
    }, unitId);
    assert.equal(result.name, unitId === "RB_79K" ? "缆绳锚" : "热能鞭");
    assert.equal(result.melee, null);
    assert.ok(result.loaded);
    assert.ok(result.duration < 3);
    assert.ok(result.order.indexOf("cable") >= 0);
    assert.ok(result.order.indexOf("cable") < result.order.indexOf("unit"));
    assert.ok(result.order.indexOf("tip") > result.order.indexOf("unit"));
    await page.screenshot({ path: ".openai/" + unitId + "-tether.png" });
    const stages = await page.evaluate(() => {
      const f = MapCombat.frame,
        shot = f.plan.shots[0],
        config = f.weapon.projectile.tether;
      return [
        shot.at + shot.flight / 2,
        shot.impactAt + 0.01,
        shot.impactAt + config.hold / f.plan.actionSpeed + config.retract / f.plan.actionSpeed / 2,
      ].map(
        (time) => WeaponEffects.tetherState(f.weapon, f.plan, shot, time, f.source, f.event).stage,
      );
    });
    assert.deepEqual(stages, ["extend", "contact", "retract"]);
  }
  assert.deepEqual(errors, []);
});
