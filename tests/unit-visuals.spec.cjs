const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const { openPresentationFixture } = require("./presentation-fixture.cjs");
const url = pathToFileURL(path.resolve("public/client.html")).href;
test("native single eyes render over the four ZEON heads with semantic animated bones", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  const result = await page.evaluate(() => {
    const ids = ["MS_06F__bazooka", "MS_06J__magella_cannon", "MS_06K__big_gun", "MS_09__bazooka"];
    const gallery = document.createElement("canvas");
    gallery.width = 1200;
    gallery.height = 660;
    gallery.style.cssText =
      "position:fixed;inset:0;width:1200px;height:660px;z-index:9999;background:#162935";
    document.body.append(gallery);
    const ctx = gallery.getContext("2d"),
      draw = ctx.drawImage,
      eyes = new Set();
    for (const id of ids) {
      const layer = SpriteRenderer.models[id].decals.find((l) => l.name === "Eye");
      eyes.add(SpriteRenderer.images[layer.asset]);
    }
    let count = 0;
    ctx.drawImage = function (img, ...args) {
      if (eyes.has(img)) count++;
      return draw.call(this, img, ...args);
    };
    for (const [i, id] of ids.entries()) {
      ctx.fillStyle = "#eef9fb";
      ctx.font = "bold 18px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(UnitModels[id].name, 150 + i * 300, 35);
      SpriteRenderer.draw(ctx, id, 150 + i * 300, 170, 3, 90, null, 0, null, false, true);
      SpriteRenderer.draw(
        ctx,
        id,
        150 + i * 300,
        460,
        3,
        -90,
        "Common_Shoot_A",
        0.4,
        null,
        false,
        true,
      );
    }
    return { count, dom: UnitModels.MS_09__bazooka.weapons[0].name };
  });
  expect(result.count).toBe(8);
  expect(result.dom).toBe("380mm火箭筒");
  await page.screenshot({ path: ".openai/zeon-eyes-semantic-bones.png" });
  expect(errors).toEqual([]);
});
test("quick checkbox silences battle cues immediately and normal playback can resume audio", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await expect(page.locator("#openSkirmish")).toBeEnabled();
  await openPresentationFixture(page, false);
  await page.locator("#confirmDeployment").click();
  await page.locator("#confirmDeployment").click();
  const result = await page.evaluate(async () => {
    await WeaponAudio.unlock();
    const proto = (window.AudioContext || window.webkitAudioContext).prototype;
    const original = proto.createBufferSource;
    let starts = 0,
      stops = 0;
    proto.createBufferSource = function () {
      const node = original.call(this),
        start = node.start.bind(node),
        stop = node.stop.bind(node);
      node.start = (...args) => {
        starts++;
        return start(...args);
      };
      node.stop = (...args) => {
        stops++;
        return stop(...args);
      };
      return node;
    };
    try {
      const a = game.units.find((u) => u.team === 0 && u.model.endsWith("__machine_gun")),
        b = game.units.find((u) => u.team === 1),
        weapon = getWeapon(a, "EF_90mmMG");
      Object.assign(b, { x: a.x + 2, y: a.y, hp: 100000 });
      const before = Object.fromEntries(game.units.map((u) => [u.id, u.hp]));
      const events = Rules.fight(game, a, b, weapon, "defend");
      phase = "battle";
      const now = performance.now();
      battleView = {
        a: a.id,
        b: b.id,
        events,
        index: 0,
        start: now,
        displayHp: before,
        completed: false,
      };
      BattleWindow.show(battleView, now - 1000);
      battleView.start = now;
      byId("quick").checked = true;
      byId("quick").dispatchEvent(new Event("change"));
      drawBattle(now);
      const quickStarts = starts;
      byId("quick").checked = false;
      byId("quick").dispatchEvent(new Event("change"));
      drawBattle(now);
      const normalStarts = starts;
      byId("quick").checked = true;
      byId("quick").dispatchEvent(new Event("change"));
      const cancelled = stops;
      drawBattle(now);
      BattleWindow.suspend(battleView, now);
      return { quickStarts, normalStarts, cancelled, afterMute: starts };
    } finally {
      WeaponAudio.stopBattle();
      proto.createBufferSource = original;
    }
  });
  expect(result.quickStarts).toBe(0);
  expect(result.normalStarts).toBeGreaterThan(0);
  expect(result.cancelled).toBe(result.normalStarts);
  expect(result.afterMute).toBe(result.normalStarts);
  expect(errors).toEqual([]);
});
