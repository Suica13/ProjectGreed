const { test, expect } = require("@playwright/test");
const { pathToFileURL } = require("node:url"),
  path = require("node:path");

for (const discard of [false, true])
  test(`battle asset readiness waits for decoding${discard ? " and discards stale decoded assets" : ""}`, async ({
    page,
  }) => {
    await page.goto(pathToFileURL(path.resolve("public/client.html")).href);
    await page.waitForFunction(() => assetsReady);
    await page.evaluate(() => {
      const model = Object.keys(UnitModels).find((id) => UnitModels[id].prefabId === "MA_08");
      const keys = SpriteRenderer.battleKeys({ game: { units: [{ model }] } });
      const menuIcons = new Set(ART.units.map((unit) => ART.assets[unit.icon]));
      window.decodeProbeKey = keys.find(
        (key) => !SpriteRenderer.images[key] && !menuIcons.has(ART.assets[key]),
      );
      if (!decodeProbeKey) throw Error("No fresh asset available for decode test");
      const NativeImage = Image;
      window.Image = class extends NativeImage {
        async decode() {
          if (super.decode) await super.decode();
          await new Promise((resolve) => {
            window.releaseDecodeProbe = resolve;
          });
        }
      };
      window.decodeProbeDone = false;
      SpriteRenderer.ensureAssets([decodeProbeKey]).then(() => {
        decodeProbeDone = true;
      });
    });
    await page.waitForFunction(() => typeof releaseDecodeProbe === "function");
    expect(
      await page.evaluate(() => decodeProbeDone || SpriteRenderer.readyAssets([decodeProbeKey])),
    ).toBe(false);
    if (discard) await page.evaluate(() => SpriteRenderer.releaseBattleResources());
    await page.evaluate(() => releaseDecodeProbe());
    await page.waitForFunction(() => decodeProbeDone);
    expect(await page.evaluate(() => SpriteRenderer.readyAssets([decodeProbeKey]))).toBe(!discard);
    expect(await page.evaluate(() => SpriteRenderer.cacheStats().pending)).toBe(0);
  });
