const { test } = require("@playwright/test");
const assert = require("node:assert/strict");
const { pathToFileURL } = require("node:url");
const path = require("node:path");
const url = pathToFileURL(path.resolve("public/client.html")).href;

test("local audio initialization decodes shared assets once with bounded concurrency", async ({
  page,
}) => {
  const requests = [];
  page.on("request", (r) => {
    if (/^https?:/.test(r.url())) requests.push(r.url());
  });
  await page.goto(url);
  await page.evaluate(() => {
    window.audioProbe = { count: 0, active: 0, max: 0 };
    const proto = AudioContext.prototype,
      decode = proto.decodeAudioData;
    proto.decodeAudioData = function (...args) {
      const probe = window.audioProbe;
      probe.count++;
      probe.active++;
      probe.max = Math.max(probe.max, probe.active);
      return decode.apply(this, args).finally(() => probe.active--);
    };
  });
  await page.locator("#openClientSettings").click();
  const result = await page.evaluate(async () => {
    await WeaponAudio.unlock();
    const groups = new Map();
    for (const [key, source] of Object.entries(ART.sounds)) {
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source).push(key);
    }
    const aliases = [...groups.values()].find((keys) => keys.length > 1);
    const buffers = [],
      proto = AudioContext.prototype,
      create = proto.createBufferSource;
    proto.createBufferSource = function () {
      const node = create.call(this);
      buffers.push(node);
      return node;
    };
    for (const asset of aliases.slice(0, 2)) WeaponAudio.play({ asset, volume: 1 });
    const shared = buffers.length === 2 && buffers[0].buffer === buffers[1].buffer;
    WeaponAudio.stop();
    await WeaponAudio.unlock();
    return { ...window.audioProbe, unique: groups.size, shared };
  });
  assert.equal(result.count, result.unique);
  assert.ok(result.max <= 2);
  assert.equal(result.active, 0);
  assert.ok(result.shared);
  assert.deepEqual(requests, []);
});

test("local BGM still plays, pauses across clicks, changes tracks and loops", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  const firstPlay = page.evaluate(
    () =>
      new Promise((resolve) =>
        MusicPlayer.audio.addEventListener("playing", () => resolve(!MusicPlayer.audio.paused), {
          once: true,
        }),
      ),
  );
  await page.locator("#musicToggle").click();
  assert.ok(await firstPlay);
  await page.locator("#musicToggle").click();
  await page.locator("#openClientSettings").click();
  assert.equal(await page.evaluate(() => MusicPlayer.audio.paused), true);
  await page.keyboard.press("Escape");
  const old = await page.evaluate(() => MusicPlayer.index);
  const trackCount = await page.evaluate(() => ART.music.tracks.length);
  await page.locator("#musicNext").click();
  const next = await page.evaluate(() => ({
    index: MusicPlayer.index,
    paused: MusicPlayer.audio.paused,
  }));
  assert.notEqual(next.index, old);
  assert.ok(next.paused);
  const play = page.evaluate(
    () =>
      new Promise((resolve) =>
        MusicPlayer.audio.addEventListener("playing", () => resolve(true), { once: true }),
      ),
  );
  await page.locator("#musicToggle").click();
  await play;
  const loop = await page.evaluate(
    () =>
      new Promise((resolve) => {
        MusicPlayer.audio.addEventListener(
          "playing",
          () => resolve({ index: MusicPlayer.index, paused: MusicPlayer.audio.paused }),
          { once: true },
        );
        MusicPlayer.audio.dispatchEvent(new Event("ended"));
      }),
  );
  assert.equal(loop.index, (next.index + 1) % trackCount);
  assert.equal(loop.paused, false);
  assert.deepEqual(errors, []);
});
