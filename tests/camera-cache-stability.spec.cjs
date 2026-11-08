const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("same-frame camera input reuses bounds and invalidates them on the next frame and scroll", async ({
  page,
}) => {
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  await page.evaluate(() => {
    Net.leave();
    phase = "idle";
    setPageView("game");
    MapCamera.reset();
    update();
  });
  await page.evaluate(() => new Promise(requestAnimationFrame));
  const result = await page.evaluate(() => {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    const c = byId("map"),
      original = c.getBoundingClientRect.bind(c),
      box = original();
    let reads = 0;
    c.getBoundingClientRect = () => {
      reads++;
      return original();
    };
    MapCamera.beginFrame();
    for (let i = 0; i < 20; i++) {
      MapCamera.setZoom(MapCamera.zoom * 1.00001);
      cellAt({ clientX: box.left + 20, clientY: box.top + 20 });
    }
    const group = reads;
    MapCamera.beginFrame();
    MapCamera.inputBounds();
    const next = reads;
    window.dispatchEvent(new Event("scroll"));
    MapCamera.inputBounds();
    return { group, next, scrolled: reads };
  });
  expect(result.group).toBe(1);
  expect(result.next).toBe(2);
  expect(result.scrolled).toBe(3);
});

test("an active army above the old pixel ceiling stays warm instead of rebuilding every frame", async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "deviceMemory", { value: 8 }));
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    cancelAnimationFrame(animationFrameId);
    ClientSettings.unitShadows = () => false;
    const id = "Type61__standard",
      m = SpriteRenderer.models[id],
      texture = document.createElement("canvas");
    texture.width = texture.height = 240;
    texture.getContext("2d").fillRect(0, 0, 240, 240);
    SpriteRenderer.images.capacityTest = texture;
    m.bones = { body: { x: 0, y: 0 } };
    m.animations = { Static: { duration: 1, curves: {} } };
    m.decals = [{ name: "body", bone: "body", asset: "capacityTest" }];
    SpriteRenderer.releaseBattleResources(["capacityTest"]);
    const c = document.createElement("canvas");
    c.width = c.height = 100;
    const ctx = c.getContext("2d"),
      native = ctx.drawImage.bind(ctx);
    let direct = 0;
    ctx.drawImage = (source, ...args) => {
      if (source === texture) direct++;
      return native(source, ...args);
    };
    const now = performance.now;
    try {
      performance.now = () => 0;
      for (let frame = 0; frame < 2; frame++) {
        SpriteRenderer.beginFrame();
        direct = 0;
        for (let angle = 0; angle < 180; angle++)
          SpriteRenderer.draw(
            ctx,
            id,
            50,
            50,
            0.1,
            angle,
            "Static",
            0,
            null,
            true,
            true,
            false,
            {},
            angle,
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
            2048,
          );
        SpriteRenderer.endFrame();
      }
      const cache = SpriteRenderer.cacheStats();
      SpriteRenderer.releaseBattleResources();
      return { direct, cache, released: SpriteRenderer.cacheStats().idlePixels };
    } finally {
      performance.now = now;
    }
  });
  expect(result.cache.idlePixelLimit).toBe(32 * 1024 * 1024);
  expect(result.cache.idlePixels).toBeGreaterThan(16 * 1024 * 1024);
  expect(result.cache.idlePixels).toBeLessThanOrEqual(result.cache.idlePixelLimit);
  expect(result.cache.idle).toBe(180);
  expect(result.direct).toBe(0);
  expect(result.released).toBe(0);
});

test("low-memory devices retain the smaller cache ceiling", async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "deviceMemory", { value: 2 }));
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  expect(await page.evaluate(() => SpriteRenderer.cacheStats().idlePixelLimit)).toBe(
    16 * 1024 * 1024,
  );
});

test("an oversized working set keeps hot surfaces without reallocating or freezing idle animation", async ({
  page,
}) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "deviceMemory", { value: 2 }));
  await page.goto(url);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    cancelAnimationFrame(animationFrameId);
    ClientSettings.unitShadows = () => false;
    const id = "Type61__standard",
      m = SpriteRenderer.models[id],
      body = document.createElement("canvas");
    body.width = body.height = 240;
    body.getContext("2d").fillRect(0, 0, 240, 240);
    SpriteRenderer.images.oversizeBody = body;
    m.bones = { body: { x: 0, y: 0 } };
    m.animations = {
      Breathe: {
        duration: 2,
        curves: {
          body: {
            x: [
              [0, 0],
              [2, 80],
            ],
          },
        },
      },
    };
    m.decals = [{ name: "body", bone: "body", asset: "oversizeBody" }];
    SpriteRenderer.releaseBattleResources(["oversizeBody"]);
    const c = document.createElement("canvas");
    c.width = c.height = 150;
    const ctx = c.getContext("2d");
    const create = document.createElement.bind(document),
      now = performance.now;
    let allocations = 0;
    document.createElement = (tag, ...args) => {
      if (tag === "canvas") allocations++;
      return create(tag, ...args);
    };
    const frame = (time) => {
      SpriteRenderer.beginFrame();
      ctx.clearRect(0, 0, 150, 150);
      allocations = 0;
      for (let i = 0; i < 180; i++)
        SpriteRenderer.draw(
          ctx,
          id,
          i === 0 ? 75 : -1000,
          75,
          0.2,
          90 + i,
          "Breathe",
          time,
          null,
          true,
          true,
          false,
          {},
          90 + i,
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
          2048,
        );
      const pixels = ctx.getImageData(0, 0, 150, 150).data;
      let sum = 0,
        y = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        sum += pixels[i + 3];
        y += Math.floor(i / 4 / 150) * pixels[i + 3];
      }
      SpriteRenderer.endFrame();
      return { y: y / sum, allocations };
    };
    try {
      performance.now = () => 0;
      frame(0);
      const warm = frame(0),
        animated = frame(1.5),
        cache = SpriteRenderer.cacheStats();
      return { warm, animated, cache };
    } finally {
      document.createElement = create;
      performance.now = now;
      SpriteRenderer.releaseBattleResources();
    }
  });
  expect(result.cache.idle).toBeGreaterThan(0);
  expect(result.cache.idle).toBeLessThan(180);
  expect(result.cache.idlePixels).toBeLessThanOrEqual(16 * 1024 * 1024);
  expect(result.warm.allocations).toBe(0);
  expect(result.animated.allocations).toBe(0);
  expect(Math.abs(result.animated.y - result.warm.y)).toBeGreaterThan(8);
});
