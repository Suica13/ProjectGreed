const { test, expect } = require("@playwright/test"),
  { pathToFileURL } = require("node:url"),
  path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;
test.use({ launchOptions: { ignoreDefaultArgs: ["--hide-scrollbars"] } });
test("formation keeps controls fixed while the native scrollbar is dragged through nine units", async ({
  page,
}) => {
  await page.goto(url);
  await page.locator("#openFormation").click();
  await page.locator("#formationPrefab").selectOption("RGM_79");
  for (let i = 0; i < 6; i++) await page.locator("#addFormationUnit").click();
  await expect(page.locator(".formation-row")).toHaveCount(9);
  const region = page.locator("#formationUnits");
  const sizes = await region.evaluate((list) => {
    list.scrollTop = 0;
    return {
      height: list.clientHeight,
      total: list.scrollHeight,
      overflow: getComputedStyle(list).overflowY,
    };
  });
  expect(sizes.total).toBeGreaterThan(sizes.height);
  expect(sizes.overflow).toBe("scroll");
  const footer = await page.locator("#saveFormation").boundingBox(),
    box = await region.boundingBox();
  await page.mouse.move(box.x + box.width - 8, box.y + 16);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width - 8, box.y + box.height - 20, { steps: 12 });
  await page.mouse.up();
  expect(await region.evaluate((list) => list.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".formation-row").last()).toBeInViewport();
  expect((await page.locator("#saveFormation").boundingBox()).y).toBe(footer.y);
  await page.screenshot({ path: ".openai/formation-scroll-list.png" });
  await page.locator("#saveFormation").click();
  expect(await page.evaluate(() => Formation.current().length)).toBe(9);
  await page.setViewportSize({ width: 430, height: 900 });
  await page.locator("#openFormation").click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator("#saveFormation")).toBeInViewport();
  await page.screenshot({ path: ".openai/formation-scroll-mobile.png" });
});
test("one local movement plays one boost-start sound, and failed movement does not play it", async ({
  page,
}) => {
  await page.goto(url);
  await page.locator("#startHotseat").click();
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  const sounds = await page.evaluate(async () => {
    await WeaponAudio.unlock();
    const played = [],
      play = WeaponAudio.play;
    WeaponAudio.play = function (sound, ...rest) {
      played.push(sound.asset);
      return play(sound, ...rest);
    };
    const unit = game.units[0];
    try {
      await performMove(unit, 4, 8);
      try {
        await performMove(unit, 5, 8);
      } catch {}
    } finally {
      WeaponAudio.play = play;
    }
    return played;
  });
  expect(sounds).toEqual(["presentation/moveSound"]);
});
test("electric death sound precedes explosion and the model stays until the explosion finishes", async ({
  page,
}) => {
  await page.goto(url);
  await page.locator("#startHotseat").click();
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  const result = await page.evaluate(() => {
    const a = game.units[0],
      b = game.units.find((u) => u.team === 1),
      w = getWeapon(a, "EF_BeamSprayGun"),
      canvas = byId("battleCanvas");
    byId("battle").hidden = false;
    b.hp = 1;
    b.model = "RGM_79L__beam_gun";
    b.shield = 0;
    b.x = a.x + 2;
    b.y = a.y;
    game.seed = 1;
    const event = Rules.fight(game, a, b, w, "defend")[0],
      bounds = canvas.getBoundingClientRect(),
      view = BattleScene.timeline(event, a, b, bounds.width, bounds.height),
      draw = SpriteRenderer.draw,
      counts = [];
    let count = 0;
    SpriteRenderer.draw = function (...args) {
      if (args[1] === b.model) count++;
      return draw(...args);
    };
    try {
      for (const time of [
        view.plan.deathSoundAt + 0.1,
        view.plan.deathAt + 0.1,
        view.plan.deathEnd + 0.01,
      ]) {
        count = 0;
        BattleScene.draw(canvas, {
          left: a,
          right: b,
          event,
          ratio: time / view.plan.duration,
          time,
          completed: false,
          displayHp: { [a.id]: a.hp, [b.id]: b.hp },
        });
        counts.push(count);
      }
    } finally {
      SpriteRenderer.draw = draw;
    }
    return {
      counts,
      delay: view.plan.deathAt - view.plan.deathSoundAt,
      sound: ART.presentation.deathSound.duration,
      cues: view.plan.cues.map((c) => ({ at: c.at, asset: c.sound?.asset })),
      soundAt: view.plan.deathSoundAt,
      explosionAt: view.plan.deathAt,
    };
  });
  expect(result.counts).toEqual([1, 1, 0]);
  expect(result.delay).toBeGreaterThanOrEqual(result.sound);
  expect(result.cues.filter((c) => c.asset === "presentation/deathSound")).toEqual([
    { at: result.soundAt, asset: "presentation/deathSound" },
  ]);
  expect(
    result.cues.some(
      (c) => c.at === result.explosionAt && c.asset.startsWith("effect/Explosion_Ground_1"),
    ),
  ).toBe(true);
});
