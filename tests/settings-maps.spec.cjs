const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");
const file = pathToFileURL(path.resolve("public/client.html")).href;
async function slider(page, name, value) {
  await page.locator("#volume-" + name).evaluate((el, value) => {
    el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}
test("global settings switch language, mix music and effects live, mute active gains and persist after reload", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(file);
  await page.evaluate(() => {
    window.testGains = [];
    const proto = (window.AudioContext || window.webkitAudioContext).prototype,
      original = proto.createGain;
    proto.createGain = function (...args) {
      const node = original.apply(this, args);
      window.testGains.push(node);
      return node;
    };
  });
  await page.locator("#openClientSettings").click();
  await expect(page.locator("#clientSettingsDialog")).toBeVisible();
  await slider(page, "master", 50);
  await slider(page, "music", 20);
  await slider(page, "sfx", 30);
  expect(await page.evaluate(() => MusicPlayer.audio.volume / ART.music.volume)).toBeCloseTo(
    0.1,
    5,
  );
  const result = await page.evaluate(async () => {
    await WeaponAudio.unlock();
    const sound = ART.presentation.selectWeaponSound;
    WeaponAudio.play(sound);
    const gain = window.testGains.at(-1),
      before = gain.gain.value;
    ClientSettings.set("sfx", 0.6);
    const after = gain.gain.value;
    ClientSettings.set("master", 0);
    return {
      before,
      after,
      expected: sound.volume * ART.presentation.sfxVolume,
      mute: gain.gain.value,
      music: MusicPlayer.audio.volume,
    };
  });
  expect(result.before).toBeCloseTo(result.expected * 0.5 * 0.3, 5);
  expect(result.after).toBeCloseTo(result.expected * 0.5 * 0.6, 5);
  expect(result.mute).toBe(0);
  expect(result.music).toBe(0);
  await slider(page, "master", 50);
  await slider(page, "sfx", 30);
  await page.locator("#settingsLanguage").selectOption("en");
  await expect(page.locator("#clientSettingsTitle")).toHaveText("Settings");
  await page.keyboard.press("Escape");
  await expect(page.locator("#clientSettingsDialog")).not.toBeVisible();
  await page.reload();
  await page.locator("#openClientSettings").click();
  await expect(page.locator("#settingsLanguage")).toHaveValue("en");
  await expect(page.locator("#volume-master")).toHaveValue("50");
  await expect(page.locator("#volume-sfx")).toHaveValue("30");
  expect(await page.evaluate(() => MusicPlayer.audio.volume / ART.music.volume)).toBeCloseTo(
    0.1,
    5,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.locator("#clientSettingsDialog").boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: ".openai/settings-mobile.png" });
  expect(errors).toEqual([]);
});
test("host readiness is gold and all new maps resize room seats and render in battle", async ({
  page,
}) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(file);
  await page.locator("#openSkirmish").click();
  await page.locator("#createOfflineRoom").click();
  const host = page.locator('.spawn-slot[data-seat="0"] .lineup-ready');
  await expect(host).toHaveText("房主");
  await expect(host).toHaveCSS("color", "rgb(240, 206, 103)");
  for (const [id, count] of [
    ["central_heights_3v3", 6],
    ["serpentine_rainforest_3v3", 6],
    ["military_base_5v5", 10],
    ["great_plains_5v5", 10],
  ]) {
    await page.locator("#roomMapSelect").selectOption(id);
    await expect.poll(() => page.evaluate(() => Net.snapshot.settings.mapId)).toBe(id);
    await expect(page.locator(".spawn-slot")).toHaveCount(count);
  }
  for (let seat = 2; seat < 10; seat++) {
    await page.locator("#addAI" + seat).click();
    await expect.poll(() => page.evaluate(() => Net.awaiting)).toBeNull();
  }
  await page.locator("#startRoomGame").click();
  await page.locator("#confirmFinalFormation").click();
  await expect(page.locator("#deploymentPanel")).toBeVisible();
  expect(await page.evaluate(() => new Set(game.units.map((u) => u.ownerSeat)).size)).toBe(10);
  await page.evaluate(() => {
    Net.leave();
    const entry = { unitId: "RGM_79", kitId: "machine_gun" };
    for (const id of [
      "central_heights_3v3",
      "serpentine_rainforest_3v3",
      "military_base_5v5",
      "great_plains_5v5",
    ]) {
      const map = Rules.getMap(id);
      game = Rules.create(
        false,
        1,
        map.spawns.map(() => [entry]),
        true,
        { mapId: id },
      );
      selected = game.units[0].id;
      phase = "deployment";
      mode = "select";
      weaponId = null;
      moving = null;
      battleView = null;
      setPageView("game");
      MapCamera.reset();
      update();
      drawMap(1000);
    }
  });
  await page.screenshot({ path: ".openai/plains-5v5.png" });
  expect(errors).toEqual([]);
});
