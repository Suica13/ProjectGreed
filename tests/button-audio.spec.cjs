const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
test.use({ hasTouch: true });

test("button feedback handles dynamic, keyboard and touch controls and respects mute", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(() => {
    window.uiTones = [];
    const prototype = (window.AudioContext || window.webkitAudioContext).prototype;
    const original = prototype.createBufferSource;
    prototype.createBufferSource = function (...args) {
      const node = original.apply(this, args);
      uiTones.push(node);
      return node;
    };
  });
  await page.locator("#shellSettings").click();
  await expect.poll(() => page.evaluate(() => uiTones.length)).toBe(1);
  await page.evaluate(() => {
    const button = document.createElement("button");
    button.id = "audioProbe";
    button.innerHTML = "<span>音效测试</span>";
    document.querySelector("#clientSettingsDialog").append(button);
  });
  await page.locator("#audioProbe span").click();
  expect(await page.evaluate(() => uiTones.length)).toBe(2);
  await page.locator("#audioProbe").focus();
  await page.keyboard.press("Enter");
  expect(await page.evaluate(() => uiTones.length)).toBe(3);
  await page.evaluate(() => document.querySelector("#audioProbe").click());
  expect(await page.evaluate(() => uiTones.length)).toBe(3);
  await page.evaluate(() => document.querySelector("#audioProbe").setAttribute("aria-disabled", "true"));
  await page.locator("#audioProbe").click({force:true});
  expect(await page.evaluate(() => uiTones.length)).toBe(3);
  await page.evaluate(() => {
    document.querySelector("#audioProbe").removeAttribute("aria-disabled");
    ClientSettings.set("sfx", 0);
  });
  await page.locator("#audioProbe").click();
  expect(await page.evaluate(() => uiTones.length)).toBe(3);
  await page.evaluate(() => ClientSettings.set("sfx", 0.5));
  await page.locator("#audioProbe").tap();
  expect(await page.evaluate(() => uiTones.length)).toBe(4);
  const native = await page.evaluate(() => ({
    duration: uiTones.at(-1).buffer.duration,
    expected: ART.presentation.buttonSound.duration,
    sameSource: ART.sounds[ART.presentation.buttonSound.asset] === ART.sounds[ART.presentation.selectUnitSound.asset],
  }));
  expect(native.duration).toBeCloseTo(native.expected, 2);
  expect(native.sameSource).toBe(true);
  expect(errors).toEqual([]);
});


test("formation details and unit picker play only their existing unit cue", async ({page}) => {
  await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
  await page.evaluate(async () => {
    await WeaponAudio.unlock();
    Formation.open();
    window.unitCues = [];
    const original = WeaponAudio.play;
    WeaponAudio.play = (sound, ...args) => { unitCues.push(sound?.asset); return original(sound, ...args); };
  });
  await page.locator(".formation-detail-button").first().click();
  await expect.poll(() => page.evaluate(() => unitCues.length)).toBe(1);
  expect(await page.evaluate(() => unitCues.includes("presentation/buttonSound"))).toBe(false);
  await page.locator("#closeFormationDetail").click();
  await page.locator("#openFormationPicker").click();
  await page.evaluate(() => unitCues.length = 0);
  await page.locator(".catalog-unit").first().click();
  await expect.poll(() => page.evaluate(() => unitCues.length)).toBe(1);
  expect(await page.evaluate(() => unitCues.includes("presentation/buttonSound"))).toBe(false);
});
