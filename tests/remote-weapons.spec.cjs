const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const entry of ["client", "developer"])
  test(entry + " renders staggered native remotes and wired return paths", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(pathToFileURL(path.resolve("public/" + entry + ".html")).href);
    await page.waitForFunction(() => assetsReady);
    const result = await page.evaluate(async () => {
      const ids = ["MAN_03", "MAN_08", "MSN_02", "MS_06Z", "MSN_01"];
      const units = ids.map((id, i) => ({
        id: "remote-" + i,
        model: id + "__standard",
        hp: 100000,
        en: 10000,
        x: 5,
        y: 5,
        pilot: { stats: { awakening: 100 } },
      }));
      const target = {
        id: "target",
        model: "RGM_79__machine_gun",
        hp: 100000,
        shield: 0,
        x: 8,
        y: 5,
      };
      await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys({ units: [...units, target] }));
      const canvas = document.createElement("canvas");
      canvas.id = "remote-test-canvas";
      canvas.width = 1200;
      canvas.height = 900;
      Object.assign(canvas.style, {
        position: "fixed",
        inset: "0",
        width: "1200px",
        height: "900px",
        zIndex: 999999,
        background: "#101824",
      });
      document.body.append(canvas);
      const ctx = canvas.getContext("2d");
      const rows = [];
      for (const [i, u] of units.entries()) {
        const w = UnitModels[u.model].weapons.find((w) => w.remote);
        const source = { unit: u, x: 70, y: 95 + i * 170, scale: 1.2, angle: 90 },
          to = { unit: target, x: 220, y: 95 + i * 170, scale: 1.2, angle: 270 };
        const event = {
          id: "visual-" + i,
          from: u.id,
          to: target.id,
          hit: true,
          before: 100000,
          after: 90000,
          damage: 10000,
        };
        const plan = WeaponEffects.plan(w, source, to, event);
        const used = plan.remotes.every((r) => SpriteRenderer.images[r.unit.asset]);
        ctx.fillStyle = "white";
        ctx.font = "14px sans-serif";
        ctx.fillText(
          UnitModels[u.model].name + " / " + w.remote.units.length + " remotes",
          15,
          i * 170 + 22,
        );
        for (const [column, time] of [0.3, 1.05, 2.18, 2.8].entries()) {
          ctx.save();
          ctx.translate(column * 300, 0);
          const hidden = plan.remotes
            .filter((r) => time >= r.launch && time < r.end)
            .flatMap((r) => r.unit.hideLayers || []);
          SpriteRenderer.draw(
            ctx,
            u.model,
            source.x,
            source.y,
            source.scale,
            90,
            null,
            0,
            null,
            true,
            true,
            false,
            {},
            90,
            true,
            false,
            "space",
            w.id,
            null,
            false,
            null,
            false,
            false,
            hidden,
          );
          SpriteRenderer.draw(ctx, target.model, to.x, to.y, to.scale, 270, null, 0);
          WeaponEffects.draw(ctx, w, plan, time, source, event, 1);
          ctx.restore();
        }
        const card = WeaponInfo.summary(w, { unit: u });
        rows.push({
          id: ids[i],
          used,
          shots: plan.shots.length,
          duration: plan.duration,
          gate: card.textContent,
          contactsBefore: WeaponEffects.arrived(plan, 0).length,
          contactsAfter: WeaponEffects.arrived(plan, plan.duration).length,
          finite: plan.shots.every(
            (s) => Number.isFinite(s.origin.x) && Number.isFinite(s.impactAt),
          ),
        });
      }
      const opaque = Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data).filter(
        (_, i) => i % 4 === 3 && _ > 0,
      ).length;
      return { rows, opaque };
    });
    for (const [i, row] of result.rows.entries()) {
      expect(row.used).toBe(true);
      expect(row.finite).toBe(true);
      expect(row.shots).toBe([8, 10, 4, 4, 4][i]);
      expect(row.duration).toBeGreaterThan(3);
      expect(row.contactsBefore).toBe(0);
      expect(row.contactsAfter).toBe(row.shots);
      expect(row.gate).toContain("75");
    }
    expect(result.opaque).toBeGreaterThan(10000);
    await page
      .locator("#remote-test-canvas")
      .screenshot({ path: ".openai/remote-" + entry + ".png" });
    expect(errors).toEqual([]);
  });

test("actual map playback reveals remote damage on contact and restores detached arms on return", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(async () => {
    Net.leave();
    game = Rules.create(
      false,
      1,
      [[{ unitId: "MSN_02", kitId: "standard" }], [{ unitId: "RGM_79", kitId: "machine_gun" }]],
      false,
      { costLimit: 99999, unitCostLimit: 99999 },
    );
    game.tiles.forEach((r) => r.fill("plain"));
    game.fogMode = "disabled";
    game.environment = "space";
    const [a, b] = game.units;
    Object.assign(a, {
      x: 8,
      y: 8,
      en: 1000,
      pilot: { stats: { awakening: 100, shooting: 100, accuracy: 100 } },
    });
    Object.assign(b, { x: 11, y: 8, hp: 100000, shield: 0 });
    await SpriteRenderer.ensureAssets(SpriteRenderer.battleKeys(game));
    const actors = JSON.parse(JSON.stringify(game.units)),
      w = Rules.modelOf(a).weapons.find((w) => w.remote);
    const events = Rules.fight(game, a, b, w, "defend", null, false);
    const record = {
      id: "remote-map",
      actors,
      events,
      before: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
    };
    setPageView("game");
    MapCombat.reset();
    MapCombat.seed([record]);
    battleView = { battles: [record], mapBattle: true, completed: false, start: performance.now() };
    phase = "battle";
    MapCombat.begin(battleView, () => 0);
    MapCombat.update(performance.now());
    const frame = MapCombat.frames[0];
    const initial = MapCombat.units().find((u) => u.id === b.id).hp;
    frame.time = 1.05;
    const deployed = MapCombat.units().find((u) => u.id === a.id).mapPose.hiddenLayers;
    const partial = MapCombat.units().find((u) => u.id === b.id).hp;
    frame.time = frame.plan.duration;
    const returned = MapCombat.units().find((u) => u.id === a.id).mapPose.hiddenLayers;
    const final = MapCombat.units().find((u) => u.id === b.id).hp;
    const count = frame.plan.shots.length,
      real = b.hp;
    phase = "idle";
    MapCombat.reset();
    battleView = null;
    return { initial, partial, final, real, deployed, returned, count };
  });
  expect(result.initial).toBe(100000);
  expect(result.count).toBe(4);
  expect(result.deployed).toEqual(expect.arrayContaining(["ArmL", "ArmR"]));
  expect(result.returned).toEqual([]);
  expect(result.final).toBe(result.real);
  expect(result.partial).toBeLessThan(result.initial);
  expect(result.partial).toBeGreaterThan(result.final);
  expect(errors).toEqual([]);
});
