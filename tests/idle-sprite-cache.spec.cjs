const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
test("overview sprites reuse surfaces, preserve live effects and bypass moving or damaged actors", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    const id = "Type61__standard",
      model = SpriteRenderer.models[id];
    const texture = (color, size) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").fillStyle = color;
      c.getContext("2d").fillRect(0, 0, size, size);
      return c;
    };
    const body = texture("#ff0000", 20),
      effect = texture("#0080ff", 8);
    SpriteRenderer.images["idle-body-test"] = body;
    SpriteRenderer.images["idle-effect-test"] = effect;
    model.bones.cacheTest = { x: 0, y: 0 };
    model.animations.CacheIdle = { duration: 1, curves: {} };
    model.decals = [
      { name: "body", bone: "cacheTest", asset: "idle-body-test" },
      {
        name: "effect",
        bone: "cacheTest",
        asset: "idle-effect-test",
        independentClock: true,
        rotationSpeed: 30,
        visibleWhen: { sustainedThrust: true },
      },
    ];
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 300;
    const ctx = canvas.getContext("2d");
    const create = document.createElement.bind(document),
      image = ctx.drawImage.bind(ctx);
    let allocations = 0,
      bodyCalls = 0,
      effectCalls = 0;
    document.createElement = (tag, ...args) => {
      if (tag === "canvas") allocations++;
      return create(tag, ...args);
    };
    ctx.drawImage = (source, ...args) => {
      if (source === body) bodyCalls++;
      if (source === effect) effectCalls++;
      return image(source, ...args);
    };
    const draw = (time, moving = false, broken = {}) => {
      SpriteRenderer.beginFrame();
      SpriteRenderer.draw(
        ctx,
        id,
        150,
        150,
        1,
        0,
        "CacheIdle",
        time,
        null,
        true,
        true,
        moving,
        broken,
        0,
        false,
        false,
        "space",
        null,
        null,
        false,
        null,
        false,
        false,
        [],
        128,
      );
    };
    try {
      for (let i = 0; i < 120; i++) draw(i / 60);
      const cached = { allocations, bodyCalls, effectCalls };
      draw(3, true);
      const movingBodyCalls = bodyCalls;
      draw(4, false, { part: true });
      const damagedBodyCalls = bodyCalls;
      model.decals.reverse();
      ctx.clearRect(0, 0, 300, 300);
      draw(5);
      const prefixPixel = [...ctx.getImageData(150, 150, 1, 1).data];
      model.decals.reverse();
      model.animations.CacheBreathe = {
        duration: 2,
        curves: {
          cacheTest: {
            x: [
              [0, 0],
              [2, 20],
            ],
          },
        },
      };
      const breathe = (time) => {
        ctx.clearRect(0, 0, 300, 300);
        SpriteRenderer.beginFrame();
        SpriteRenderer.draw(
          ctx,
          id,
          150,
          150,
          1,
          0,
          "CacheBreathe",
          time,
          null,
          true,
          true,
          false,
          {},
          0,
          false,
          false,
          "space",
          null,
          null,
          false,
          null,
          false,
          false,
          [],
          128,
        );
        const pixels = ctx.getImageData(120, 120, 60, 60).data;
        let total = 0,
          x = 0,
          y = 0;
        for (let i = 0; i < pixels.length; i += 4)
          if (pixels[i] > 200 && pixels[i + 2] < 20) {
            total++;
            x += (i / 4) % 60;
            y += Math.floor(i / 4 / 60);
          }
        return { x: x / total, y: y / total };
      };
      const a = breathe(0),
        b = breathe(0.5);
      ClientSettings.unitShadows = () => true;
      globalThis.ProjectGreedMapLighting = {
        direction: "lower",
        horizontalAngle: 0,
        distance: 0.25,
        intensity: 0.25,
        heightScale: 1,
      };
      ctx.clearRect(0, 0, 300, 300);
      SpriteRenderer.beginFrame();
      SpriteRenderer.draw(
        ctx,
        id,
        150,
        150,
        1,
        0,
        "CacheIdle",
        0,
        null,
        true,
        true,
        false,
        {},
        0,
        false,
        false,
        "ground",
        null,
        null,
        false,
        null,
        false,
        false,
        [],
        128,
      );
      return {
        cached,
        movingBodyCalls,
        damagedBodyCalls,
        prefixPixel,
        breatheMotion: Math.abs(a.x - b.x) + Math.abs(a.y - b.y),
        shadowAlpha: ctx.getImageData(150, 174, 1, 1).data[3],
      };
    } finally {
      document.createElement = create;
    }
  });
  expect(result.cached.allocations).toBe(1);
  expect(result.cached.bodyCalls).toBe(0);
  expect(result.cached.effectCalls).toBe(120);
  expect(result.movingBodyCalls).toBe(1);
  expect(result.damagedBodyCalls).toBe(2);
  expect(result.prefixPixel).toEqual([255, 0, 0, 255]);
  expect(result.breatheMotion).toBeGreaterThan(2);
  expect(result.shadowAlpha).toBe(64);
});

test("a slow raster budget still warms every actor and refreshes idle poses fairly", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    const id = "Type61__standard",
      model = SpriteRenderer.models[id];
    const texture = document.createElement("canvas");
    texture.width = texture.height = 20;
    texture.getContext("2d").fillRect(0, 0, 20, 20);
    SpriteRenderer.images.slowBakeTexture = texture;
    model.bones.slowBake = { x: 0, y: 0 };
    model.animations.SlowBake = {
      duration: 10,
      curves: {
        slowBake: {
          x: [
            [0, 0],
            [10, 10],
          ],
        },
      },
    };
    model.decals = [{ name: "body", bone: "slowBake", asset: "slowBakeTexture" }];
    const screen = document.createElement("canvas");
    screen.width = screen.height = 300;
    const ctx = screen.getContext("2d");
    const originalGet = HTMLCanvasElement.prototype.getContext,
      originalNow = performance.now,
      patched = new WeakSet(),
      paints = new Map();
    let now = 0,
      bodyCalls = 0;
    const image = ctx.drawImage.bind(ctx);
    ctx.drawImage = (source, ...args) => {
      if (source === texture) bodyCalls++;
      return image(source, ...args);
    };
    performance.now = () => now;
    HTMLCanvasElement.prototype.getContext = function (...args) {
      const context = originalGet.apply(this, args);
      if (
        context &&
        args[0] === "2d" &&
        this !== screen &&
        this !== texture &&
        !patched.has(context)
      ) {
        patched.add(context);
        const canvas = this,
          draw = context.drawImage.bind(context);
        context.drawImage = (...values) => {
          now += 3;
          paints.set(canvas, (paints.get(canvas) || 0) + 1);
          return draw(...values);
        };
      }
      return context;
    };
    try {
      for (let frame = 0; frame < 48; frame++) {
        SpriteRenderer.beginFrame();
        if (frame === 40) bodyCalls = 0;
        for (let i = 0; i < 8; i++)
          SpriteRenderer.draw(
            ctx,
            id,
            150,
            150,
            1,
            i * 30,
            "SlowBake",
            frame / 6,
            null,
            true,
            true,
            false,
            {},
            i * 30,
            false,
            false,
            "space",
            null,
            null,
            false,
            null,
            false,
            false,
            [],
            128,
          );
      }
      return {
        surfaces: paints.size,
        paintCounts: [...paints.values()],
        fallbacksAfterWarmup: bodyCalls,
      };
    } finally {
      performance.now = originalNow;
      HTMLCanvasElement.prototype.getContext = originalGet;
    }
  });
  expect(result.surfaces).toBe(8);
  expect(result.fallbacksAfterWarmup).toBe(0);
  for (const count of result.paintCounts) expect(count).toBeGreaterThanOrEqual(3);
});
