const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");

test("moving static bodies preserve thrust, walking, visibility windows and damaged parts", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    cancelAnimationFrame(animationFrameId);
    ClientSettings.unitShadows = () => false;
    const id = "RGM_79__machine_gun",
      m = SpriteRenderer.models[id];
    const image = (key, color, size) => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      c.getContext("2d").fillStyle = color;
      c.getContext("2d").fillRect(0, 0, size, size);
      SpriteRenderer.images[key] = c;
      return c;
    };
    const body = image("reuse-body", "#ff0000", 20),
      jet = image("reuse-jet", "#0080ff", 4);
    m.bones = { body: { x: 0, y: 0 }, jet: { x: 0, y: 16 } };
    m.animations = {
      Static: { duration: 1, curves: {} },
      Walk: {
        duration: 1,
        curves: {
          body: {
            x: [
              [0, 0],
              [1, 12],
            ],
          },
        },
      },
    };
    m.decals = [
      { name: "body", bone: "body", asset: "reuse-body", requiredParts: ["arm"] },
      {
        name: "jet",
        bone: "jet",
        asset: "reuse-jet",
        independentClock: true,
        visibleWhen: { moving: true },
      },
    ];
    const c = document.createElement("canvas");
    c.width = c.height = 200;
    const ctx = c.getContext("2d"),
      native = ctx.drawImage.bind(ctx);
    let bodies = 0,
      jets = 0;
    ctx.drawImage = (source, ...args) => {
      if (source === body) bodies++;
      if (source === jet) jets++;
      return native(source, ...args);
    };
    const draw = (clip, time, moving, broken = {}, cache = 2048) => {
      ctx.clearRect(0, 0, 200, 200);
      SpriteRenderer.beginFrame();
      SpriteRenderer.draw(
        ctx,
        id,
        100,
        100,
        1,
        90,
        clip,
        time,
        null,
        true,
        true,
        moving,
        broken,
        90,
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
        cache,
      );
      return [...ctx.getImageData(100, 100, 1, 1).data];
    };
    for (let i = 0; i < 30; i++) draw("Static", i / 60, true);
    const moving = { bodies, jets };
    draw("Walk", 0, true);
    draw("Walk", 0.5, true);
    const walkingBodies = bodies;
    const broken = draw("Static", 0, true, { arm: true });
    draw("Static", 0, false);
    const stoppedJets = jets;
    // Visibility is sampled at the current animation time, even within one frame.
    m.decals = [
      {
        name: "window",
        bone: "body",
        asset: "reuse-body",
        animationVisibility: { clip: "Static", start: 0.2, end: 0.4, visibleInside: true },
      },
    ];
    SpriteRenderer.beginFrame();
    const visible = SpriteRenderer.visibleLayers(id, null, true, false, "Static", 0.3, true).length;
    const invisible = SpriteRenderer.visibleLayers(
      id,
      null,
      true,
      false,
      "Static",
      0.5,
      true,
    ).length;
    const a = draw("Static", 0.3, false, {}, 0),
      b = draw("Static", 0.3, false, {}, 2048);
    const frames = document.createElement("canvas");
    frames.width = 40;
    frames.height = 20;
    const framesContext = frames.getContext("2d");
    framesContext.fillStyle = "#ff0000";
    framesContext.fillRect(0, 0, 20, 20);
    framesContext.fillStyle = "#0000ff";
    framesContext.fillRect(20, 0, 20, 20);
    SpriteRenderer.images.walkFrames = frames;
    m.decals = [{ name: "body", bone: "body", asset: "walkFrames", frames: 2, frameFps: 10 }];
    SpriteRenderer.releaseBattleResources(["walkFrames"]);
    const animatedFrame = draw("Static", 0.1, true);
    return { moving, walkingBodies, broken, stoppedJets, visible, invisible, a, b, animatedFrame };
  });
  expect(result.moving).toEqual({ bodies: 0, jets: 30 });
  expect(result.walkingBodies).toBe(2);
  expect(result.broken[3]).toBe(0);
  expect(result.stoppedJets).toBe(33);
  expect(result.visible).toBe(1);
  expect(result.invisible).toBe(0);
  expect(result.a).toEqual(result.b);
  expect(result.b).toEqual([255, 0, 0, 255]);
  expect(result.animatedFrame).toEqual([0, 0, 255, 255]);
});

test("shared walking samples stay current across frames and fall back live when baking is over budget", async ({
  page,
}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.waitForFunction(() => assetsReady);
  const result = await page.evaluate(() => {
    cancelAnimationFrame(animationFrameId);
    ClientSettings.unitShadows = () => false;
    const id = "RGM_79__machine_gun",
      m = SpriteRenderer.models[id];
    const body = document.createElement("canvas");
    body.width = body.height = 12;
    body.getContext("2d").fillStyle = "#ff0000";
    body.getContext("2d").fillRect(0, 0, 12, 12);
    SpriteRenderer.images.walkReuse = body;
    m.bones = { body: { x: 0, y: 0 } };
    m.decals = [{ name: "body", bone: "body", asset: "walkReuse" }];
    m.animations = {
      Walk: {
        duration: 1,
        curves: {
          body: {
            x: [
              [0, 0],
              [1, 20],
            ],
          },
        },
      },
      Static: { duration: 1, curves: {} },
    };
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 100;
    const ctx = canvas.getContext("2d"),
      native = ctx.drawImage.bind(ctx);
    let bodyCalls = 0;
    ctx.drawImage = (source, ...args) => {
      if (source === body) bodyCalls++;
      return native(source, ...args);
    };
    const draw = (time, x, cache = 2048, clip = "Walk") =>
      SpriteRenderer.draw(
        ctx,
        id,
        x,
        50,
        1,
        90,
        clip,
        time,
        null,
        true,
        true,
        clip === "Walk",
        {},
        90,
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
        cache,
      );
    const centroid = () => {
      const data = ctx.getImageData(0, 0, 400, 100).data;
      let total = 0,
        x = 0,
        y = 0;
      for (let i = 0; i < data.length; i += 4) {
        const alpha = data[i + 3];
        total += alpha;
        x += ((i / 4) % 400) * alpha;
        y += Math.floor(i / 4 / 400) * alpha;
      }
      return { x: x / total, y: y / total };
    };
    const frame = (time, cache) => {
      SpriteRenderer.beginFrame();
      ctx.clearRect(0, 0, 400, 100);
      bodyCalls = 0;
      for (let i = 0; i < 8; i++) draw(time, 30 + i * 45, cache);
      const value = { ...centroid(), bodyCalls };
      SpriteRenderer.endFrame();
      return value;
    };
    const a = frame(0.1, 2048),
      b = frame(0.6, 2048),
      reference = frame(0.6, 0);
    // Two independent animation phases of one rig in a single frame must not
    // reuse one another's pixels, or rebuild the same surface repeatedly.
    SpriteRenderer.beginFrame();
    draw(0.3, 30);
    draw(0.3, 75);
    ctx.clearRect(0, 0, 400, 100);
    bodyCalls = 0;
    draw(0.8, 30);
    const distinct = { ...centroid(), bodyCalls };
    SpriteRenderer.endFrame();
    const distinctReference = (() => {
      ctx.clearRect(0, 0, 400, 100);
      draw(0.8, 30, 0);
      return centroid();
    })();
    const originalNow = performance.now;
    let clock = 0;
    try {
      performance.now = () => (clock += 3);
      SpriteRenderer.beginFrame();
      draw(0, 30, 64, "Static");
      ctx.clearRect(0, 0, 400, 100);
      bodyCalls = 0;
      for (let i = 0; i < 8; i++) draw(0.9, 30 + i * 45);
      const budget = { ...centroid(), bodyCalls };
      SpriteRenderer.endFrame();
      const budgetReference = frame(0.9, 0);
      return { a, b, reference, distinct, distinctReference, budget, budgetReference };
    } finally {
      performance.now = originalNow;
      SpriteRenderer.endFrame();
    }
  });
  expect(result.a.bodyCalls).toBe(1);
  expect(result.b.bodyCalls).toBe(1);
  expect(Math.abs(result.b.x - result.reference.x)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.b.y - result.reference.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(result.a.x - result.b.x) + Math.abs(result.a.y - result.b.y)).toBeGreaterThan(8);
  expect(result.distinct.bodyCalls).toBe(1);
  expect(result.distinct.x).toBeCloseTo(result.distinctReference.x, 5);
  expect(result.distinct.y).toBeCloseTo(result.distinctReference.y, 5);
  expect(result.budget.bodyCalls).toBe(8);
  expect(result.budget.x).toBeCloseTo(result.budgetReference.x, 5);
  expect(result.budget.y).toBeCloseTo(result.budgetReference.y, 5);
});
