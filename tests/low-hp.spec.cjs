const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const url = pathToFileURL(path.resolve("public/client.html")).href;
test("map low HP effect loops on live units and stops immediately when HP recovers", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await openPresentationFixture(page, false);
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(animationFrameId);
    animationFrameId = null;
    const u = game.units[0];
    u.hp = 1000;
    const ctx = byId("map").getContext("2d"),
      original = ctx.drawImage,
      image = SpriteRenderer.images[ART.effects.Stun_1.asset],
      frames = [];
    ctx.drawImage = function (img, ...args) {
      if (img === image) frames.push(args[0]);
      return original.call(this, img, ...args);
    };
    try {
      for (const t of [0, 210, 810, 1000, 1210]) drawMap(t);
      u.hp = Rules.modelOf(u).hp * 0.25;
      drawMap(2000);
      u.hp = 0;
      drawMap(2200);
    } finally {
      ctx.drawImage = original;
      u.hp = 1000;
      drawMap(210);
    }
    return frames;
  });
  expect(frames).toEqual([0, 85, 85, 170, 340]);
  await page.screenshot({ path: ".openai/low-hp-map.png" });
  expect(errors).toEqual([]);
});

test("battle electricity starts only after displayed HP drops below the threshold and disappears at death", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const counts = await page.evaluate(() => {
    byId("start").hidden = true;
    byId("battle").hidden = false;
    byId("battle").style.opacity = 1;
    const entry = { unitId: "RGM_79", kitId: "machine_gun" },
      g = Rules.create(false, 1, [[entry], [entry]]),
      [left, right] = g.units,
      w = Rules.modelOf(left).weapons[0];
    right.hp = 3150;
    const event = {
      from: left.id,
      to: right.id,
      type: w.type,
      weapon: w.id,
      before: 4950,
      after: 3150,
      damage: 1800,
      hit: true,
      shieldBefore: 0,
      shieldAfter: 0,
      strikes: w.attack.strikes.map((step, i) => ({
        ...step,
        executed: true,
        hit: true,
        damage: 200,
        before: 4950 - i * 200,
        after: 4750 - i * 200,
        shieldDamage: 0,
      })),
    };
    const canvas = byId("battleCanvas"),
      box = canvas.getBoundingClientRect(),
      view = BattleScene.timeline(event, left, right, box.width, box.height),
      ctx = canvas.getContext("2d"),
      original = ctx.drawImage,
      image = SpriteRenderer.images[ART.effects.Stun_1.asset];
    let count = 0;
    const counts = [];
    ctx.drawImage = function (img, ...args) {
      if (img === image) count++;
      return original.call(this, img, ...args);
    };
    try {
      for (const time of [0, view.plan.impacts[0] + 0.001, view.plan.impacts.at(-1) + 0.001]) {
        count = 0;
        BattleScene.draw(canvas, {
          left,
          right,
          event,
          ratio: time / view.plan.duration,
          time: 0.81,
          completed: false,
          displayHp: { [left.id]: left.hp, [right.id]: 4950 },
        });
        counts.push(count);
      }
      count = 0;
      BattleScene.draw(canvas, {
        left,
        right,
        event,
        ratio: 1,
        time: 0.81,
        completed: true,
        displayHp: { [left.id]: left.hp, [right.id]: 0 },
      });
      counts.push(count);
      BattleScene.draw(canvas, {
        left,
        right,
        event,
        ratio: 1,
        time: 0.81,
        completed: true,
        displayHp: { [left.id]: left.hp, [right.id]: 3150 },
      });
    } finally {
      ctx.drawImage = original;
    }
    return counts;
  });
  expect(counts).toEqual([0, 0, 1, 0]);
  await page.screenshot({ path: ".openai/low-hp-battle.png" });
  expect(errors).toEqual([]);
});
test("lethal hit plays one accelerated electric burst before explosion and sprite hiding", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const samples = await page.evaluate(() => {
    byId("start").hidden = true;
    byId("battle").hidden = false;
    byId("battle").style.opacity = 1;
    const entry = { unitId: "RGM_79", kitId: "beam_spray" },
      g = Rules.create(false, 1, [[entry], [entry]]),
      [left, right] = g.units,
      weapon = Rules.modelOf(left).weapons[0],
      initialHp = right.hp;
    right.hp = 0;
    const event = {
      from: left.id,
      to: right.id,
      type: weapon.type,
      weapon: weapon.id,
      before: initialHp,
      after: 0,
      damage: initialHp,
      hit: true,
    };
    const canvas = byId("battleCanvas"),
      box = canvas.getBoundingClientRect(),
      plan = BattleScene.timeline(event, left, right, box.width, box.height).plan,
      ctx = canvas.getContext("2d"),
      drawImage = ctx.drawImage,
      drawUnit = SpriteRenderer.draw;
    const electricity = SpriteRenderer.images[ART.effects[plan.deathElectricEffect].asset],
      explosion = SpriteRenderer.images[ART.effects[plan.deathEffect].asset];
    let sample;
    ctx.drawImage = function (image, ...args) {
      if (image === electricity) sample.electric.push(args[0]);
      if (image === explosion) sample.explosions++;
      return drawImage.call(this, image, ...args);
    };
    SpriteRenderer.draw = function (context, model, x, ...args) {
      if (x > box.width / 2) sample.targetSprites++;
      return drawUnit.call(this, context, model, x, ...args);
    };
    const render = (time, completed = false) => {
      sample = { electric: [], explosions: 0, targetSprites: 0 };
      BattleScene.draw(canvas, {
        left,
        right,
        event,
        ratio: time / plan.duration,
        time: 0.81,
        completed,
        displayHp: { [left.id]: left.hp, [right.id]: completed ? 0 : initialHp },
      });
      return sample;
    };
    try {
      const result = [
        render(plan.deathSoundAt - 0.001),
        render(plan.deathSoundAt + 0.001),
        render(plan.deathSoundAt + 0.21),
        render(plan.deathSoundAt + 0.54),
        render(plan.deathSoundAt + 0.8),
        render(plan.deathAt + 0.001),
        render(plan.duration, true),
      ];
      render(plan.deathSoundAt + 0.21);
      return result;
    } finally {
      ctx.drawImage = drawImage;
      SpriteRenderer.draw = drawUnit;
    }
  });
  expect(samples.map((s) => s.electric)).toEqual([[], [0], [85], [340], [], [], []]);
  expect(samples.map((s) => s.targetSprites)).toEqual([1, 1, 1, 1, 1, 0, 0]);
  expect(samples[5].explosions).toBe(1);
  await page.screenshot({ path: ".openai/death-electric-burst.png" });
  expect(errors).toEqual([]);
});
