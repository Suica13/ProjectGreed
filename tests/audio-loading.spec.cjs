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
  await page.locator("#shellSettings").click();
  const result = await page.evaluate(async () => {
    await WeaponAudio.unlock();
    const groups = new Map();
    for (const [key, source] of Object.entries(ART.sounds)) {
      if (!groups.has(source)) groups.set(source, []);
      groups.get(source).push(key);
    }
    const aliases = [...groups.values()].find((keys) => keys.length > 1);
    await WeaponAudio.prepare(aliases.slice(0,2).map(asset=>({asset})));
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
  assert.ok(result.count < result.unique, "unrelated catalog sounds must not decode on first input");
  assert.ok(result.max <= 2);
  assert.equal(result.active, 0);
  assert.ok(result.shared);
  assert.deepEqual(requests, []);
});

test("local BGM plays and changes tracks from the current settings audio page", async ({ page }) => {
  const errors=[];page.on("pageerror",error=>errors.push(error.message));
  await page.goto(url);
  await page.locator("#shellSettings").click();
  await page.locator('[data-settings-tab="audio"]').click();
  if(await page.evaluate(()=>MusicPlayer.audio.paused)) await page.locator("#musicToggle").click();
  await page.waitForFunction(()=>!MusicPlayer.audio.paused && MusicPlayer.audio.currentTime>0);
  await page.locator("#musicToggle").click();
  assert.equal(await page.evaluate(()=>MusicPlayer.audio.paused),true);
  const previous=await page.evaluate(()=>MusicPlayer.index);
  await page.locator("#musicNext").click();
  assert.notEqual(await page.evaluate(()=>MusicPlayer.index),previous);
  assert.equal(await page.evaluate(()=>MusicPlayer.audio.paused),true);
  await page.locator("#musicToggle").click();
  await page.waitForFunction(()=>!MusicPlayer.audio.paused);
  const next=await page.evaluate(()=>{const index=MusicPlayer.index;MusicPlayer.audio.dispatchEvent(new Event("ended"));return index;});
  await page.waitForFunction(index=>MusicPlayer.index!==index && !MusicPlayer.audio.paused,next);
  assert.deepEqual(errors,[]);
});
