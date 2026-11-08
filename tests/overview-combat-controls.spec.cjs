const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
for (const width of [1600, 390])
  test(`overview keeps icons static and effects live, controls stack at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    const result = await page.evaluate(async () => {
      Net.leave();
      await SpriteRenderer.load();
      const e = { unitId: "RGM_79", kitId: "machine_gun" };
      game = Rules.create(false, 7319, [[e], [e]], false);
      game.tiles.forEach((row) => row.fill("plain"));
      const [a, b] = game.units;
      Object.assign(a, { x: 8, y: 8, hp: 100000, shield: 0 });
      Object.assign(b, { x: 10, y: 8, hp: 100000, shield: 0 });
      const actors = structuredClone([a, b]),
        weapon = Rules.modelOf(a).weapons.find((w) => Rules.canAttack(game, a, b, w));
      const events = Rules.fight(game, a, b, weapon, "defend", null);
      const record = {
        id: "overview-combat",
        a: a.id,
        b: b.id,
        actors,
        events,
        before: Object.fromEntries(actors.map((u) => [u.id, u.hp])),
      };
      phase = "battle";
      mode = "select";
      selected = null;
      weaponId = moving = null;
      setPageView("game");
      MapCamera.setPercent(3);
      MapCamera.focus(9, 8, { preserveZoom: true });
      update();
      cancelAnimationFrame(animationFrameId);
      animationFrameId = null;
      MapCombat.reset();
      MapCombat.seed([record]);
      battleView = {
        ...record,
        networkId: record.id,
        index: 0,
        start: performance.now(),
        displayHp: { ...record.before },
        completed: false,
      };
      MapCombat.begin(battleView, () => 0);
      MapCombat.update(performance.now());
      const f = MapCombat.frame;
      f.time = f.plan.lead + 0.1;
      f.lastNow = performance.now();
      const state = JSON.stringify(game.units);
      const original = {
        draw: SpriteRenderer.draw,
        symbol: UnitIdentity.drawMapSymbol,
        effect: WeaponEffects.draw,
        firing: WeaponEffects.firingPose,
      };
      let sprites = 0,
        symbols = 0,
        effects = 0, firing = 0;
      WeaponEffects.firingPose = (...args) => { firing++; return original.firing(...args); };
      SpriteRenderer.draw = (...args) => {
        sprites++;
        return original.draw(...args);
      };
      UnitIdentity.drawMapSymbol = (...args) => {
        symbols++;
        return original.symbol(...args);
      };
      WeaponEffects.draw = (...args) => {
        effects++;
        return original.effect(...args);
      };
      try {
        drawMap(performance.now());
        const low = {
          sprites,
          symbols,
          effects,
          firing,
          poses: MapCombat.units()
            .filter((u) => u.mapPose)
            .map((u) => ({ clip: u.mapPose.clip, moving: u.mapPose.moving })),
        };
        const threshold = [0, 1, 4.99, 5, 5.01].map((value) => {
          MapCamera.setPercent(value);
          return { value, icons: MapCamera.unitThumbnails };
        });
        MapCamera.setPercent(5.01);
        sprites = symbols = 0;
        drawMap(performance.now());
        const high = {
          sprites,
          symbols,
          firing,
          clip: MapCombat.units().find((u) => u.id === f.event.from).mapPose.clip,
        };
        const rect = (id) => byId(id).getBoundingClientRect().toJSON();
        const phaseRect = byId("mapWrap")
          .querySelector(".phase-row")
          .getBoundingClientRect()
          .toJSON();
        const zoom = byId("mapWrap")
          .querySelector(".map-camera-controls")
          .getBoundingClientRect()
          .toJSON();
        return {
          low,
          high,
          threshold,
          phaseRect,
          zoom,
          playback: rect("mapCombatControls"),
          unchanged: state === JSON.stringify(game.units),
        };
      } finally {
        SpriteRenderer.draw = original.draw;
        UnitIdentity.drawMapSymbol = original.symbol;
        WeaponEffects.draw = original.effect;
        WeaponEffects.firingPose = original.firing;
      }
    });
    expect(result.low.sprites).toBe(0);
    expect(result.low.symbols).toBeGreaterThan(0);
    expect(result.low.effects).toBeGreaterThan(0);
    expect(result.low.firing).toBe(0);
    expect(result.low.poses.length).toBeGreaterThan(0);
    for (const pose of result.low.poses) {
      expect(pose.clip).toBeNull();
      expect(pose.moving).toBe(false);
    }
    expect(result.threshold.map((x) => x.icons)).toEqual([true, true, true, true, false]);
    expect(result.high.sprites).toBeGreaterThan(0);
    expect(result.high.symbols).toBe(0);
    expect(result.high.firing).toBeGreaterThan(0);
    expect(result.zoom.top).toBeGreaterThanOrEqual(result.phaseRect.bottom);
    expect(result.playback.top).toBeGreaterThanOrEqual(result.zoom.bottom);
    expect(result.zoom.left).toBeCloseTo(result.phaseRect.left, 0);
    expect(result.playback.width).toBeLessThanOrEqual(180);
    expect(result.unchanged).toBe(true);
  });
